import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventName, accountId, accountTitle, docLocation, CARD_FIELDS } from '../lib/cardfields.js';

// The card-header accessors read each provider's own field names. These lock the
// provider->field mapping that used to live as four parallel if-ladders in
// panel.js, including every special case and the GA4-style fall-through.

test('accountId / accountTitle per provider', () => {
  assert.equal(accountId({ provider: 'ga4', tid: 'G-1' }), 'G-1');
  assert.equal(accountTitle({ provider: 'ga4' }), 'Measurement ID (tid)');
  assert.equal(accountId({ provider: 'meta', id: '123' }), '123');
  assert.equal(accountTitle({ provider: 'meta' }), 'Pixel ID (id)');
  assert.equal(accountId({ provider: 'uet', ti: 'T1' }), 'T1');
  assert.equal(accountId({ provider: 'tiktok', code: 'C1' }), 'C1');
  assert.equal(accountId({ provider: 'pinterest', tid: 'P1' }), 'P1');
  assert.equal(accountId({ provider: 'googleads', accountId: 'AW-9' }), 'AW-9');
  assert.equal(accountId({ provider: 'floodlight', advertiserId: 'src9' }), 'src9');
  assert.equal(accountId({ provider: 'linkedin', pid: 'L1' }), 'L1');
  assert.equal(accountId({ provider: 'reddit', pixelId: 'R1' }), 'R1');
  assert.equal(accountId({ provider: 'snapchat', pixelId: 'S1' }), 'S1');
  assert.equal(accountId({ provider: 'hubspot', accountId: 'H1' }), 'H1');
  assert.equal(accountId({ provider: 'criteo', account: 'Cr1' }), 'Cr1');
  assert.equal(accountId({ provider: 'taboola', account: 'Tb1' }), 'Tb1');
  assert.equal(accountId({ provider: 'outbrain', account: 'Ob1' }), 'Ob1');
  assert.equal(accountId({ provider: 'awin', merchantId: '11783' }), '11783');
  assert.equal(accountTitle({ provider: 'awin' }), 'Awin merchant (MID)');
});

test('eventName: plain and special cases', () => {
  assert.equal(eventName({ provider: 'ga4', en: 'purchase' }), 'purchase');
  assert.equal(eventName({ provider: 'tiktok', event: 'ViewContent' }), 'ViewContent');
  assert.equal(eventName({ provider: 'uet', eventName: 'pageHide' }), 'pageHide');
  // meta: a config fetch with no event
  assert.equal(eventName({ provider: 'meta', signalType: 'config-no-event', ev: null }), 'pixel initialised — no event');
  assert.equal(eventName({ provider: 'meta', ev: 'Purchase' }), 'Purchase');
  // googleads UPD form-data carries no en
  assert.equal(eventName({ provider: 'googleads', event: null, signalType: 'upd' }), 'user data');
  assert.equal(eventName({ provider: 'googleads', event: 'conversion' }), 'conversion');
  // floodlight names sales vs counter when there is no explicit event
  assert.equal(eventName({ provider: 'floodlight', flags: { sales: true } }), 'sales');
  assert.equal(eventName({ provider: 'floodlight', flags: { sales: false } }), 'counter');
  // awin by shape
  assert.equal(eventName({ provider: 'awin', shape: 'plt' }), 'product level tracking');
  assert.equal(eventName({ provider: 'awin', shape: 'landing' }), 'landing');
  assert.equal(eventName({ provider: 'awin', shape: 'sale' }), 'sale');
});

test('docLocation: payload url vs query/body param', () => {
  // payload providers read r.pageUrl
  assert.equal(docLocation({ provider: 'tiktok', pageUrl: 'https://x/y' }), 'https://x/y');
  assert.equal(docLocation({ provider: 'awin', pageUrl: null }), null);
  // ga4 / meta read dl from query then body
  assert.equal(docLocation({ provider: 'ga4', queryParams: { dl: 'https://q' } }), 'https://q');
  assert.equal(docLocation({ provider: 'meta', bodyParams: { dl: 'https://b' } }), 'https://b');
  // uet reads p
  assert.equal(docLocation({ provider: 'uet', queryParams: { p: 'https://p' } }), 'https://p');
});

test('unknown provider falls back to GA4-style (tid / Measurement ID / en / dl)', () => {
  const r = { provider: 'nope', tid: 'X', en: 'ev', queryParams: { dl: 'https://d' } };
  assert.equal(accountId(r), 'X');
  assert.equal(accountTitle(r), 'Measurement ID (tid)');
  assert.equal(eventName(r), 'ev');
  assert.equal(docLocation(r), 'https://d');
});

test('every registered PARSER provider has a descriptor', () => {
  const providers = ['ga4', 'meta', 'uet', 'tiktok', 'pinterest', 'googleads', 'floodlight',
    'linkedin', 'reddit', 'snapchat', 'hubspot', 'criteo', 'taboola', 'outbrain', 'awin'];
  for (const p of providers) assert.ok(CARD_FIELDS[p], `missing descriptor for ${p}`);
});
