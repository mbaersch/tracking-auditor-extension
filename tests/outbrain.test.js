import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutbrainRequest, isOutbrainHost } from '../lib/outbrain.js';

// Real Outbrain unifiedPixel hits captured on posterlounge (marketerId
// 00294883a303269ddd4ed1f979dec8af73). PAGE_VIEW fired natively; the conversions
// were fired via obApi('track', '<name>', …) from the console — the same client
// code path a real conversion would take (posterlounge routes real conversions
// server-side via ssGTM, so the console is the only way to see a client hit, and
// it is a genuine request). The `bust` cache-buster is trimmed for readability.

const MID = '00294883a303269ddd4ed1f979dec8af73';
const OB = (name, extra) =>
  `https://tr.outbrain.com/unifiedPixel?au=false&bust=03193974395721608` +
  `&referrer=https%3A%2F%2Fwww.posterlounge.de%2F&pRef=https%3A%2F%2Ftagassistant.google.com%2F` +
  `&cht=gtm${extra || ''}&marketerId=${MID}&name=${name}` +
  `&dl=https%3A%2F%2Fwww.posterlounge.de%2F&g=0&zone=euZone1&obApiVersion=1.1&obtpVersion=bf3bb98dcd8c_2026-07-13`;

const PAGE_VIEW = OB('PAGE_VIEW', '&pld=4591');
const ADD_TO_CART = OB('AddToCart');
const VIEW_CONTENT = OB('ViewContent');
const LEAD = OB('Lead');
const PURCHASE = OB('Purchase', '&orderValue=49.9&currency=EUR&orderId=AUDIT-OB-1');

// --- detection -------------------------------------------------------------
test('isOutbrainHost / loader + sync + non-Outbrain are ignored', () => {
  assert.equal(isOutbrainHost('tr.outbrain.com'), true);
  assert.equal(isOutbrainHost('amplify.outbrain.com'), false);   // loader host
  assert.equal(isOutbrainHost('example.com'), false);
  // loader, id-sync and dashboard are not tracking events
  assert.equal(parseOutbrainRequest('https://amplify.outbrain.com/cp/obtp.js', null), null);
  assert.equal(parseOutbrainRequest('https://sync.outbrain.com/cookie-sync', null), null);
  // the tracking host but a non-pixel path
  assert.equal(parseOutbrainRequest('https://tr.outbrain.com/something?marketerId=x&name=y', null), null);
});

// --- page view -------------------------------------------------------------
test('PAGE_VIEW: account, event, page url, channel, versions', () => {
  const r = parseOutbrainRequest(PAGE_VIEW, null);
  assert.ok(r);
  assert.equal(r.provider, 'outbrain');
  assert.equal(r.event, 'PAGE_VIEW');
  assert.equal(r.flags.pageView, true);
  assert.equal(r.flags.conversion, false);
  assert.equal(r.account, MID);
  assert.equal(r.pageUrl, 'https://www.posterlounge.de/');
  assert.equal(r.previousPage, 'https://tagassistant.google.com/');
  assert.equal(r.channel, 'gtm');
  assert.equal(r.zone, 'euZone1');
  assert.equal(r.apiVersion, '1.1');
  assert.equal(r.revenue, null);
});

// --- conversions -----------------------------------------------------------
test('AddToCart / ViewContent / Lead: advertiser-named conversions, no revenue', () => {
  for (const [url, name] of [[ADD_TO_CART, 'AddToCart'], [VIEW_CONTENT, 'ViewContent'], [LEAD, 'Lead']]) {
    const r = parseOutbrainRequest(url, null);
    assert.equal(r.event, name);
    assert.equal(r.flags.conversion, true);
    assert.equal(r.flags.pageView, false);
    assert.equal(r.revenue, null);
  }
});

test('Purchase: revenue params (orderValue / currency / orderId) are parsed', () => {
  const r = parseOutbrainRequest(PURCHASE, null);
  assert.equal(r.event, 'Purchase');
  assert.deepEqual(r.revenue, { value: '49.9', currency: 'EUR' });
  assert.equal(r.orderId, 'AUDIT-OB-1');
  assert.equal(r.flags.ecommerce, true);
});

// --- no PII / no consent on the pixel --------------------------------------
test('no hashed PII and no consent signal ride the unifiedPixel', () => {
  const r = parseOutbrainRequest(PURCHASE, null);
  assert.equal(r.userData, null);
  assert.equal(r.identifiers.email, 0);
  assert.equal(r.consent, null);
});

// --- a missing marketerId / name is not a valid fire -----------------------
test('a unifiedPixel without marketerId or name is ignored', () => {
  assert.equal(parseOutbrainRequest('https://tr.outbrain.com/unifiedPixel?name=PAGE_VIEW', null), null);
  assert.equal(parseOutbrainRequest(`https://tr.outbrain.com/unifiedPixel?marketerId=${MID}`, null), null);
});
