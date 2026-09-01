import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOpenAiRequest, isOpenAiPixelHost, isOpenAiSdkHost,
  flattenUserData, formatMinorAmount,
} from '../lib/openai.js';

// Real hits from the capture bench (test-pages/openai-pixel.html) against a live
// pixel, driven headlessly through the actual oaiq SDK 0.1.32 — not reconstructed
// from the docs. Four scenarios are baked in below:
//   1. first batch of a page load (sdk_init + diagnostic + page_viewed)
//   2. a conversion with contents, a site-supplied event_id, and both user
//      sources populated (init identity + a second identity picked up by
//      Automatic Advanced Matching)
//   3. an opt_out event
//   4. a consent-denied session: stripped body, diagnostic only
// The identifiers are the shared known-plaintext test set (test@example.com /
// 491701234567 / max / mustermann), so the sibling ec-data-validator can reuse
// these fixtures for hash validation.

const PID = 'S6i2zvvbTXxj5gR64Szf6a';
const url = (ec, t = 1788253083550) =>
  `https://bzr.openai.com/v1/sdk/events?pid=${PID}&st=oaiq-web&sv=0.1.32&t=${t}&ec=${ec}`;

const USER_IN = {
  eid: 'aa5a93cf07de607a273a4afa568503645adb45525e8687add86b7f4b30ea36d2',
  co: 'DE', ct: 'Hamburg', rg: 'Hamburg', pc: '20095',
  em: '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b',
  ph: '8b47a52ed04d068c3a9c5632b98cec18780a9f9f4099d4f8afe233970ce116fe',
  fn: '9baf3a40312f39849f46dad1040f2f039f1cffa1238c41e9db675315cfad39b6',
  ln: 'e32a370b7912ad78cc6a88fda605a5b3657e9c3b164cee669364aaf3f8cdbb36',
};
// Scraped from the page's form by Automatic Advanced Matching — em/ph arrive as
// arrays here, unlike the single values of the init block.
const USER_FM = {
  em: ['6d91ea2f7e0eea059183972f9d6fe225ee7d4248e4281f1ce5a90e33f25448b6'],
  ph: ['9f7f64353347eba16dbdf59da66e3cdd3f0bf948d5ff64f77a589026f4c0a271'],
  pc: '10115',
};

const ITEMS = [
  { id: 'SKU-A12', name: 'Blue Widget', content_type: 'product', quantity: 1, amount: 4999, currency: 'EUR' },
  { id: 'SKU-B20', name: 'Red Gadget', content_type: 'product', quantity: 2, amount: 3749, currency: 'EUR' },
];

const PAGE = 'http://localhost:8787/openai-pixel.html';

// 1. first flush of a page load
const FIRST_BATCH = JSON.stringify({
  obref: '4e5e4050-f8cb-416c-9078-534b39100342',
  events: [
    { type: 'openai::sdk_init', timestamp_ms: 1788253082287, id: '10549cac-a452-4ad8-8568-b4fb8b632210', source_url: PAGE, data: { type: 'sdk_lifecycle' } },
    {
      type: 'oai::diagnostic', timestamp_ms: 1788253082289, id: 'c8735686-e46b-4eb0-bf22-2b77b59633a1',
      data: {
        type: 'diagnostic', schema_version: 1,
        dropped_event_count: 0, dropped_event_reason_counts: {}, dropped_event_name_counts: {}, dropped_event_phase_counts: {},
        consent: true, is_first_visit_in_session: true, is_first_consent_grant_in_session: true,
        config: { automatic_advanced_matching: 'enabled' },
      },
    },
    { type: 'page_viewed', timestamp_ms: 1788253082291, id: 'd1d6564e-dee2-477d-9372-9f7ec1e018f1', source_url: PAGE, data: { type: 'contents' } },
  ],
  user: { in: USER_IN },
});

// 2. conversion with a site-supplied event_id and both user sources
const ORDER = JSON.stringify({
  obref: 'b14db04e-da99-476d-9a5c-e869f4e90e5e',
  events: [{
    type: 'order_created', timestamp_ms: 1788253108976, id: 'order-1788253108973', source_url: PAGE,
    data: { type: 'contents', amount: 12497, currency: 'EUR', contents: ITEMS },
  }],
  user: { in: USER_IN, fm: USER_FM },
});

// 3. same conversion, opt_out set
const OPT_OUT = JSON.stringify({
  obref: 'b14db04e-da99-476d-9a5c-e869f4e90e5e',
  events: [{
    type: 'order_created', timestamp_ms: 1788253110222, id: '945d639b-fcf7-44ab-ad10-f6dbc09bbcaf', source_url: PAGE,
    opt_out: true, data: { type: 'contents', amount: 12497, currency: 'EUR', contents: ITEMS },
  }],
  user: { in: USER_IN, fm: USER_FM },
});

// 4. consent denied before init — the marketing event never made it onto the wire
const DENIED = JSON.stringify({
  events: [{
    type: 'oai::diagnostic', timestamp_ms: 1788253250058, id: 'cd609f89-604f-4294-83fe-ef8509a9e850',
    data: {
      type: 'diagnostic', schema_version: 1,
      dropped_event_count: 0, dropped_event_reason_counts: {}, dropped_event_name_counts: {}, dropped_event_phase_counts: {},
      consent: false, is_first_visit_in_session: true,
    },
  }],
});

// --- detection -------------------------------------------------------------
test('host detection separates the events endpoint from the CDN', () => {
  assert.equal(isOpenAiPixelHost('bzr.openai.com'), true);
  assert.equal(isOpenAiSdkHost('bzrcdn.openai.com'), true);
  assert.equal(isOpenAiPixelHost('bzrcdn.openai.com'), false);   // SDK + pixel config, never an event
  assert.equal(isOpenAiPixelHost('chatgpt.com'), false);
});

test('only /v1/sdk/events is claimed', () => {
  assert.equal(parseOpenAiRequest('https://bzrcdn.openai.com/sdk/oaiq.min.js', null), null);
  assert.equal(parseOpenAiRequest(`https://bzrcdn.openai.com/pixel-config/v1/${PID}.json`, null), null);
  assert.equal(parseOpenAiRequest('https://bzr.openai.com/v1/other', ORDER), null);
  assert.equal(parseOpenAiRequest(url(1), null), null);                     // no body → nothing to read
  assert.equal(parseOpenAiRequest(url(1), '{"events":[]}'), null);
});

// --- batching --------------------------------------------------------------
test('a batched POST becomes one record per event', () => {
  const recs = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map(r => r.eventType), ['openai::sdk_init', 'oai::diagnostic', 'page_viewed']);
  assert.deepEqual(recs.map(r => r._batch.index), [1, 2, 3]);
  assert.equal(recs[0]._batch.total, 3);
  for (const r of recs) {
    assert.equal(r.provider, 'openai');
    assert.equal(r.pixelId, PID);
    assert.equal(r.sdkVersion, '0.1.32');
    assert.equal(r.method, 'POST');
  }
});

test('a single-event POST carries no batch marker', () => {
  const [r] = parseOpenAiRequest(url(1), ORDER);
  assert.equal(r._batch, null);
});

// --- event classification --------------------------------------------------
test('sdk_init and diagnostic are flagged internal, real events are not', () => {
  const recs = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.deepEqual(recs.map(r => r.flags.internal), [true, true, false]);
  assert.equal(recs[2].flags.standardEvent, true);
  assert.equal(recs[2].dataType, 'contents');
  assert.equal(recs[2].pageUrl, PAGE);
});

test('a custom event is named by custom_event_name', () => {
  const body = JSON.stringify({
    obref: 'x', events: [{
      type: 'custom', id: 'c1', custom_event_name: 'newsletter_signup', source_url: PAGE,
      data: { type: 'custom', amount: 500, currency: 'EUR' },
    }],
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.event, 'newsletter_signup');       // what shows in Ads Manager
  assert.equal(r.eventType, 'custom');
  assert.equal(r.flags.custom, true);
  assert.equal(r.flags.standardEvent, false);
});

// --- commerce payload ------------------------------------------------------
test('order_created: amount is minor units, contents are unpacked', () => {
  const [r] = parseOpenAiRequest(url(1), ORDER);
  assert.equal(r.event, 'order_created');
  assert.deepEqual(r.revenue, { value: '124.97', currency: 'EUR', minor: 12497 });
  assert.equal(r.contents.length, 2);
  assert.equal(r.flags.itemCount, 2);
  assert.deepEqual(r.contents[1], {
    id: 'SKU-B20', name: 'Red Gadget', contentType: 'product',
    quantity: '2', amount: 3749, amountText: '37.49', currency: 'EUR',
  });
});

test('zero-decimal currencies are not divided', () => {
  assert.equal(formatMinorAmount(12497, 'EUR'), '124.97');
  assert.equal(formatMinorAmount(12497, 'JPY'), '12497');
  assert.equal(formatMinorAmount(12497, null), '12497');   // no currency → no assumption
  assert.equal(formatMinorAmount(null, 'EUR'), null);
});

test('plan_enrollment keeps the plan id', () => {
  const body = JSON.stringify({
    obref: 'x', events: [{
      type: 'subscription_created', id: 's1', source_url: PAGE,
      data: { type: 'plan_enrollment', plan_id: 'pro-monthly', amount: 1900, currency: 'EUR' },
    }],
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.planId, 'pro-monthly');
  assert.equal(r.dataType, 'plan_enrollment');
  assert.equal(r.revenue.value, '19.00');
  assert.equal(r.contents, null);
});

// --- dedup id / opt-out ----------------------------------------------------
test('a site-supplied event_id is told apart from the SDK uuid', () => {
  const [order] = parseOpenAiRequest(url(1), ORDER);
  assert.equal(order.eventId, 'order-1788253108973');
  assert.equal(order.flags.dedupeId, true);

  const [optOut] = parseOpenAiRequest(url(1), OPT_OUT);
  assert.equal(optOut.flags.dedupeId, false);          // plain v4 uuid → SDK-generated
  assert.equal(optOut.optOut, true);
  assert.equal(optOut.flags.optOut, true);
});

// --- user data by source ---------------------------------------------------
test('user data is flattened per source, init vs. auto-matched', () => {
  const [r] = parseOpenAiRequest(url(1), ORDER);
  assert.deepEqual(Object.keys(r.userData).sort(), [
    'fm.em', 'fm.pc', 'fm.ph',
    'in.co', 'in.ct', 'in.eid', 'in.em', 'in.fn', 'in.ln', 'in.pc', 'in.ph', 'in.rg',
  ]);
  assert.deepEqual(r.userData['in.em'], { bucket: 'email', label: 'Email (init)', hashed: true, algo: 'sha256', source: 'in' });
  assert.deepEqual(r.userData['fm.em'], { bucket: 'email', label: 'Email (form (auto))', hashed: true, algo: 'sha256', source: 'fm' });
  // Geo fields ride in cleartext by design — reported as such, never as a warning.
  assert.deepEqual(r.userData['in.ct'], { bucket: 'city', label: 'City (init)', hashed: false, algo: null, source: 'in' });
  assert.equal(r.flags.autoMatching, true);
  // address = in.co + in.ct + in.rg + in.pc + fm.pc
  assert.deepEqual(r.identifiers, { email: 2, phone: 2, name: 2, address: 5 });
});

test('init-only user data does not count as auto-matching', () => {
  const [, , pv] = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.equal(pv.flags.autoMatching, false);
  assert.equal(pv.flags.advancedMatching, true);
  assert.equal(pv.userData['fm.em'], undefined);
});

// The envelope's user block would otherwise repeat on the SDK's own telemetry
// cards and imply the diagnostic carried the visitor's identity.
test('SDK-internal events report the envelope user data instead of listing it', () => {
  const [init, diag, pv] = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.equal(init.userData, null);
  assert.equal(diag.userData, null);
  assert.equal(init.envelopeUserFields, 9);
  assert.deepEqual(diag.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
  assert.equal(diag.flags.dedupeId, false);
  assert.equal(Object.keys(pv.userData).length, 9);   // the real event still carries it
  assert.equal(pv.envelopeUserFields, 0);
});

test('multi-value auto-matched fields keep the whole list', () => {
  const ud = flattenUserData({ fm: { em: ['a'.repeat(64), 'b'.repeat(64)] } });
  assert.equal(ud['fm.em'].list.length, 2);
  assert.equal(flattenUserData({ fm: { em: [] } }), null);
  assert.equal(flattenUserData(null), null);
});

// --- consent ---------------------------------------------------------------
test('the diagnostic reports the consent the SDK acted on', () => {
  const recs = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.equal(recs[1].diagnostic.consent, true);
  assert.equal(recs[1].diagnostic.autoMatching, 'enabled');
  assert.equal(recs[1].diagnostic.firstVisit, true);
  for (const r of recs) {
    assert.equal(r.consent.granted, true);
    assert.equal(r.consent.credentialless, false);
    assert.equal(r.consent.source, 'diagnostic');
  }
});

test('a denied session sends a stripped, credentialless body', () => {
  const recs = parseOpenAiRequest(url(1), DENIED);
  assert.equal(recs.length, 1);
  const [r] = recs;
  assert.equal(r.flags.internal, true);
  assert.equal(r.consent.granted, false);
  assert.equal(r.consent.credentialless, true);
  assert.equal(r.browserRef, null);
  assert.equal(r.clickId, null);
  assert.equal(r.userData, null);
  assert.deepEqual(r.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
});

test('a stripped body carrying a real event reads as denied', () => {
  const body = JSON.stringify({ events: [{ type: 'page_viewed', id: 'p1', data: { type: 'contents' } }] });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.consent.granted, false);
  assert.equal(r.consent.source, 'transport');
});

// The SDK omits credentials for a batch of session markers even when consent was
// granted, so that shape alone must not be read as a denial.
test('a marker-only stripped body stays unknown, not denied', () => {
  const body = JSON.stringify({
    events: [{
      type: 'oai::diagnostic', id: 'd1',
      data: { type: 'diagnostic', schema_version: 1, is_first_visit_in_session: true },
    }],
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.consent.granted, null);
  assert.equal(r.consent.credentialless, true);
  assert.equal(r.consent.source, null);
});

test('a full body means the SDK was not operating under a denial', () => {
  const body = JSON.stringify({
    obref: 'x', events: [{ type: 'page_viewed', id: 'p1', data: { type: 'contents' } }],
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.consent.granted, true);
  assert.equal(r.consent.source, 'transport');
});

// --- click id --------------------------------------------------------------
test('oppref (the ad click id) and obref are read off the envelope', () => {
  const body = JSON.stringify({
    obref: 'f53f8781-1d64-4d9a-b118-c0780c497e3d', oppref: 'oai-test-click-0001',
    events: [{ type: 'lead_created', id: 'l1', source_url: PAGE, data: { type: 'customer_action' } }],
    user: { in: USER_IN },
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.clickId, 'oai-test-click-0001');
  assert.equal(r.browserRef, 'f53f8781-1d64-4d9a-b118-c0780c497e3d');
});

// --- diagnostics: dropped events -------------------------------------------
test('dropped events are surfaced with their reasons', () => {
  const body = JSON.stringify({
    obref: 'x',
    events: [{
      type: 'oai::diagnostic', id: 'd1',
      data: {
        type: 'diagnostic', schema_version: 2, consent: true,
        dropped_event_count: 2,
        dropped_event_reason_counts: { unsupported_event_name: 1, invalid_event_props: 1 },
        dropped_event_name_counts: { purchase: 1, order_created: 1 },
        dropped_event_phase_counts: { measure: 2 },
        dropped_event_details: [{ reason: 'unsupported_event_name', code: 'name', field: 'eventName', count: 1 }],
      },
    }],
  });
  const [r] = parseOpenAiRequest(url(1), body);
  assert.equal(r.diagnostic.droppedCount, 2);
  assert.equal(r.flags.droppedEvents, 2);
  assert.deepEqual(r.diagnostic.droppedReasons, { unsupported_event_name: 1, invalid_event_props: 1 });
  assert.deepEqual(r.diagnostic.droppedNames, { purchase: 1, order_created: 1 });
  assert.equal(r.diagnostic.droppedDetails.length, 1);
});

test('empty diagnostic counter objects collapse to null', () => {
  const [, diag] = parseOpenAiRequest(url(3), FIRST_BATCH);
  assert.equal(diag.diagnostic.droppedReasons, null);
  assert.equal(diag.diagnostic.droppedCount, 0);
});
