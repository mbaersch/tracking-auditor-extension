# LinkedIn `/wa/` Enhanced-Conversions Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the LinkedIn Insight Tag `/wa/` POST (a `base64(gzip(JSON))` body carrying the hashed email `hem`, `signalType`, and LinkedIn ad-tracking ids) and surface it as its own card, without breaking the synchronous parser contract every other provider relies on.

**Architecture:** The synchronous parser registry stays untouched; `/collect` is still parsed by `parseLinkedInRequest`. A new async function `parseLinkedInWaRequest` decodes the `/wa/` body with `DecompressionStream('gzip')` and is wired into `panel.js` on a dedicated async side-path in `onRequest`. Each `/wa/` signal becomes its own LinkedIn card, deduplicated by `websiteSignalRequestId`.

**Tech Stack:** Vanilla ES modules, Chrome DevTools Network API (`chrome.devtools.network.onRequestFinished`), Web Streams (`DecompressionStream`), `node:test` for unit tests. No new runtime dependencies.

## Global Constraints

- **Synchronous parser contract is inviolable.** The `PARSERS` registry and `parseRequest` loop (`panel.js:720-727`) call `p.parse(url, postData)` without `await`. No parser in the registry may return a Promise. The `/wa/` async path lives OUTSIDE the registry.
- **Streaming/async decode only.** The `/wa/` body must be decoded with `DecompressionStream('gzip')` (async), never a synchronous buffered gunzip — this matches the global streaming rule and is the reason for the side-path.
- **Real fixtures only.** Tests decode the actual `/wa/` bodies captured in `linkedin.har`, never hand-fabricated guesses. `linkedin.har` is present in the repo root at implementation time.
- **PII is driven by `hem` presence, never by `signalType`.** Any signal type can carry a `hem`; `PAGE_VISIT` in the fixture only lacks one because it fired before `lintrk('setUserData')`.
- **No hash validation.** The auditor surfaces that data flows; `hem` is marked `hashed: true`, its correctness is not checked.
- **Pure modules stay pure.** `lib/*.js` must run under `node --test` (no DOM / chrome APIs). `DecompressionStream`, `Response`, `TextDecoder`, `atob` are all global in Node 18+ and in the panel — allowed.
- **Test runner:** `node --test` (from `package.json`).

---

## File Structure

- `lib/linkedin.js` (modify) — add `isLinkedInWaRequest`, `parseLinkedInWaRequest`, decode helpers `base64ToBytes`/`gunzipToText`; add `_endpoint: 'collect'` to the existing record; rewrite the header comment block.
- `tests/fixtures/linkedin-wa-bodies.js` (create) — the real `/wa/` bodies (base64 text) extracted verbatim from `linkedin.har`.
- `tests/linkedin.test.js` (modify) — add async `/wa/` tests; fix the stale comment on the ignored-endpoint test.
- `panel.js` (modify) — import the new functions; extract `commitRecord`; add the async side-path in `onRequest`; extend `flagPills`, `summaryPills`, `detailHtml` for `/wa/`.
- `panel.html` (modify) — add `.det-dump` CSS rule for the full-payload `<pre>`.
- `README.md` (modify) — one line documenting the `/wa/` capture.

---

## Task 1: Async `/wa/` parser, decode helpers, and real fixtures

**Files:**
- Modify: `lib/linkedin.js` (add exports after `parseLinkedInRequest`; add `_endpoint: 'collect'` to its return; rewrite comment `lib/linkedin.js:14-34`)
- Create: `tests/fixtures/linkedin-wa-bodies.js`
- Test: `tests/linkedin.test.js`

**Interfaces:**
- Produces:
  - `isLinkedInWaRequest(url: string): boolean` — true iff host matches `ads.linkedin.com` and pathname matches `/wa/`.
  - `parseLinkedInWaRequest(url: string, postData: string | {text?: string} | null): Promise<record | null>` — resolves to a normalized LinkedIn record (`provider:'linkedin'`, `_endpoint:'wa'`, `method:'POST'`, `signalType`, `hem`, `identifiers`, `userData`, `flags`, `liFatId`, `liGiant`, `waPayload`, `_collapseKey`, `_transportLabel`, `_transportRank`) or `null` on any decode failure / non-LinkedIn / non-`/wa/` input.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Generate the fixture from the real HAR**

Run this one-shot extractor (reads `linkedin.har`, writes the fixture). `text[1]===text[2]` for the two identical CLICK fires, so we store PAGE_VISIT + one CLICK.

```bash
node -e '
const fs=require("fs");
const har=JSON.parse(fs.readFileSync("./linkedin.har","utf8"));
const wa=har.log.entries.filter(e=>{try{return /\/wa(\/|$)/.test(new URL(e.request.url).pathname)&&e.request.postData&&e.request.postData.text}catch{return false}});
const zlib=require("zlib");
const byType={};
for(const e of wa){const t=e.request.postData.text.trim();const j=JSON.parse(zlib.gunzipSync(Buffer.from(t,"base64")).toString());byType[j.signalType]=t;}
const out=`// Real LinkedIn Insight Tag /wa/ POST bodies (base64(gzip(JSON))) captured on\n`+
`// atomkraftwerke24.de, extracted verbatim from linkedin.har. Decoded live by the\n`+
`// tests so the base64 -> gzip -> JSON path is exercised end-to-end.\n`+
`//\n`+
`// WA_PAGE_VISIT: signalType PAGE_VISIT, hem null (fired before lintrk setUserData).\n`+
`// WA_CLICK:      signalType CLICK, hem present (SHA-256 email), rich domAttributes.\n\n`+
`export const WA_PAGE_VISIT = ${JSON.stringify(byType.PAGE_VISIT)};\n\n`+
`export const WA_CLICK = ${JSON.stringify(byType.CLICK)};\n`;
fs.mkdirSync("tests/fixtures",{recursive:true});
fs.writeFileSync("tests/fixtures/linkedin-wa-bodies.js",out);
console.log("wrote tests/fixtures/linkedin-wa-bodies.js");
'
```

Expected: `wrote tests/fixtures/linkedin-wa-bodies.js`, and the file exports two `H4sI…` base64 strings.

- [ ] **Step 2: Write the failing tests**

Append to `tests/linkedin.test.js`:

```javascript
import { parseLinkedInWaRequest, isLinkedInWaRequest } from '../lib/linkedin.js';
import { WA_PAGE_VISIT, WA_CLICK } from './fixtures/linkedin-wa-bodies.js';
import { gzipSync } from 'node:zlib';

const WA_URL = 'https://px.ads.linkedin.com/wa/';

test('wa detection: host + /wa/ path only', () => {
  assert.equal(isLinkedInWaRequest(WA_URL), true);
  assert.equal(isLinkedInWaRequest('https://px.ads.linkedin.com/collect?pid=1'), false);
  assert.equal(isLinkedInWaRequest('https://ct.pinterest.com/wa/'), false);
});

test('real /wa/ PAGE_VISIT: decoded, no hem, no PII', async () => {
  const r = await parseLinkedInWaRequest(WA_URL, { text: WA_PAGE_VISIT });
  assert.ok(r, 'should decode the /wa/ page-visit body');
  assert.equal(r.provider, 'linkedin');
  assert.equal(r._endpoint, 'wa');
  assert.equal(r.method, 'POST');
  assert.equal(r.signalType, 'PAGE_VISIT');
  assert.equal(r.eventName, 'PAGE_VISIT');
  assert.equal(r.pid, '12345678');
  assert.equal(r.hem, null);
  assert.equal(r.userData, null);
  assert.equal(r.flags.hashedEmail, false);
  assert.equal(r.flags.liFat, false);
  assert.deepEqual(r.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
  assert.equal(r.pageTitle, 'Enhanced Conversions Testseite');
  assert.equal(r._collapseKey, 'li-wa:a8b241ae-049f-6e40-7585-1466dc162595');
  assert.equal(r._transportLabel, 'px');
});

test('real /wa/ CLICK: hem present → email identifier + PII flag', async () => {
  const r = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  assert.ok(r);
  assert.equal(r.signalType, 'CLICK');
  assert.equal(r.eventName, 'CLICK');
  assert.equal(r.hem, '8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa');
  assert.equal(r.identifiers.email, 1);
  assert.equal(r.flags.hashedEmail, true);
  assert.ok(r.userData && r.userData.email && r.userData.email.hashed === true);
  assert.equal(r.waPayload.domAttributes.innerText, 'Absenden');
  assert.equal(r.waPayload.domAttributes.isFormSubmission, true);
  assert.equal(r._collapseKey, 'li-wa:465b5ae1-4213-c38b-d548-6c98d71b7a1e');
});

test('duplicate /wa/ fires collapse: same websiteSignalRequestId → same key', async () => {
  const a = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  const b = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  assert.equal(a._collapseKey, b._collapseKey);
});

test('liFatId, when present, is surfaced and flagged', async () => {
  const body = { pids: [12345678], signalType: 'PAGE_VISIT', hem: null,
                 url: 'https://x.test/', pageTitle: 'x', time: 1, scriptVersion: 308,
                 websiteSignalRequestId: 'w-1', liFatId: 'abc123', liGiant: '' };
  const text = Buffer.from(gzipSync(Buffer.from(JSON.stringify(body)))).toString('base64');
  const r = await parseLinkedInWaRequest(WA_URL, { text });
  assert.equal(r.liFatId, 'abc123');
  assert.equal(r.flags.liFat, true);
});

test('/wa/ decode failures return null, never throw', async () => {
  assert.equal(await parseLinkedInWaRequest(WA_URL, { text: '' }), null);
  assert.equal(await parseLinkedInWaRequest(WA_URL, { text: 'not-base64-gzip!!' }), null);
  assert.equal(await parseLinkedInWaRequest(WA_URL, null), null);
  assert.equal(await parseLinkedInWaRequest('https://ct.pinterest.com/wa/', { text: WA_CLICK }), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/linkedin.test.js`
Expected: FAIL — `parseLinkedInWaRequest`/`isLinkedInWaRequest` are not exported (`SyntaxError` or `is not a function`).

- [ ] **Step 4: Implement the decode helpers and parser in `lib/linkedin.js`**

Add at the end of `lib/linkedin.js` (after `parseLinkedInRequest`):

```javascript
// ---------------------------------------------------------------------------
// /wa/ enhanced-conversions (async side-path)
// ---------------------------------------------------------------------------

// base64 text → raw bytes, and gzip bytes → text (async, via DecompressionStream —
// global in both the panel and Node 18+). The /wa/ body is base64(gzip(JSON)).
function base64ToBytes(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

async function gunzipToText(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}

// Synchronous guard: is this a LinkedIn /wa/ request? (used by the panel before
// it commits to the async decode path).
export function isLinkedInWaRequest(url) {
  try {
    const u = new URL(url);
    return isLinkedInHost(u.host) && /\/wa(\/|$)/.test(u.pathname);
  } catch (e) { return false; }
}

// Async parse of the /wa/ POST. Resolves to a normalized record (same shape as the
// /collect record so panel rendering stays uniform) or null on any failure. hem is
// the SHA-256 of the lower-cased email; present on ANY signalType once user data
// has been set, null otherwise. Never throws.
export async function parseLinkedInWaRequest(url, postData) {
  let host = '', pathname = '';
  try { const u = new URL(url); host = u.host; pathname = u.pathname; }
  catch (e) { return null; }
  if (!isLinkedInHost(host) || !/\/wa(\/|$)/.test(pathname)) return null;

  const text = typeof postData === 'string' ? postData : (postData && postData.text) || '';
  if (!text) return null;

  let json;
  try { json = JSON.parse(await gunzipToText(base64ToBytes(text.trim()))); }
  catch (e) { return null; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;

  const pids = Array.isArray(json.pids) ? json.pids : [];
  const pid = pids.length ? String(pids[0]) : null;
  const signalType = json.signalType != null ? String(json.signalType) : null;
  const hem = (typeof json.hem === 'string' && json.hem.trim() !== '') ? json.hem.trim() : null;
  const liFatId = json.liFatId || null;
  const liGiant = json.liGiant || null;
  const hasEmail = !!hem;

  return {
    provider: 'linkedin',
    transport: 'standard',
    host,
    pathname,
    effectiveUrl: url,
    effectivePath: pathname,
    method: 'POST',
    pid,
    conversionId: null,
    eventName: signalType || 'Signal',
    isConversion: false,
    signalType,
    pageUrl: json.url || null,
    pageTitle: json.pageTitle || null,
    tagManager: null,
    version: json.scriptVersion != null ? String(json.scriptVersion) : null,
    ipHash: null,
    time: json.time != null ? String(json.time) : null,
    hem,
    liFatId,
    liGiant,
    userData: hasEmail ? { email: { label: 'Email', hashed: true } } : null,
    identifiers: { email: hasEmail ? 1 : 0, phone: 0, name: 0, address: 0 },
    consent: null,
    flags: {
      signal: signalType,
      hashedEmail: hasEmail,
      liFat: !!(liFatId || liGiant),
    },
    waPayload: json,
    queryParams: {},
    bodyParams: {},
    _endpoint: 'wa',
    _collapseKey: json.websiteSignalRequestId ? ('li-wa:' + json.websiteSignalRequestId) : null,
    _transportLabel: subdomainLabel(host),
    _transportRank: 100,
  };
}
```

- [ ] **Step 5: Tag the `/collect` record so the panel can tell them apart**

In `parseLinkedInRequest`'s returned object (`lib/linkedin.js`, in the `return { … }` around line 88), add a line next to `transport: 'standard',`:

```javascript
    provider: 'linkedin',
    transport: 'standard',
    _endpoint: 'collect',
```

- [ ] **Step 6: Rewrite the header comment block**

Replace `lib/linkedin.js:14-34` (the "Two neighbouring endpoints are intentionally ignored…" paragraph through the end of the `NOTE (2026-07-04)` block) with:

```javascript
// One neighbouring endpoint is intentionally ignored by the synchronous parser:
// `/attribution_trigger` (pid/time/url only — a redundant duplicate of the collect
// signal).
//
// The `/wa/` endpoint IS captured, but NOT by the synchronous parser below: its
// body is `base64(gzip(JSON))` and decoding needs an async `DecompressionStream`,
// which would break the synchronous contract the other providers rely on. It is
// handled by `parseLinkedInWaRequest` (async, exported separately) and wired into
// the panel on a side-path. The /wa/ JSON is the ONLY place LinkedIn's enhanced-
// conversions PII leaves the browser — it carries `hem` (SHA-256 of the lower-cased
// email; present on ANY signalType once `lintrk('setUserData')` has run, null
// otherwise), `pids`, `signalType` (PAGE_VISIT | CLICK | …), page context
// (url/pageTitle), the clicked element on interaction signals (domAttributes /
// elementCrumbsTree), and LinkedIn's first-party ad-tracking ids (liFatId/liGiant).
// The /collect beacon carries no user identifiers.
```

- [ ] **Step 7: Fix the stale comment in the existing ignored-endpoint test**

In `tests/linkedin.test.js` (around lines 77-79), the test still parses `/wa/` through the SYNC parser and expects `null` — that stays true (the sync parser only owns `/collect`). Only update the comment:

```javascript
  // /attribution_trigger has no per-hit event distinction → ignored. /wa/ is NOT
  // handled by the sync parser (it needs async gzip decode via parseLinkedInWaRequest),
  // so the sync parser correctly returns null here too.
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/attribution_trigger?pid=12345678&time=1', null), null);
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/wa/?medium=fetch&fmt=g', 'gzip-blob'), null);
```

- [ ] **Step 8: Run the full test file to verify it passes**

Run: `node --test tests/linkedin.test.js`
Expected: PASS — all existing `/collect` tests plus the 6 new `/wa/` tests green.

- [ ] **Step 9: Commit**

```bash
git add lib/linkedin.js tests/linkedin.test.js tests/fixtures/linkedin-wa-bodies.js
git commit -m "feat(linkedin): async parser for /wa/ enhanced-conversions body

Decodes the base64(gzip(JSON)) /wa/ POST via DecompressionStream and
surfaces hem, signalType and liFatId/liGiant. Sync /collect parser
unchanged; tests decode real bodies from linkedin.har end-to-end."
```

---

## Task 2: Wire the async side-path into the panel capture pipeline

**Files:**
- Modify: `panel.js` (imports at top; extract `commitRecord`; rewrite `onRequest` `panel.js:729-754`)

**Interfaces:**
- Consumes: `isLinkedInWaRequest`, `parseLinkedInWaRequest` from `lib/linkedin.js` (Task 1).
- Produces: `commitRecord(block, r, req, ts)` — stamps `method`/`_originalUrl`/`_ts`/`_search`, runs transport-collapse, appends the card. Shared by the sync and async capture paths.

> No unit-test harness exists for `panel.js` (it is DevTools/DOM code). Verification is manual against the live LinkedIn test page — see Step 4.

- [ ] **Step 1: Import the new functions**

Change `panel.js:10`:

```javascript
import { parseLinkedInRequest, isLinkedInWaRequest, parseLinkedInWaRequest } from './lib/linkedin.js';
```

- [ ] **Step 2: Extract `commitRecord` and add the async side-path**

Replace `onRequest` (`panel.js:729-754`) with:

```javascript
function onRequest(harEntry) {
  if (!state.recording) return;
  const req = harEntry && harEntry.request;
  if (!req || !req.url) return;
  const ts = harEntry.startedDateTime ? new Date(harEntry.startedDateTime).getTime() : Date.now();
  const r = parseRequest(req.url, req.postData);
  if (r) { commitRecord(currentBlock(), r, req, ts); return; }
  // Async side-path: the LinkedIn /wa/ POST is base64(gzip(JSON)) and needs an
  // async DecompressionStream, so it can't ride the synchronous parser registry.
  // onRequestFinished listeners are fire-and-forget, so awaiting here is safe; the
  // block is resolved when the decode settles (it takes ~ms).
  if (state.record.linkedin && isLinkedInWaRequest(req.url)) {
    parseLinkedInWaRequest(req.url, req.postData)
      .then(rec => { if (rec) commitRecord(currentBlock(), rec, req, ts); })
      .catch(() => {});
  }
}

// Stamp, transport-collapse and append a parsed record. Shared by the synchronous
// registry path and the async LinkedIn /wa/ path.
function commitRecord(block, r, req, ts) {
  r.method = req.method || r.method;
  r._originalUrl = req.url;
  r._ts = ts;
  r._search = buildSearchText(r);
  // Generic transport-collapse: records carrying a _collapseKey fold every
  // transport mirror / duplicate fire of one logical hit into a single card.
  if (r._collapseKey) {
    const map = block._collapse || (block._collapse = new Map());
    const existing = map.get(r._collapseKey);
    if (existing) { mergeTransport(existing, r); renderStatus(); return; }
    map.set(r._collapseKey, r);
    r._transports = r._transportLabel ? [r._transportLabel] : [];
  }
  block.events.push(r);
  appendEventDom(block, r);
  renderStatus();
  maybeAutoScroll();
}
```

- [ ] **Step 3: Run the existing test suite (no regressions)**

Run: `node --test`
Expected: PASS — all provider tests still green (this task doesn't touch parsers).

- [ ] **Step 4: Manual verification — cards appear**

1. Load the extension unpacked (`chrome://extensions` → Load unpacked → repo root).
2. Open DevTools → **Tracking Auditor** panel on `https://atomkraftwerke24.de/ectest.html`.
3. Click **Start & Reload**. Confirm a LinkedIn **PAGE_VISIT** card appears (event `PAGE_VISIT`, partner id `12345678`) in addition to the `/collect` PageView card.
4. Submit the form on the page (fires the CLICK `/wa/` with `hem`). Confirm a LinkedIn **CLICK** card appears carrying a `1× email` summary pill.
5. Confirm the two identical CLICK fires collapse into ONE card (not two).

Expected: two new `/wa/` cards (PAGE_VISIT, CLICK); CLICK shows the email identifier; duplicates are collapsed. (Rendering polish — pills/flags/detail — lands in Task 3; here just confirm capture + basic card.)

- [ ] **Step 5: Commit**

```bash
git add panel.js
git commit -m "feat(panel): capture LinkedIn /wa/ via async side-path

Extracts commitRecord (shared by sync + async paths) and dispatches
LinkedIn /wa/ POSTs to the async parser without blocking onRequest."
```

---

## Task 3: Render the `/wa/` card (pills, PII/li_fat flags, full payload dump)

**Files:**
- Modify: `panel.js` — `flagPills` (linkedin branch `panel.js:224-229`), `summaryPills` (`panel.js:294-300`), `detailHtml` (linkedin branch `panel.js:525-539`)
- Modify: `panel.html` — add `.det-dump` CSS near `panel.html:161`

**Interfaces:**
- Consumes: the `/wa/` record fields from Task 1 (`_endpoint`, `signalType`, `flags.hashedEmail`, `flags.liFat`, `flags.signal`, `userData`, `liFatId`, `liGiant`, `waPayload`).
- Produces: no new functions.

> Verification is manual (DOM rendering) — see Step 5.

- [ ] **Step 1: Extend `flagPills` for `/wa/`**

Replace the linkedin branch (`panel.js:224-229`) with:

```javascript
  if (r.provider === 'linkedin') {
    const f = r.flags || {};
    if (r._endpoint === 'wa') {
      if (f.signal)      out.push(`<span class="pill pill-event" title="signalType — the LinkedIn /wa/ signal">${escapeHtml(f.signal)}</span>`);
      if (f.hashedEmail) out.push('<span class="pill pill-em" title="hem — SHA-256 of the email, sent in the /wa/ body (enhanced conversions PII)">hashed email</span>');
      if (f.liFat)       out.push('<span class="pill pill-ud" title="liFatId / liGiant — LinkedIn first-party ad-tracking id">li_fat</span>');
      if (r._transports && r._transports.length > 1) {
        out.push(`<span class="pill pill-ud" title="duplicate fires folded into this card: ${escapeHtml(r._transports.join(' · '))}">×${r._transports.length} transports</span>`);
      }
      return out.join('');
    }
    if (f.conversion) out.push(`<span class="pill pill-conversion" title="conversionId — the LinkedIn conversion rule id">conv id: ${escapeHtml(r.conversionId)}</span>`);
    if (f.ipHash)     out.push('<span class="pill pill-em" title="e_ipv6 — encrypted client IP (sent to the px4 mirror)">IP hash</span>');
    return out.join('');
  }
```

- [ ] **Step 2: Add the enhanced-conversions summary pill for `/wa/`**

In `summaryPills`, the generic `identifiers.email` pill already renders. Add a linkedin branch alongside the other providers (after the `googleads` branch, `panel.js:294-297`, before the `else if (r.em)` at `panel.js:298`):

```javascript
  } else if (r.provider === 'linkedin') {
    if (r.flags && r.flags.hashedEmail) {
      pills.push('<span class="pill pill-em" title="Enhanced conversions: hashed email (hem) sent in the /wa/ body">enhanced conv.</span>');
    }
  } else if (r.em) {
```

- [ ] **Step 3: Render the `/wa/` detail branch with the full payload dump**

Replace the linkedin branch in `detailHtml` (`panel.js:525-539`) with a `/wa/` sub-branch plus the unchanged `/collect` branch:

```javascript
  } else if (r.provider === 'linkedin' && r._endpoint === 'wa') {
    meta = [
      ['signal type', r.signalType], ['partner id (pid)', r.pid],
      ['page title', r.pageTitle], ['page url', r.pageUrl],
      ['transport', r.transport], ['method', r.method],
      ['version (scriptVersion)', r.version], ['time', r.time],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / plain)'}</td></tr>`);
      extras += section('enhanced conversions (hem)', `<table class="det-table">${rows.join('')}</table>`);
    }
    if (r.liFatId || r.liGiant) {
      const rows = [];
      if (r.liFatId) rows.push(['liFatId', r.liFatId]);
      if (r.liGiant) rows.push(['liGiant', r.liGiant]);
      extras += section('LinkedIn ad-tracking ids', kvTable(rows));
    }
    if (r._transports && r._transports.length > 1) {
      extras += section(`transports (${r._transports.length})`, kvTable([['fires', r._transports.join(' · ')]]));
    }
    if (r.waPayload) {
      extras += section('full decoded payload',
        `<pre class="det-dump">${escapeHtml(JSON.stringify(r.waPayload, null, 2))}</pre>`);
    }
  } else if (r.provider === 'linkedin') {
    meta = [
      ['event', r.eventName], ['partner id (pid)', r.pid],
      ['conversion id', r.conversionId],
      ['transport', r.transport], ['method', r.method],
      ['tag manager (tm)', r.tagManager], ['version (v)', r.version],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r._transports && r._transports.length) {
      extras += section(`transports (${r._transports.length})`, kvTable([['mirrors', r._transports.join(' · ')]]));
    }
    if (r.ipHash) {
      extras += section('encrypted IP (e_ipv6)', kvTable([['e_ipv6', r.ipHash]]));
    }
  } else {
```

- [ ] **Step 4: Add the `.det-dump` CSS rule**

In `panel.html`, after `panel.html:161` (the `.det-section` rule), add:

```css
    .det-dump { font-size: 10px; font-family: 'Fira Code', 'Consolas', monospace; white-space: pre-wrap; word-break: break-word; overflow-x: auto; max-width: 100%; margin: 2px 0 0; padding: 6px; background: rgba(127,127,127,0.08); border-radius: 4px; }
```

- [ ] **Step 5: Manual verification — rendering**

Repeat the capture from Task 2 Step 4 on `https://atomkraftwerke24.de/ectest.html`, then:
1. **PAGE_VISIT card:** shows a `PAGE_VISIT` signal pill, NO "hashed email" pill, NO `li_fat` pill.
2. **CLICK card:** shows `CLICK` signal pill + `hashed email` (blue `pill-em`) pill + `enhanced conv.` summary pill + `1× email` identifier pill.
3. Expand the CLICK card → detail shows the meta table (signal type, pid, page title, url…), an `enhanced conversions (hem)` row (`Email → hashed`), and a **full decoded payload** `<pre>` containing `domAttributes`, `elementCrumbsTree`, `misc`, etc., wrapping without horizontal page scroll.
4. Collapsed duplicate CLICK shows `×2 transports`.

- [ ] **Step 6: Commit**

```bash
git add panel.js panel.html
git commit -m "feat(panel): render LinkedIn /wa/ card — PII/signal/li_fat pills + payload dump"
```

---

## Task 4: Documentation and full verification

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add a README line**

In `README.md`, in the LinkedIn provider description, add:

```markdown
LinkedIn's hashed email (`hem`, SHA-256) does not ride in the `/collect` beacon — it travels in a `base64(gzip(JSON))` `/wa/` POST body, decoded asynchronously (via `DecompressionStream`) into its own card. The card surfaces the `signalType`, the hashed email as a PII indicator, LinkedIn's first-party ad-tracking ids (`liFatId`/`liGiant`) when present, and the full decoded payload.
```

- [ ] **Step 2: Run the full test suite**

Run: `node --test`
Expected: PASS — every provider test file green, including the 6 new `/wa/` tests.

- [ ] **Step 3: Final manual smoke test**

Reload the unpacked extension, capture once more on `https://atomkraftwerke24.de/ectest.html`, and confirm `/collect` cards (PageView/Conversion) AND `/wa/` cards (PAGE_VISIT/CLICK) coexist correctly, with the text filter matching `/wa/` cards by `signalType`, `pid` and page url.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe LinkedIn /wa/ enhanced-conversions capture"
```

---

## Self-Review

**Spec coverage:**
- Async side-path (sync contract intact) → Task 1 (parser outside registry) + Task 2 (side-path in `onRequest`). ✓
- `isLinkedInWaRequest` + `parseLinkedInWaRequest` + decode helpers → Task 1 Step 4. ✓
- Record shape incl. `hem`/`liFatId`/`liGiant`/`signalType`/`waPayload`/`_endpoint` → Task 1 Step 4. ✓
- PII driven by `hem` presence, not `signalType` → Task 1 (`hasEmail`), asserted by PAGE_VISIT(no hem)/CLICK(hem) tests. ✓
- Own card per signal + dedup via `websiteSignalRequestId` → `_collapseKey` (Task 1) + `commitRecord` collapse (Task 2), dedup test. ✓
- All `/wa/` signals surfaced (not only PII) → PAGE_VISIT card is captured (Task 2 Step 4). ✓
- Full payload dump + li_fat highlighted + PII pill → Task 3. ✓
- Real fixtures decoded end-to-end → Task 1 Step 1-2 (fixture from `linkedin.har`). ✓
- Comment/README doc updates → Task 1 Step 6, Task 4 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `parseLinkedInWaRequest`/`isLinkedInWaRequest` signatures match between Task 1 (produced) and Task 2 (consumed). `commitRecord(block, r, req, ts)` defined and called consistently in Task 2. Record fields used in Task 3 (`_endpoint`, `flags.hashedEmail`, `flags.signal`, `flags.liFat`, `userData`, `liFatId`, `liGiant`, `waPayload`) all match Task 1's returned object. ✓
