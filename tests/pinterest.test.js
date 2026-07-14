import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePinterestRequest,
  extractPinterestUserData,
  summarizePinterestIdentifiers,
  extractPinterestEcommerce,
  extractPinterestCustomData,
} from '../lib/pinterest.js';

// Two real Pinterest tag hits captured on atomkraftwerke24.de (Markus'
// playground): an `init` base-code load carrying a hashed email in pd, and an
// `addtocart` with order/value/line_items in ed plus a custom field.

const INIT_URL = 'https://ct.pinterest.com/v3/?tid=2612345678901&pd=%7B%22np%22%3A%22gtm%22%2C%22gtm_version%22%3A%22gallery%22%2C%22em%22%3A%22e5c8e5ed5d033ebd4c707cc0f991a9940ba2e330483064eda4d068223fbefcab%22%7D&event=init&ad=%7B%22loc%22%3A%22https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1782756165094%22%2C%22ref%22%3A%22https%3A%2F%2Ftagassistant.google.com%2F%22%2C%22if%22%3Afalse%2C%22sh%22%3A1080%2C%22sw%22%3A1920%2C%22mh%22%3A%220cb4b510%22%2C%22is_eu%22%3Atrue%2C%22architecture%22%3A%22x86%22%2C%22bitness%22%3A%2264%22%2C%22mobile%22%3Afalse%2C%22model%22%3A%22%22%2C%22platform%22%3A%22Windows%22%2C%22platformVersion%22%3A%2219.0.0%22%2C%22uaFullVersion%22%3A%22149.0.7827.114%22%7D&cb=1782756170450';

const ATC_URL = 'https://ct.pinterest.com/v3/?event=addtocart&ed=%7B%22custom%201%22%3A%22custom%20value%201%22%2C%22np%22%3A%22gtm%22%2C%22gtm_version%22%3A%22gallery%22%2C%22order_id%22%3A%22TEST01%22%2C%22order_quantity%22%3A%221%22%2C%22value%22%3A42%2C%22currency%22%3A%22EUR%22%2C%22line_items%22%3A%5B%7B%22product_id%22%3A%22item%201%22%2C%22product_category%22%3A%22general%22%7D%5D%7D&tid=2612345678901&pd=%7B%22np%22%3A%22gtm%22%2C%22gtm_version%22%3A%22gallery%22%2C%22em%22%3A%22e5c8e5ed5d033ebd4c707cc0f991a9940ba2e330483064eda4d068223fbefcab%22%2C%22pin_unauth%22%3A%22dWlkPU56RXpabUpsT0RndFpqTTFNaTAwTlRFM0xUazNORGd0WmpSaFptVXhZMkZsT0dObA%22%2C%22aem_eligible_list%22%3A%5B%22em%22%2C%22ph%22%5D%7D&cb=1782756225395&dep=4%2CTAGS_RECEIVED&stc=true&ad=%7B%22loc%22%3A%22https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1782756165094%22%2C%22ref%22%3A%22https%3A%2F%2Ftagassistant.google.com%2F%22%2C%22if%22%3Afalse%2C%22sh%22%3A1080%2C%22sw%22%3A1920%2C%22mh%22%3A%220cb4b510%22%2C%22is_eu%22%3Atrue%2C%22is_restricted_region%22%3Afalse%2C%22architecture%22%3A%22x86%22%2C%22bitness%22%3A%2264%22%2C%22mobile%22%3Afalse%2C%22model%22%3A%22%22%2C%22platform%22%3A%22Windows%22%2C%22platformVersion%22%3A%2219.0.0%22%2C%22uaFullVersion%22%3A%22149.0.7827.114%22%7D';

test('real init: tag id, hashed email in pd, page url from ad', () => {
  const r = parsePinterestRequest(INIT_URL, null);
  assert.ok(r, 'should be recognised as a Pinterest tag hit');
  assert.equal(r.provider, 'pinterest');
  assert.equal(r.transport, 'standard');
  assert.equal(r.method, 'GET');
  assert.equal(r.tid, '2612345678901');
  assert.equal(r.event, 'init');
  assert.equal(r.standardEvent, true);
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1782756165094');
  assert.equal(r.referrer, 'https://tagassistant.google.com/');

  assert.ok(r.userData);
  assert.equal(r.userData.em.hashed, true);             // 64-char SHA-256
  assert.deepEqual(r.identifiers, { email: 1, phone: 0, name: 0, address: 0 });
  assert.equal(r.flags.advancedMatching, true);
  assert.equal(r.flags.isEu, true);

  assert.equal(r.ecommerce, null);
  assert.equal(r.revenue, null);
  assert.equal(r.flags.ecommerce, false);
});

test('real addtocart: ed value/order/line_items + custom field', () => {
  const r = parsePinterestRequest(ATC_URL, null);
  assert.ok(r);
  assert.equal(r.event, 'addtocart');
  assert.equal(r.flags.ecommerce, true);

  assert.ok(r.ecommerce);
  assert.deepEqual(r.revenue, { value: '42', currency: 'EUR' });
  assert.equal(r.ecommerce.orderId, 'TEST01');
  assert.equal(r.ecommerce.orderQuantity, '1');
  assert.equal(r.ecommerce.lineItems.length, 1);
  assert.equal(r.ecommerce.lineItems[0].id, 'item 1');
  assert.equal(r.ecommerce.lineItems[0].category, 'general');

  // "custom 1" is neither e-commerce nor plumbing → custom data
  assert.equal(r.flags.cdCount, 1);
  assert.equal(r.customData['custom 1'], 'custom value 1');

  // pd extras surfaced
  assert.equal(r.userData.em.hashed, true);
  assert.ok(r.pinUnauth);
  assert.deepEqual(r.aemEligible, ['em', 'ph']);
});

test('missing event → "base code page load"; /user and non-Pinterest ignored', () => {
  const r = parsePinterestRequest('https://ct.pinterest.com/v3/?tid=2612345678901', null);
  assert.ok(r);
  assert.equal(r.event, 'base code page load');
  assert.equal(r.standardEvent, true);

  // /user carries only a subset — intentionally ignored
  assert.equal(parsePinterestRequest('https://ct.pinterest.com/user/?tid=26123', null), null);
  // no tag id
  assert.equal(parsePinterestRequest('https://ct.pinterest.com/v3/?event=init', null), null);
  // wrong host
  assert.equal(parsePinterestRequest('https://www.facebook.com/tr/?id=1&ev=PageView', null), null);
});

test('event aliases map onto canonical names', () => {
  const purchase = parsePinterestRequest('https://ct.pinterest.com/v3/?tid=26123&event=purchase', null);
  assert.equal(purchase.event, 'checkout');
  assert.equal(purchase.standardEvent, true);
  const pageview = parsePinterestRequest('https://ct.pinterest.com/v3/?tid=26123&event=pageview', null);
  assert.equal(pageview.event, 'pagevisit');
});

test('POST body params are read too', () => {
  const r = parsePinterestRequest('https://ct.pinterest.com/v3/', 'tid=26123&event=checkout&ed=%7B%22value%22%3A9%2C%22currency%22%3A%22USD%22%7D');
  assert.ok(r);
  assert.equal(r.method, 'POST');
  assert.equal(r.event, 'checkout');
  assert.deepEqual(r.revenue, { value: '9', currency: 'USD' });
});

test('helpers work standalone', () => {
  const ud = extractPinterestUserData({ em: 'a'.repeat(64), ph: '', np: 'gtm' });
  assert.equal(Object.keys(ud).length, 1);              // empty ph + plumbing np dropped
  assert.deepEqual(summarizePinterestIdentifiers(ud), { email: 1, phone: 0, name: 0, address: 0 });

  assert.equal(extractPinterestEcommerce({ np: 'gtm' }), null);
  assert.deepEqual(extractPinterestCustomData({ value: 1, foo: 'bar' }), { foo: 'bar' });
});

// An adversarial ed can put null / non-objects in line_items[]; parsing must
// never throw (a throw would drop the hit at the un-try/caught parse call).
test('line_items[] with null / non-object elements does not throw', () => {
  assert.doesNotThrow(() => extractPinterestEcommerce({ line_items: [null] }));
  assert.doesNotThrow(() => extractPinterestEcommerce({ line_items: [null, 'x', 3] }));
  // all-junk line_items → falls through (here: nothing else present → null)
  assert.equal(extractPinterestEcommerce({ line_items: [null] }), null);
  // mixed: the one real row survives, the junk is dropped
  const mixed = extractPinterestEcommerce({ line_items: [null, { product_id: 'p1', product_price: '9.99' }] });
  assert.equal(mixed.lineItems.length, 1);
  assert.equal(mixed.lineItems[0].id, 'p1');
  // and end-to-end through the public entry point
  const ed = encodeURIComponent(JSON.stringify({ line_items: [null] }));
  assert.doesNotThrow(() => parsePinterestRequest(`https://ct.pinterest.com/v3/?tid=26123&event=addtocart&ed=${ed}`, null));
});
