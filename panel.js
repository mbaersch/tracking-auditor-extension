// Panel UI controller: captures GA4 requests of the inspected tab via the
// DevTools network API and renders them in blocks per navigation.
import { parseGa4Request } from './lib/ga4.js';

const recordBtn = document.getElementById('recordBtn');
const clearBtn  = document.getElementById('clearBtn');
const recDot    = document.getElementById('recDot');
const recCount  = document.getElementById('recCount');
const emptyEl   = document.getElementById('empty');
const blocksEl  = document.getElementById('blocks');

const state = {
  recording: false,
  blocks: [],   // [{ navUrl, navTime, events:[], _el, _eventsEl }]
};

// --- helpers ---------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function totalEvents() {
  return state.blocks.reduce((n, b) => n + b.events.length, 0);
}

function formatTime(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// --- pill / summary rendering ---------------------------------------------

const TRANSPORT_PILL = {
  'standard':    { cls: 'pill-standard', label: 'GA4',         tip: 'Standard GA4 endpoint' },
  'first-party': { cls: 'pill-standard', label: 'first-party', tip: 'First-party sGTM / Tag Gateway on a standard collect path' },
  'stape-b64':   { cls: 'pill-stape',    label: 'Stape b64',   tip: 'Stape Custom Loader — GA4 path was base64-encoded inside the request URL' },
  'custom-path': { cls: 'pill-custom',   label: 'Custom path', tip: 'Custom delivery path without a standard /collect segment' },
};

function transportPill(transport) {
  const t = TRANSPORT_PILL[transport];
  if (!t) return '';
  return `<span class="pill ${t.cls}" title="${escapeHtml(t.tip)}">${escapeHtml(t.label)}</span>`;
}

function identifierSummary(ids, em) {
  const parts = [];
  for (const key of ['email', 'phone', 'name', 'address']) {
    if (ids && ids[key]) parts.push(`${ids[key]}× ${key}`);
  }
  const pills = [];
  if (parts.length) {
    pills.push(`<span class="pill pill-ud" title="Identifiers found in user_data / em">${escapeHtml(parts.join(' · '))}</span>`);
  }
  if (em) {
    pills.push('<span class="pill pill-em" title="Request carries an em parameter (hashed enhanced-conversion identifiers)">em</span>');
  }
  return pills.join('');
}

function flagPills(flags) {
  if (!flags) return '';
  const out = [];
  if (flags.conversion)    out.push('<span class="pill pill-conversion" title="_c=1 — conversion / key event">conversion</span>');
  if (flags.externalEvent) out.push('<span class="pill pill-ee" title="_ee=1 — external event (created via GA4 configuration)">external</span>');
  if (flags.sessionStart)  out.push('<span class="pill pill-event" title="_ss=1 — session start">session start</span>');
  if (flags.firstVisit)    out.push('<span class="pill pill-event" title="_fv=1 — first visit">first visit</span>');
  if (flags.epCount)       out.push(`<span class="pill pill-ep" title="${flags.epCount} custom event parameter(s): ep.* / epn.*">ep ×${flags.epCount}</span>`);
  return out.join('');
}

function consentPills(consent) {
  if (!consent) return '';
  const stateCls = (s) => s === 'granted' ? 'pill-consent-granted' : s === 'denied' ? 'pill-consent-denied' : 'pill-consent-unset';
  const out = [];
  if (consent.adStorage)        out.push(`<span class="pill ${stateCls(consent.adStorage)}" title="ad_storage (gcs)">ad: ${escapeHtml(consent.adStorage)}</span>`);
  if (consent.analyticsStorage) out.push(`<span class="pill ${stateCls(consent.analyticsStorage)}" title="analytics_storage (gcs)">analytics: ${escapeHtml(consent.analyticsStorage)}</span>`);
  return out.join('');
}

// --- inline detail ---------------------------------------------------------

function paramRows(obj) {
  const keys = Object.keys(obj || {}).sort();
  if (!keys.length) return '';
  return keys.map(k => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(obj[k])}</td></tr>`).join('');
}

function detailHtml(r) {
  const meta = [
    ['event (en)', r.en], ['measurement id (tid)', r.tid],
    ['transport', r.transport], ['method', r.method],
    ['request url', r.effectiveUrl],
    ['original (masked) url', r._originalUrl && r._originalUrl !== r.effectiveUrl ? r._originalUrl : null],
  ].filter(([, v]) => v != null && v !== '');

  let consentSection = '';
  if (r.consent) {
    const rows = [];
    if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
    if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
    if (Array.isArray(r.consent.gcdDecoded)) {
      for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
    }
    consentSection = `<div class="det-section">Consent</div><table class="det-table">${
      rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
  }

  let udSection = '';
  if (r.userData) {
    udSection = `<div class="det-section">user_data</div><table class="det-table"><tr><td>parsed</td><td>${
      escapeHtml(JSON.stringify(r.userData))}</td></tr></table>`;
  }

  const qSection = `<div class="det-section">Query parameters</div><table class="det-table">${paramRows(r.queryParams)}</table>`;
  const bSection = (r.bodyParams && Object.keys(r.bodyParams).length)
    ? `<div class="det-section">Body parameters</div><table class="det-table">${paramRows(r.bodyParams)}</table>` : '';

  return `<div class="ev-detail" hidden>
    <table class="det-table">${meta.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
    ${consentSection}${udSection}${qSection}${bSection}
  </div>`;
}

// --- DOM building (incremental, preserves expanded state) ------------------

function appendBlockDom(block) {
  const el = document.createElement('div');
  el.className = 'blk';
  const head = document.createElement('div');
  head.className = 'blk-head';
  head.innerHTML = `<span class="blk-time">${escapeHtml(formatTime(new Date(block.navTime)))}</span>${
    escapeHtml(block.navUrl || '(current page)')}`;
  const events = document.createElement('div');
  events.className = 'blk-events';
  el.append(head, events);
  blocksEl.appendChild(el);
  block._el = el;
  block._eventsEl = events;
}

function appendEventDom(block, r) {
  const dl = (r.queryParams && r.queryParams.dl) || (r.bodyParams && r.bodyParams.dl) || null;
  const card = document.createElement('div');
  card.className = `ev t-${r.transport}`;
  card.innerHTML = `
    <div class="ev-head">
      <span class="ev-time">${escapeHtml(formatTime(new Date(r._ts)))}</span>
      <span class="ev-method">${escapeHtml(r.method)}</span>
      ${r.tid ? `<span class="ev-tid" title="Measurement ID (tid)">${escapeHtml(r.tid)}</span>` : ''}
      <span class="ev-caret" title="Show all parameters">▼</span>
    </div>
    <div class="ev-name">${escapeHtml(r.en || '(no event name)')}</div>
    ${dl ? `<div class="ev-dl" title="document location (dl)">${escapeHtml(dl)}</div>` : ''}
    <div class="ev-pills">${transportPill(r.transport)}${flagPills(r.flags)}${consentPills(r.consent)}</div>
    ${identifierSummary(r.identifiers, r.em) ? `<div class="ev-summary">${identifierSummary(r.identifiers, r.em)}</div>` : ''}
    ${detailHtml(r)}`;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.ev-detail')) return;   // let users select/copy in the table
    const det = card.querySelector('.ev-detail');
    const caret = card.querySelector('.ev-caret');
    if (det) {
      det.hidden = !det.hidden;
      if (caret) { caret.textContent = det.hidden ? '▼' : '▲'; caret.title = det.hidden ? 'Show all parameters' : 'Hide parameters'; }
    }
  });
  block._eventsEl.appendChild(card);
}

function renderStatus() {
  recCount.textContent = `${totalEvents()} events / ${state.blocks.length} blocks`;
  recDot.classList.toggle('live', state.recording);
  recordBtn.textContent = state.recording ? 'Stop' : 'Start & Reload';
  recordBtn.classList.toggle('recording', state.recording);
  emptyEl.hidden = state.blocks.length > 0;
}

// --- capture ---------------------------------------------------------------

function startBlock(navUrl) {
  const block = { navUrl, navTime: Date.now(), events: [] };
  state.blocks.push(block);
  appendBlockDom(block);
  return block;
}

function currentBlock() {
  return state.blocks.length ? state.blocks[state.blocks.length - 1] : startBlock(null);
}

function onRequest(harEntry) {
  if (!state.recording) return;
  const req = harEntry && harEntry.request;
  if (!req || !req.url) return;
  const r = parseGa4Request(req.url, req.postData);
  if (!r) return;
  r.method = req.method || r.method;
  r._originalUrl = req.url;
  r._ts = harEntry.startedDateTime ? new Date(harEntry.startedDateTime).getTime() : Date.now();
  const block = currentBlock();
  block.events.push(r);
  appendEventDom(block, r);
  renderStatus();
}

function onNavigated(url) {
  if (!state.recording) return;
  startBlock(url);
  renderStatus();
}

chrome.devtools.network.onRequestFinished.addListener(onRequest);
chrome.devtools.network.onNavigated.addListener(onNavigated);

// --- controls --------------------------------------------------------------

function setRecording(on) {
  state.recording = on;
  renderStatus();
  // Starting reloads the inspected page: the post-reload onNavigated opens the
  // first block and we capture from the very first hit — no empty initial block
  // and no manual reload needed.
  if (on) chrome.devtools.inspectedWindow.reload();
}

recordBtn.addEventListener('click', () => setRecording(!state.recording));

clearBtn.addEventListener('click', () => {
  state.blocks = [];
  blocksEl.innerHTML = '';
  renderStatus();
});

renderStatus();
