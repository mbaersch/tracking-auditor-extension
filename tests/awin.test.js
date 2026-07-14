import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAwinRequest, isAwinHost, parseAwinParts, parseAwinProducts, toAmount } from '../lib/awin.js';

// Real Awin hits captured on atomkraftwerke24.de (advertiser/merchant 11783). The
// real MasterTag conversion (orderRef 617591435) fanned out across four transports
// — sread.img (long-form params) + sread.php (short-form, tt=ia) + sread.js (tt=js)
// + the awinblackfriday.com whitelabel mirror — all sharing (merchant, ref). The
// fully-populated sale + PLT (orderRef AUDIT-AWIN-1) were fired via the console
// snippet (sread.img + basket.php). `l` is the confirmation page url.

const L = 'https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html';
// The real MasterTag conversion (617591435) — its four transports:
const SALE_IMG  = 'https://www.awin1.com/sread.img?tt=ns&tv=2&merchant=11783&ref=617591435&amount=22&parts=01:22&ch=na&testmode=1&cr=EUR';
const SALE_PHP  = `https://www.awin1.com/sread.php?a=11783&b=22&cr=EUR&c=617591435&d=01:22|02:12,50&vc=&t=1&ch=na&cks=&l=${L}&tv=2&tt=ia`;
const SALE_JS   = `https://www.awin1.com/sread.js?a=11783&b=22&cr=EUR&c=617591435&d=01:22|02:12,50&vc=&t=1&ch=na&cks=&l=${L}&tv=2&tt=js`;
const SALE_BF   = `https://www.awinblackfriday.com/sread.js?a=11783&b=22&cr=EUR&c=617591435&d=01:22|02:12,50&t=1&ch=na&l=${L}&tv=2&tt=js&cks=`;
// The console-fired sale + PLT (AUDIT-AWIN-1):
const SALE_CON  = 'https://www.awin1.com/sread.img?tt=ns&tv=2&merchant=11783&amount=49.90&ch=aw&parts=DEFAULT%3A49.90&ref=AUDIT-AWIN-1&cr=EUR&vc=&testmode=1';
const BASKET    = 'https://www.awin1.com/basket.php?product_line=AW%3AP%7C11783%7CAUDIT-AWIN-1%7C39930%7CBig%20Sofa%20Edina%7C49.90%7C1%7CSKU-39930%7CDEFAULT%7CSofas%0D%0AAW%3AP%7C11783%7CAUDIT-AWIN-1%7C28249%7CEsszimmerstuhl%20Pejo%7C29.90%7C2%7CSKU-28249%7CSALE%7CStuehle';
const LANDING   = `https://www.awin1.com/alt.php?mid=11783&gv=2&l=${L}`;

// --- detection -------------------------------------------------------------
test('isAwinHost / loader + p3p + non-Awin are ignored', () => {
  assert.equal(isAwinHost('www.awin1.com'), true);
  assert.equal(isAwinHost('www.dwin1.com'), true);
  assert.equal(isAwinHost('awinblackfriday.com'), false);   // whitelabel — matched by signature, not host
  assert.equal(isAwinHost('example.com'), false);
  // the MasterTag loader and p3p are not tracking hits
  assert.equal(parseAwinRequest('https://www.dwin1.com/11783.js', null), null);
  assert.equal(parseAwinRequest('https://www.awin1.com/w3c/p3p.xml', null), null);
});

// --- sale: short & long param namings map to the same fields ---------------
test('sale (short names, sread.php): a/b/c/d decoded to merchant/amount/ref/parts', () => {
  const r = parseAwinRequest(SALE_PHP, null);
  assert.ok(r);
  assert.equal(r.provider, 'awin');
  assert.equal(r.shape, 'sale');
  assert.equal(r.merchantId, '11783');
  assert.equal(r.orderRef, '617591435');
  assert.deepEqual(r.revenue, { value: '22', currency: 'EUR' });
  assert.equal(r.channel, 'na');
  assert.equal(r.testMode, true);
  assert.equal(r.trackingType, 'ia');
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html');   // l, decoded
});

test('sale (long names, sread.img): merchant/amount/ref/parts', () => {
  const r = parseAwinRequest(SALE_CON, null);
  assert.equal(r.merchantId, '11783');
  assert.equal(r.orderRef, 'AUDIT-AWIN-1');
  assert.deepEqual(r.revenue, { value: '49.90', currency: 'EUR' });
  assert.equal(r.testMode, true);
  assert.deepEqual(r.parts, [{ group: 'DEFAULT', amount: '49.90' }]);
});

// --- parts: multiple commission groups, comma decimals ---------------------
test('parts split into commission groups (comma decimals preserved)', () => {
  const r = parseAwinRequest(SALE_PHP, null);
  assert.deepEqual(r.parts, [{ group: '01', amount: '22' }, { group: '02', amount: '12,50' }]);
  assert.equal(parseAwinParts(''), null);
  assert.deepEqual(parseAwinParts('DEFAULT:9.99'), [{ group: 'DEFAULT', amount: '9.99' }]);
});

// --- transport mirrors fold into one card ----------------------------------
test('the four sale transports (img/php/js + whitelabel) share one collapse key', () => {
  const keys = [SALE_IMG, SALE_PHP, SALE_JS, SALE_BF].map((u) => parseAwinRequest(u, null)._collapseKey);
  assert.equal(new Set(keys).size, 1);                        // all fold into one card
  assert.equal(keys[0], 'awin:sale:11783:617591435');
  // the console sale is a different order -> its own card
  assert.notEqual(parseAwinRequest(SALE_CON, null)._collapseKey, keys[0]);
});

test('the awinblackfriday whitelabel mirror is detected via the sale signature', () => {
  const r = parseAwinRequest(SALE_BF, null);
  assert.ok(r);
  assert.equal(r.host, 'www.awinblackfriday.com');
  assert.equal(r.shape, 'sale');
  assert.equal(r.merchantId, '11783');
});

// --- product level tracking (basket.php) -----------------------------------
test('PLT: product_line rows parsed into a product table', () => {
  const r = parseAwinRequest(BASKET, null);
  assert.equal(r.shape, 'plt');
  assert.equal(r.merchantId, '11783');
  assert.equal(r.orderRef, 'AUDIT-AWIN-1');
  assert.equal(r.products.length, 2);
  assert.deepEqual(r.products[0], {
    advertiserId: '11783', orderRef: 'AUDIT-AWIN-1', id: '39930', name: 'Big Sofa Edina',
    price: '49.90', quantity: '1', sku: 'SKU-39930', commissionGroup: 'DEFAULT', category: 'Sofas',
  });
  assert.equal(r.products[1].commissionGroup, 'SALE');
  // derived basket total: 49.90×1 + 29.90×2 = 109.70
  assert.deepEqual(r.revenue, { value: '109.70', currency: null, computed: true });
});

test('parseAwinProducts ignores non-AW:P lines', () => {
  assert.equal(parseAwinProducts(''), null);
  assert.equal(parseAwinProducts('garbage'), null);
  assert.equal(parseAwinProducts('AW:P|1|ref|9|Item|1.00|1|SKU|DEFAULT|Cat').length, 1);
});

// --- landing (alt.php) -----------------------------------------------------
test('landing (alt.php): mid + relayed sale url', () => {
  const r = parseAwinRequest(LANDING, null);
  assert.equal(r.shape, 'landing');
  assert.equal(r.merchantId, '11783');
  assert.equal(r.relayedUrl, 'https://atomkraftwerke24.de/ectest.html');
});

// --- money parsing: comma/dot decimals + thousands separators --------------
test('toAmount handles both decimal styles and thousands separators', () => {
  assert.equal(toAmount('49.90'), 49.9);      // dot decimal
  assert.equal(toAmount('12,50'), 12.5);      // EU comma decimal
  assert.equal(toAmount('1.234,56'), 1234.56); // EU: dot grouping + comma decimal
  assert.equal(toAmount('1,234.56'), 1234.56); // US: comma grouping + dot decimal
  assert.equal(toAmount('1000'), 1000);
  assert.ok(Number.isNaN(toAmount('')));
  assert.ok(Number.isNaN(toAmount(null)));
  assert.ok(Number.isNaN(toAmount('abc')));
});

// --- empty templates are skipped, not shown as cards -----------------------
test('empty sread / basket / alt beacons are ignored', () => {
  assert.equal(parseAwinRequest('https://www.awin1.com/sread.img?tt=ns&tv=2&merchant=', null), null);
  assert.equal(parseAwinRequest('https://www.awin1.com/basket.php?product_line=', null), null);
  assert.equal(parseAwinRequest('https://www.awin1.com/alt.php?mid=', null), null);
});
