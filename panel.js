// Panel UI controller: captures tracking requests of the inspected tab via the
// DevTools network API and renders them in blocks per navigation. Each request is
// offered to every provider parser (GA4, Meta); the first that claims it wins.
import { parseGa4Request } from './lib/ga4.js';
import { parseMetaRequest } from './lib/meta.js';
import { parseUetRequest } from './lib/uet.js';

const recordBtn = document.getElementById('recordBtn');
const clearBtn  = document.getElementById('clearBtn');
const recDot    = document.getElementById('recDot');
const recCount  = document.getElementById('recCount');
const emptyEl   = document.getElementById('empty');
const blocksEl  = document.getElementById('blocks');

// Provider parsers, tried in order. Each returns a normalized record or null.
const PARSERS = [
  { id: 'ga4',  parse: parseGa4Request },
  { id: 'meta', parse: parseMetaRequest },
  { id: 'uet',  parse: parseUetRequest },
];

const state = {
  recording: false,
  blocks: [],                                             // [{ navUrl, navTime, events:[], _el, _eventsEl }]
  record: { ga4: true, meta: true, uet: true },           // capture switches (the "in" side)
  filter: { ga4: true, meta: true, uet: true, text: '' }, // display filter (the "out" side)
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

// Provider-agnostic accessors.
function eventName(r) {
  if (r.provider === 'meta') return r.ev;
  if (r.provider === 'uet')  return r.eventName;
  return r.en;
}
function accountId(r) {
  if (r.provider === 'meta') return r.id;
  if (r.provider === 'uet')  return r.ti;
  return r.tid;
}
function accountTitle(r) {
  if (r.provider === 'meta') return 'Pixel ID (id)';
  if (r.provider === 'uet')  return 'UET Tag ID (ti)';
  return 'Measurement ID (tid)';
}
function docLocation(r) {
  const key = r.provider === 'uet' ? 'p' : 'dl';   // UET carries the page url in p
  return (r.queryParams && r.queryParams[key]) || (r.bodyParams && r.bodyParams[key]) || null;
}

// --- pill / summary rendering ---------------------------------------------

// GA4 transport sub-pills shown next to the GA4 provider pill (standard needs none).
const GA4_TRANSPORT_SUB = {
  'first-party': { cls: 'pill-custom', label: 'first-party', tip: 'First-party sGTM / Tag Gateway on a standard collect path' },
  'stape-b64':   { cls: 'pill-stape',  label: 'Stape b64',   tip: 'Stape Custom Loader — GA4 path was base64-encoded inside the request URL' },
  'custom-path': { cls: 'pill-custom', label: 'Custom path',  tip: 'Custom delivery path without a standard /collect segment' },
};

// Every card leads with a solid provider pill (GA4 / Meta / Bing) so the stream
// reads consistently; transport variants follow as secondary pills.
function providerPills(r) {
  if (r.provider === 'meta') {
    const pills = ['<span class="pill pill-meta" title="Meta (Facebook) Pixel — facebook.com/tr">Meta</span>'];
    if (r.transport === 'first-party') {
      pills.push('<span class="pill pill-custom" title="First-party proxied /tr on the site&#39;s own domain">first-party</span>');
    }
    return pills.join('');
  }
  if (r.provider === 'uet') {
    const pills = ['<span class="pill pill-bing" title="Microsoft Bing UET — bat.bing.com/action">Bing</span>'];
    if (r.transport === 'first-party') {
      pills.push('<span class="pill pill-custom" title="First-party proxied /action on the site&#39;s own domain">first-party</span>');
    }
    return pills.join('');
  }
  const pills = ['<span class="pill pill-ga4" title="Google Analytics 4">GA4</span>'];
  const sub = GA4_TRANSPORT_SUB[r.transport];
  if (sub) pills.push(`<span class="pill ${sub.cls}" title="${escapeHtml(sub.tip)}">${escapeHtml(sub.label)}</span>`);
  return pills.join('');
}

function flagPills(r) {
  const out = [];
  if (r.provider === 'meta') {
    const f = r.flags || {};
    if (!r.standardEvent) out.push('<span class="pill pill-ee" title="Custom event (not a Meta standard event)">custom event</span>');
    if (f.dedup)          out.push('<span class="pill pill-event" title="eid present — event ID for CAPI deduplication">dedup</span>');
    if (f.cdCount)        out.push(`<span class="pill pill-ep" title="${f.cdCount} custom-data field(s): cd[...]">cd ×${f.cdCount}</span>`);
    return out.join('');
  }
  if (r.provider === 'uet') {
    const f = r.flags || {};
    if (f.consentEvent) out.push('<span class="pill pill-consent-info" title="evt=consent — a consent signal (Microsoft Consent Mode), not a tracking event">consent signal</span>');
    if (f.personalData) out.push('<span class="pill pill-em" title="evt=pid — payload is user data / enhanced conversions only">personal data</span>');
    if (f.custom)    out.push('<span class="pill pill-ee" title="Custom event (evt=custom) — typically a conversion goal">custom event</span>');
    if (f.ecommerce) out.push('<span class="pill pill-event" title="E-commerce fields present (prodid / pagetype / ecomm_*)">ecommerce</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="Goal value (gv) / e-commerce total">revenue: ${amount}</span>`);
    }
    if (f.iframe) out.push('<span class="pill pill-ep" title="ifm=1 — fired inside an iframe">iframe</span>');
    if (f.spa)    out.push('<span class="pill pill-ep" title="spa=1 — single-page-app navigation">SPA</span>');
    return out.join('');
  }
  const f = r.flags;
  if (!f) return '';
  if (f.conversion)    out.push('<span class="pill pill-conversion" title="_c=1 — conversion / key event">conversion</span>');
  if (f.externalEvent) out.push('<span class="pill pill-ee" title="_ee=1 — external event (created via GA4 configuration)">external</span>');
  if (f.sessionStart)  out.push('<span class="pill pill-event" title="_ss=1 — session start">session start</span>');
  if (f.firstVisit)    out.push('<span class="pill pill-event" title="_fv=1 — first visit">first visit</span>');
  if (f.epCount)       out.push(`<span class="pill pill-ep" title="${f.epCount} custom event parameter(s): ep.* / epn.*">ep ×${f.epCount}</span>`);
  return out.join('');
}

function consentPills(r) {
  const out = [];
  const stateClsConsent = (s) => s === 'granted' ? 'pill-consent-granted' : s === 'denied' ? 'pill-consent-denied' : 'pill-consent-unset';
  if (r.provider === 'meta') {
    if (r.consent && r.consent.ldu) {
      out.push('<span class="pill pill-consent-unset" title="Limited Data Use active (data_processing_options / dpo)">LDU</span>');
    }
    return out.join('');
  }
  if (r.provider === 'uet') {
    // Always shown — the absence of asc (unset) is itself meaningful.
    const s = r.consent ? r.consent.adStorage : 'unset';
    const label = s === 'unset' ? 'consent: unset' : `ad: ${s}`;
    const tip = 'Microsoft Consent Mode (asc): G=granted, D=denied, absent=unset';
    out.push(`<span class="pill ${stateClsConsent(s)}" title="${escapeHtml(tip)}">${escapeHtml(label)}</span>`);
    return out.join('');
  }
  const consent = r.consent;
  if (!consent) return '';
  const stateCls = (s) => s === 'granted' ? 'pill-consent-granted' : s === 'denied' ? 'pill-consent-denied' : 'pill-consent-unset';
  if (consent.adStorage)        out.push(`<span class="pill ${stateCls(consent.adStorage)}" title="ad_storage (gcs)">ad: ${escapeHtml(consent.adStorage)}</span>`);
  if (consent.analyticsStorage) out.push(`<span class="pill ${stateCls(consent.analyticsStorage)}" title="analytics_storage (gcs)">analytics: ${escapeHtml(consent.analyticsStorage)}</span>`);
  return out.join('');
}

function summaryPills(r) {
  const ids = r.identifiers;
  const parts = [];
  for (const key of ['email', 'phone', 'name', 'address']) {
    if (ids && ids[key]) parts.push(`${ids[key]}× ${key}`);
  }
  const pills = [];
  if (parts.length) {
    pills.push(`<span class="pill pill-ud" title="Identifiers found in user data">${escapeHtml(parts.join(' · '))}</span>`);
  }
  if (r.provider === 'meta') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Advanced matching present (hashed ud[...] tokens)">adv. matching</span>');
    }
  } else if (r.provider === 'uet') {
    if (r.flags && r.flags.enhancedConv) {
      pills.push('<span class="pill pill-em" title="Enhanced conversions present (hashed identifiers in pid)">enhanced conv.</span>');
    }
  } else if (r.em) {
    pills.push('<span class="pill pill-em" title="Request carries an em parameter (hashed enhanced-conversion identifiers)">em</span>');
  }
  return pills.join('');
}

// --- inline detail ---------------------------------------------------------

function paramRows(obj) {
  const keys = Object.keys(obj || {}).sort();
  if (!keys.length) return '';
  return keys.map(k => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(obj[k])}</td></tr>`).join('');
}

function kvTable(rows) {
  return `<table class="det-table">${
    rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
}

function section(title, inner) {
  return inner ? `<div class="det-section">${escapeHtml(title)}</div>${inner}` : '';
}

function metaUserDataSection(userData) {
  if (!userData) return '';
  // Show the masked shape (PII-free) plus whether a hash was actually sent.
  const rows = Object.values(userData).map((f) => {
    const shape = f.mask || f.normalizedMask || (f.hashed ? '(hashed only)' : '');
    const note = f.hashed ? ' · hashed' : '';
    return `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(shape)}${escapeHtml(note)}</td></tr>`;
  });
  return section('user data (advanced matching)', `<table class="det-table">${rows.join('')}</table>`);
}

function detailHtml(r) {
  let meta, extras = '';

  if (r.provider === 'meta') {
    meta = [
      ['event (ev)', r.ev], ['pixel id (id)', r.id],
      ['transport', r.transport], ['method', r.method],
      ['source lib (a)', r.sourceLib], ['event id (eid)', r.eid],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.consent) {
      const rows = [['Limited Data Use', r.consent.ldu ? 'active' : 'inactive']];
      if (r.consent.dpo != null)     rows.push(['dpo', r.consent.dpo]);
      if (r.consent.country != null) rows.push(['country (dpoco)', r.consent.country]);
      if (r.consent.state != null)   rows.push(['state (dpost)', r.consent.state]);
      extras += section('Consent', kvTable(rows));
    }
    extras += metaUserDataSection(r.userData);
    if (r.customData && Object.keys(r.customData).length) {
      extras += section('custom data (cd)', `<table class="det-table">${paramRows(r.customData)}</table>`);
    }
  } else if (r.provider === 'uet') {
    meta = [
      ['event type (evt)', r.evt], ['consent source (src)', r.src], ['UET tag id (ti)', r.ti],
      ['transport', r.transport], ['method', r.method],
      ['tag manager (tm)', r.tagManager], ['message id (mid)', r.mid],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    const evRows = [];
    if (r.ec != null) evRows.push(['category (ec)', r.ec]);
    if (r.ea != null) evRows.push(['action (ea)', r.ea]);
    if (r.el != null) evRows.push(['label (el)', r.el]);
    if (r.ev != null) evRows.push(['value (ev)', r.ev]);
    if (r.revenue)    evRows.push(['revenue (gv/gc)', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]);
    if (evRows.length) extras += section('Event', kvTable(evRows));

    if (r.ecommerce) extras += section('e-commerce', `<table class="det-table">${paramRows(r.ecommerce)}</table>`);

    // Consent is always shown — the absence of asc (unset) is meaningful.
    const cRows = [['ad_storage', (r.consent && r.consent.adStorage) || 'unset']];
    if (r.consent && r.consent.asc != null) cRows.push(['asc', r.consent.asc]);
    if (r.consent && r.consent.cdb != null) cRows.push(['cdb', r.consent.cdb]);
    extras += section('Consent', kvTable(cRows));

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw)'}</td></tr>`);
      extras += section('user data (enhanced conversions)', `<table class="det-table">${rows.join('')}</table>`);
    }
  } else {
    meta = [
      ['event (en)', r.en], ['measurement id (tid)', r.tid],
      ['transport', r.transport], ['method', r.method],
      ['request url', r.effectiveUrl],
      ['original (masked) url', r._originalUrl && r._originalUrl !== r.effectiveUrl ? r._originalUrl : null],
    ].filter(([, v]) => v != null && v !== '');

    if (r.consent) {
      const rows = [];
      if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
      if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
      if (Array.isArray(r.consent.gcdDecoded)) {
        for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
      }
      extras += section('Consent', kvTable(rows));
    }
    if (r.userData) {
      extras += section('user_data', kvTable([['parsed', JSON.stringify(r.userData)]]));
    }
  }

  const qSection = section('Query parameters', `<table class="det-table">${paramRows(r.queryParams)}</table>`);
  const bSection = (r.bodyParams && Object.keys(r.bodyParams).length)
    ? section('Body parameters', `<table class="det-table">${paramRows(r.bodyParams)}</table>`) : '';

  return `<div class="ev-detail" hidden>
    ${kvTable(meta)}
    ${extras}${qSection}${bSection}
  </div>`;
}

// --- filtering (the "out" side) --------------------------------------------

function buildSearchText(r) {
  const bits = [r.provider, eventName(r), accountId(r), r.host, docLocation(r)];
  for (const o of [r.queryParams, r.bodyParams]) {
    if (o) for (const [k, v] of Object.entries(o)) { bits.push(k); bits.push(v); }
  }
  return bits.filter(Boolean).join(' ').toLowerCase();
}

function cardMatchesFilter(r) {
  if (!state.filter[r.provider]) return false;
  const t = state.filter.text.trim().toLowerCase();
  if (t && !(r._search || '').includes(t)) return false;
  return true;
}

function applyCardVisibility(r) {
  if (r._el) r._el.hidden = !cardMatchesFilter(r);
}

// Re-apply the filter to all cards. A block with events but none visible is
// hidden; an empty block (fresh navigation marker) stays visible.
function applyFilter() {
  for (const block of state.blocks) {
    let anyVisible = false;
    for (const r of block.events) {
      const visible = cardMatchesFilter(r);
      if (r._el) r._el.hidden = !visible;
      if (visible) anyVisible = true;
    }
    if (block._el) block._el.hidden = block.events.length > 0 && !anyVisible;
  }
}

// --- DOM building (incremental, preserves expanded state) ------------------

function blockHeadHtml(block) {
  return `<span class="blk-time">${escapeHtml(formatTime(new Date(block.navTime)))}</span>${
    escapeHtml(block.navUrl || '(current page)')}`;
}

function appendBlockDom(block) {
  const el = document.createElement('div');
  el.className = 'blk';
  const head = document.createElement('div');
  head.className = 'blk-head';
  head.innerHTML = blockHeadHtml(block);
  const events = document.createElement('div');
  events.className = 'blk-events';
  el.append(head, events);
  blocksEl.appendChild(el);
  block._el = el;
  block._headEl = head;
  block._eventsEl = events;
}

// Backfill the URL of a block that was opened before onNavigated fired (so its
// title shows the real page instead of the "(current page)" placeholder).
function setBlockUrl(block, url) {
  if (!url || block.navUrl) return;
  block.navUrl = url;
  if (block._headEl) block._headEl.innerHTML = blockHeadHtml(block);
}

// Resolve the inspected page's real URL straight from the page context — works
// for any provider (Meta, Bing, …) and doesn't depend on a tracking parameter
// like dl ever being present.
function resolveCurrentPageUrl(block) {
  try {
    chrome.devtools.inspectedWindow.eval('location.href', (result, err) => {
      if (!err && typeof result === 'string') setBlockUrl(block, result);
    });
  } catch (e) { /* eval unavailable — leave the placeholder */ }
}

function appendEventDom(block, r) {
  const dl = docLocation(r);
  const idChip = accountId(r);
  const idTitle = accountTitle(r);
  const card = document.createElement('div');
  card.className = `ev p-${r.provider} t-${r.transport}`;
  card.innerHTML = `
    <div class="ev-head">
      <span class="ev-time">${escapeHtml(formatTime(new Date(r._ts)))}</span>
      <span class="ev-method">${escapeHtml(r.method)}</span>
      ${idChip ? `<span class="ev-tid" title="${escapeHtml(idTitle)}">${escapeHtml(idChip)}</span>` : ''}
      <span class="ev-caret" title="Show all parameters">▼</span>
    </div>
    <div class="ev-name">${escapeHtml(eventName(r) || '(no event name)')}</div>
    ${dl ? `<div class="ev-dl" title="document location (dl)">${escapeHtml(dl)}</div>` : ''}
    <div class="ev-pills">${providerPills(r)}${flagPills(r)}${consentPills(r)}</div>
    ${summaryPills(r) ? `<div class="ev-summary">${summaryPills(r)}</div>` : ''}
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
  r._el = card;
  applyCardVisibility(r);
}

function renderStatus() {
  recCount.textContent = `${totalEvents()} events / ${state.blocks.length} pages`;
  recDot.classList.toggle('live', state.recording);
  recordBtn.textContent = state.recording ? 'Stop' : 'Start & Reload';
  recordBtn.classList.toggle('recording', state.recording);
  emptyEl.hidden = state.blocks.length > 0;
}

// --- capture (the "in" side) -----------------------------------------------

function startBlock(navUrl) {
  const block = { navUrl, navTime: Date.now(), events: [] };
  state.blocks.push(block);
  appendBlockDom(block);
  if (!navUrl) resolveCurrentPageUrl(block);   // opened pre-onNavigated: get the real URL
  return block;
}

function currentBlock() {
  return state.blocks.length ? state.blocks[state.blocks.length - 1] : startBlock(null);
}

function parseRequest(url, postData) {
  for (const p of PARSERS) {
    if (!state.record[p.id]) continue;          // service capture switched off
    const r = p.parse(url, postData);
    if (r) return r;
  }
  return null;
}

function onRequest(harEntry) {
  if (!state.recording) return;
  const req = harEntry && harEntry.request;
  if (!req || !req.url) return;
  const r = parseRequest(req.url, req.postData);
  if (!r) return;
  r.method = req.method || r.method;
  r._originalUrl = req.url;
  r._ts = harEntry.startedDateTime ? new Date(harEntry.startedDateTime).getTime() : Date.now();
  r._search = buildSearchText(r);
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

// Record settings ("in"): collapsible, toggles which services are captured.
const settingsEl = document.getElementById('settings');
const settingsBtn = document.getElementById('settingsBtn');
settingsBtn.addEventListener('click', () => {
  settingsEl.hidden = !settingsEl.hidden;
  settingsBtn.classList.toggle('active', !settingsEl.hidden);
});
for (const cb of document.querySelectorAll('input[data-rec]')) {
  cb.addEventListener('change', () => { state.record[cb.dataset.rec] = cb.checked; });
}

// Display filter ("out"): independent of capture — hides cards without dropping
// the captured data, so unchecking and re-checking brings them straight back.
for (const cb of document.querySelectorAll('input[data-flt]')) {
  cb.addEventListener('change', () => { state.filter[cb.dataset.flt] = cb.checked; applyFilter(); });
}
document.getElementById('filterText').addEventListener('input', (e) => {
  state.filter.text = e.target.value;
  applyFilter();
});

renderStatus();
