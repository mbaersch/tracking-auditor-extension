import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTiktokRequest,
  extractTiktokUserData,
  summarizeTiktokIdentifiers,
  extractTiktokEcommerce,
  extractTiktokDiagnostics,
} from '../lib/tiktok.js';

const URL_PIXEL = 'https://analytics.tiktok.com/api/v2/pixel';

// Three real pixel hits captured on atomkraftwerke24.de (Markus' playground):
// a bare Pageview (empty context.user), a CompleteRegistration with hashed
// email/phone/external_id, and an AddToCart with a four-product cart. Each
// carries TikTok's own signal_diagnostic_labels / _inspection verdict.

const PAGEVIEW = JSON.stringify({
  event: 'Pageview', event_id: '', message_id: 'messageId-1782755227730-8018620532307-C1234567890',
  is_onsite: false, timestamp: '2026-06-29T17:47:07.730Z',
  context: {
    ad: { sdk_env: 'external', jsb_status: 2 }, device: { platform: 'pc' }, user: {},
    pixel: { code: 'C1234567890', runtime: '1' },
    page: { url: 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1782755224649', referrer: 'https://tagassistant.google.com/', load_progress: '2' },
    library: { name: 'pixel.js', version: 'legacy-2.2.1' },
    userAgent: 'Mozilla/5.0',
  },
  properties: {},
  signal_diagnostic_labels: {
    raw_email: { label: 'missing' }, raw_phone: { label: 'missing' }, hashed_email: { label: 'missing' },
  },
});

const COMPLETE_REGISTRATION = JSON.stringify({
  event: 'CompleteRegistration', event_id: 'ID1', message_id: 'messageId-1782755341369-2457282617858-C1234567890',
  is_onsite: false, timestamp: '2026-06-29T17:49:01.369Z',
  context: {
    device: { platform: 'pc' },
    user: {
      phone_number: '860e1f38de021b232b96ab7a01bd906d0275f7f2a7ee331ebbcf890e8aec0c71',
      email: '8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa',
      external_id: '123456',
    },
    pixel: { code: 'C1234567890', runtime: '1' },
    page: { url: 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1782755224649', referrer: 'https://tagassistant.google.com/' },
    library: { name: 'pixel.js', version: 'legacy-2.2.1' },
  },
  _inspection: {
    identity_params: {
      email_is_hashed: ['plain_email', 'plain_mdn_email'], sha256_email: ['empty_value'],
      phone_is_hashed: ['unknown_invalid'], sha256_phone: ['empty_value'], zip_code: ['empty_value'],
    },
  },
  properties: { gtm_version: '0_2_02:14', event_trigger_source: 'GoogleTagManagerClient', currency: 'USD', value: 0 },
  signal_diagnostic_labels: {
    raw_email: { label: 'valid' },
    raw_phone: { label: 'invalid', abnormal_types: ['invalid_country', 'invalid_country_after_inject_plus'], suggested_values: ['2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08'] },
    raw_auto_email: { label: 'missing' }, hashed_email: { label: 'missing' },
  },
});

const ADD_TO_CART = JSON.stringify({
  event: 'AddToCart', event_id: 'ID1', message_id: 'messageId-1782755533505-3769975450859-C1234567890',
  is_onsite: false, timestamp: '2026-06-29T17:52:13.505Z',
  context: {
    user: {
      email: '8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa',
      phone_number: '860e1f38de021b232b96ab7a01bd906d0275f7f2a7ee331ebbcf890e8aec0c71',
      external_id: '123456',
    },
    pixel: { code: 'C1234567890', runtime: '1' },
    page: { url: 'https://atomkraftwerke24.de/shop/', referrer: 'https://atomkraftwerke24.de/' },
    library: { name: 'pixel.js', version: 'legacy-2.2.1' },
  },
  properties: {
    gtm_version: '0_2_02:14', event_trigger_source: 'GoogleTagManagerClient', currency: 'EUR', value: '99.95',
    contents: [
      { content_id: 119, content_name: 'Brennstäbchen (6 x Bundle)', brand: 'Zubehör', content_category: 'Zubehör', price: 99.95, quantity: 1, content_type: 'product' },
      { content_id: 33, content_name: 'Atomkraftwerk (klein)', brand: 'Kraftwerke', content_category: 'Kraftwerke', price: 11000000.42, quantity: 1, content_type: 'product' },
      { content_id: 37, content_name: 'Atomkraftwerk (mittel)', brand: 'Kraftwerke', content_category: 'Kraftwerke', price: 22050000.42, quantity: 1, content_type: 'product' },
      { content_id: 38, content_name: 'Atomkraftwerk (groß)', brand: 'Kraftwerke', content_category: 'Kraftwerke', price: 123456789.99, quantity: 1, content_type: 'product' },
    ],
  },
  signal_diagnostic_labels: {
    raw_email: { label: 'valid' },
    raw_phone: { label: 'invalid', abnormal_types: ['invalid_country'] },
    hashed_email: { label: 'missing' },
  },
});

test('real Pageview: detected, no user data, no ecommerce', () => {
  const r = parseTiktokRequest(URL_PIXEL, PAGEVIEW);
  assert.ok(r, 'should be recognised as a TikTok pixel hit');
  assert.equal(r.provider, 'tiktok');
  assert.equal(r.transport, 'standard');
  assert.equal(r.method, 'POST');
  assert.equal(r.event, 'Pageview');
  assert.equal(r.code, 'C1234567890');
  assert.equal(r.standardEvent, true);
  assert.equal(r.userData, null);
  assert.equal(r.ecommerce, null);
  assert.equal(r.revenue, null);
  assert.equal(r.flags.dedup, false);                 // event_id is ""
  assert.equal(r.flags.advancedMatching, false);
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1782755224649');
  assert.equal(r.diagnostics, null);                  // all labels "missing" → nothing actionable
});

test('real CompleteRegistration: hashed identifiers + invalid-phone signal', () => {
  const r = parseTiktokRequest(URL_PIXEL, COMPLETE_REGISTRATION);
  assert.ok(r);
  assert.equal(r.event, 'CompleteRegistration');
  assert.equal(r.standardEvent, true);
  assert.equal(r.flags.dedup, true);                  // event_id = "ID1"
  assert.equal(r.messageId, 'messageId-1782755341369-2457282617858-C1234567890');

  assert.ok(r.userData);
  assert.equal(r.userData.email.hashed, true);
  assert.equal(r.userData.phone_number.hashed, true);
  assert.equal(r.userData.external_id.hashed, false); // "123456" is not a hash
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 0, address: 0 });
  assert.equal(r.flags.advancedMatching, true);
  assert.equal(r.flags.externalId, true);

  // value 0 / USD is still surfaced as revenue, even though CompleteRegistration is not an ecommerce event
  assert.ok(r.ecommerce);
  assert.deepEqual(r.revenue, { value: '0', currency: 'USD' });
  assert.equal(r.flags.ecommerce, false);             // no contents, not an ecommerce-type event

  // TikTok's own verdict: phone invalid (invalid_country)
  assert.ok(r.diagnostics);
  assert.equal(r.flags.invalidSignal, true);
  const phone = r.diagnostics.signals.find(s => s.field === 'raw_phone');
  assert.equal(phone.label, 'invalid');
  assert.deepEqual(phone.abnormal, ['invalid_country', 'invalid_country_after_inject_plus']);
  assert.equal(phone.suggested, true);
  const email = r.diagnostics.signals.find(s => s.field === 'raw_email');
  assert.equal(email.label, 'valid');
  // "missing" labels are dropped
  assert.equal(r.diagnostics.signals.some(s => s.label === 'missing'), false);
  assert.ok(r.diagnostics.identityParams);            // _inspection.identity_params surfaced
});

test('real AddToCart: four-product cart with prices', () => {
  const r = parseTiktokRequest(URL_PIXEL, ADD_TO_CART);
  assert.ok(r);
  assert.equal(r.event, 'AddToCart');
  assert.equal(r.flags.ecommerce, true);
  assert.deepEqual(r.revenue, { value: '99.95', currency: 'EUR' });
  assert.equal(r.ecommerce.contents.length, 4);
  assert.equal(r.ecommerce.contents[0].name, 'Brennstäbchen (6 x Bundle)');
  assert.equal(r.ecommerce.contents[3].price, '123456789.99');
  assert.equal(r.ecommerce.contents[3].id, '38');
  assert.equal(r.flags.invalidSignal, true);          // phone still flagged invalid
});

test('base64 GET transport (?analytics_message=) decodes to the same record', () => {
  const b64 = Buffer.from(ADD_TO_CART, 'utf-8').toString('base64');
  const url = `${URL_PIXEL}/act?analytics_message=${encodeURIComponent(b64)}`;
  const r = parseTiktokRequest(url, null);
  assert.ok(r, 'base64-in-querystring transport should be decoded');
  assert.equal(r.transport, 'base64');
  assert.equal(r.method, 'GET');
  assert.equal(r.event, 'AddToCart');
  assert.equal(r.ecommerce.contents.length, 4);
});

test('non-event / non-TikTok requests are ignored', () => {
  // pixel.js loader is not an event
  assert.equal(parseTiktokRequest('https://analytics.tiktok.com/i18n/pixel/sdk.js?sdkid=C123', null), null);
  // telemetry sub-path
  assert.equal(parseTiktokRequest('https://analytics.tiktok.com/api/v2/pixel/perf', '{"event":"x","context":{"pixel":{"code":"C1"}}}'), null);
  // internal advanced-matching probe
  assert.equal(parseTiktokRequest(URL_PIXEL, '{"event":"EnrichAM","context":{"pixel":{"code":"C1"}}}'), null);
  // missing pixel code
  assert.equal(parseTiktokRequest(URL_PIXEL, '{"event":"Pageview","context":{}}'), null);
  // wrong host
  assert.equal(parseTiktokRequest('https://www.facebook.com/tr/?id=1&ev=PageView', null), null);
});

test('helpers work standalone', () => {
  const ud = extractTiktokUserData({ email: 'a'.repeat(64), phone_number: '', external_id: '42' });
  assert.equal(Object.keys(ud).length, 2);            // empty phone dropped
  assert.equal(ud.email.hashed, true);
  assert.deepEqual(summarizeTiktokIdentifiers(ud), { email: 1, phone: 0, name: 0, address: 0 });

  assert.equal(extractTiktokEcommerce({}), null);
  assert.equal(extractTiktokEcommerce({ value: '5', currency: 'EUR' }).valueNum, 5);

  const diag = extractTiktokDiagnostics({ signal_diagnostic_labels: { raw_email: { label: 'missing' } } });
  assert.equal(diag, null);                           // only "missing" → nothing to show
});

// An adversarial pixel can put null / non-objects in contents[]; parsing must
// never throw (a throw would drop the hit at the un-try/caught parse call).
test('contents[] with null / non-object elements does not throw', () => {
  assert.doesNotThrow(() => extractTiktokEcommerce({ contents: [null] }));
  assert.doesNotThrow(() => extractTiktokEcommerce({ contents: [null, 'x', 3] }));
  // all-junk contents → falls through to the scalar fallbacks (here: nothing)
  assert.equal(extractTiktokEcommerce({ contents: [null] }), null);
  // mixed: the one real row survives, the junk is dropped
  const mixed = extractTiktokEcommerce({ contents: [null, { content_id: 'p1', price: '9.99' }] });
  assert.equal(mixed.contents.length, 1);
  assert.equal(mixed.contents[0].id, 'p1');
  // and end-to-end through the public entry point (POST body)
  const body = JSON.stringify({ event: 'ViewContent', context: { pixel: { code: 'C1' } }, properties: { contents: [null] } });
  assert.doesNotThrow(() => parseTiktokRequest(URL_PIXEL, body));
});
