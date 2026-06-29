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

function shortPath(url) {
  try { const u = new URL(url); return u.host + u.pathname; }
  catch (e) { return url; }
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
    ['transport', r.transport], ['method', r.method], ['host', r.host],
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
  const card = document.createElement('div');
  card.className = `ev t-${r.transport}`;
  card.innerHTML = `
    <div class="ev-head">
      <span class="ev-time">${escapeHtml(formatTime(new Date(r._ts)))}</span>
      <span class="ev-method">${escapeHtml(r.method)}</span>
      <span class="ev-host">${escapeHtml(shortPath(r.effectiveUrl))}</span>
    </div>
    <div class="ev-name">${escapeHtml(r.en || '(no event name)')}</div>
    <div class="ev-pills">${transportPill(r.transport)}${consentPills(r.consent)}</div>
    ${identifierSummary(r.identifiers, r.em) ? `<div class="ev-summary">${identifierSummary(r.identifiers, r.em)}</div>` : ''}
    ${detailHtml(r)}`;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.ev-detail')) return;   // let users select/copy in the table
    const det = card.querySelector('.ev-detail');
    if (det) det.hidden = !det.hidden;
  });
  block._eventsEl.appendChild(card);
}

function renderStatus() {
  recCount.textContent = `${totalEvents()} events / ${state.blocks.length} blocks`;
  recDot.classList.toggle('live', state.recording);
  recordBtn.textContent = state.recording ? 'Stop' : 'Record';
  recordBtn.classList.toggle('recording', state.recording);
  emptyEl.hidden = totalEvents() > 0;
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
  if (on && state.blocks.length === 0) {
    // Seed the first block with the current page URL for a meaningful header.
    chrome.devtools.inspectedWindow.eval('location.href', (href) => {
      if (state.recording && state.blocks.length === 0) startBlock(typeof href === 'string' ? href : null);
    });
  }
  renderStatus();
}

recordBtn.addEventListener('click', () => setRecording(!state.recording));

clearBtn.addEventListener('click', () => {
  state.blocks = [];
  blocksEl.innerHTML = '';
  renderStatus();
});

renderStatus();
