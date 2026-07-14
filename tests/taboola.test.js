import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaboolaRequest, isTaboolaHost } from '../lib/taboola.js';

// Real Taboola hits captured on delife.de (account 1733840). The page_view came
// from a normal browse (delife.de.har) — its event rides inside the URL-encoded
// `data` JSON as data.mpvd.en. The log/3/unip events came from delife.de-taboola.har,
// fired via the Pixel API (_tfa.push({notify:'event', name:'…'})) so the otherwise
// un-triggerable conversions are real, not spec-guessed. The opaque `sd` session
// token and the long `tcs` TCF string are truncated here for readability (we surface
// tcs verbatim but never parse it, so the length is irrelevant to the logic).

const UI = 'cefd3eaf-42e5-4a1d-9457-aa3b0771e5f4-tuct9b5e708';
const TCS = 'CQnSI_AQnSI_AAfUOBDECnFgAAAAAAAAAAigTRUNCATED';

// A page_view is a /trc/3/json hit whose `data` param is URL-encoded JSON. Built
// here from the real captured field set (data.mpvd.en === 'page_view').
function pageViewUrl() {
  const data = {
    id: 106, ii: '/', it: 'video', sd: 'v2_TRUNCATED', ui: UI, vi: 1784031640513,
    cv: '20260712-3-RELEASE', u: 'https://www.delife.de/', e: null,
    cbp: 'ConsentManager', cbpv: '1', tcs: TCS, ccpa: '1---',
    mpvd: { en: 'page_view', 'item-url': 'https://www.delife.de/', ccpaPs: '1---', it: 'JS_PIXEL', supv: true },
  };
  return `https://trc.taboola.com/1733840/trc/3/json?tim=1784031640529&data=${encodeURIComponent(JSON.stringify(data))}&pubit=i`;
}

// Real /log/3/unip event URLs (sd/tcs truncated). item-url is the current page.
const EV = (qs) =>
  `https://trc.taboola.com/1733840/log/3/unip?${qs}&tim=1784039325000&vi=1784039226432` +
  `&sd=v2_TRUNCATED&ui=${UI}&ref=https%3A%2F%2Fwww.delife.de%2Fsale%2F&cv=20260712-3-RELEASE` +
  `&item-url=https%3A%2F%2Fwww.delife.de%2Fbig-sofa-edina-boucle-weiss-330x170cm%2Fa-39930` +
  `&ccpaPs=1---&cbp=ConsentManager&cbpv=1&tcs=${TCS}&cmps=0&it=JS_PIXEL&psb=true`;

const ADD_TO_CART = EV('en=add_to_cart');
const PURCHASE    = EV('en=make_purchase&revenue=199.9&currency=EUR&orderid=AUDIT-TFA-1&quantity=2');
const LEAD        = EV('en=lead');
const ENGAGEMENT  = `https://trc-events.taboola.com/1733840/log/3/unip?en=pre_d_eng_tb&tos=10759&scd=0&ssd=1&ui=${UI}&item-url=https%3A%2F%2Fwww.delife.de%2F&ccpaPs=1---&cbp=ConsentManager&cbpv=1&tcs=${TCS}&it=JS_PIXEL`;

// --- detection -------------------------------------------------------------
test('isTaboolaHost / loader + sync + non-Taboola are ignored', () => {
  assert.equal(isTaboolaHost('trc.taboola.com'), true);
  assert.equal(isTaboolaHost('trc-events.taboola.com'), true);
  assert.equal(isTaboolaHost('cdn.taboola.com'), false);      // loader host, not events
  assert.equal(isTaboolaHost('example.com'), false);
  // the loader, id-sync and p3p are not tracking events
  assert.equal(parseTaboolaRequest('https://cdn.taboola.com/libtrc/unip/1733840/tfa.js', null), null);
  assert.equal(parseTaboolaRequest('https://sync-t1.taboola.com/sg/criteortb-network/1/rtb-h/', null), null);
  assert.equal(parseTaboolaRequest('https://trc.taboola.com/p3p.xml', null), null);
});

// --- page view (data JSON) -------------------------------------------------
test('page view (/trc/3/json): event from data.mpvd.en, account, page url', () => {
  const r = parseTaboolaRequest(pageViewUrl(), null);
  assert.ok(r);
  assert.equal(r.provider, 'taboola');
  assert.equal(r.shape, 'pageview');
  assert.equal(r.event, 'page_view');
  assert.equal(r.standardEvent, true);
  assert.equal(r.account, '1733840');
  assert.equal(r.pageUrl, 'https://www.delife.de/');
  assert.equal(r.userId, UI);
  assert.equal(r.version, '20260712-3-RELEASE');
  assert.equal(r.revenue, null);
  assert.equal(r.identifiers.email, 0);          // no PII on the Taboola pixel
});

// --- events (/log/3/unip) --------------------------------------------------
test('event (/log/3/unip): en carries the event, item-url is the page', () => {
  const r = parseTaboolaRequest(ADD_TO_CART, null);
  assert.equal(r.shape, 'event');
  assert.equal(r.event, 'add_to_cart');
  assert.equal(r.standardEvent, true);
  assert.equal(r.account, '1733840');
  assert.equal(r.pageUrl, 'https://www.delife.de/big-sofa-edina-boucle-weiss-330x170cm/a-39930');
  assert.equal(r.referrer, 'https://www.delife.de/sale/');
});

test('make_purchase: flat revenue / currency / orderid / quantity', () => {
  const r = parseTaboolaRequest(PURCHASE, null);
  assert.equal(r.event, 'make_purchase');
  assert.deepEqual(r.revenue, { value: '199.9', currency: 'EUR' });
  assert.equal(r.orderId, 'AUDIT-TFA-1');
  assert.equal(r.quantity, '2');
  assert.equal(r.flags.ecommerce, true);
});

test('a lead event carries no revenue', () => {
  const r = parseTaboolaRequest(LEAD, null);
  assert.equal(r.event, 'lead');
  assert.equal(r.revenue, null);
  assert.equal(r.flags.ecommerce, false);
});

// --- engagement noise ------------------------------------------------------
test('engagement ping (pre_d_eng_tb) is parsed but flagged as noise', () => {
  const r = parseTaboolaRequest(ENGAGEMENT, null);
  assert.ok(r);
  assert.equal(r.host, 'trc-events.taboola.com');   // the events mirror host
  assert.equal(r.event, 'pre_d_eng_tb');
  assert.equal(r.flags.engagement, true);
  assert.equal(r.flags.custom, false);              // engagement != custom event
  assert.equal(r.standardEvent, false);
});

// --- consent ---------------------------------------------------------------
test('consent: TCF string, US-privacy and CMP surfaced (not decoded)', () => {
  const r = parseTaboolaRequest(PURCHASE, null);
  assert.ok(r.consent);
  assert.equal(r.consent.tcf, TCS);
  assert.equal(r.consent.usPrivacy, '1---');
  assert.equal(r.consent.cmp, 'ConsentManager');
  assert.equal(r.consent.cmpVersion, '1');
});

// --- PII: unified_id (AudienceMatch hashed email) --------------------------
// Real /log/3/unip hit — the SHA-256 of auditor-test@example.com rides as the flat
// `unified_id` query param (verified: passed at event level via _tfa.push).
const HE = '8ebbb5cd35077ac97214abd64ff4b9a1c2df520d51ec58b5c708ec1ac2f86418';
const UNIFIED = EV(`en=lead&unified_id=${HE}`);

test('unified_id: the hashed email is surfaced as a SHA-256 Email identifier', () => {
  const r = parseTaboolaRequest(UNIFIED, null);
  assert.ok(r.userData && r.userData.unified_id);
  assert.equal(r.userData.unified_id.bucket, 'email');
  assert.equal(r.userData.unified_id.hashed, true);
  assert.equal(r.userData.unified_id.algo, 'sha256');   // 64-hex → SHA-256
  assert.equal(r.flags.hashedEmail, true);
  assert.equal(r.identifiers.email, 1);
});

test('an event without unified_id carries no PII', () => {
  const r = parseTaboolaRequest(ADD_TO_CART, null);
  assert.equal(r.userData, null);
  assert.equal(r.flags.hashedEmail, false);
  assert.equal(r.identifiers.email, 0);
});

// --- unknown event fallback ------------------------------------------------
test('an unknown event code is surfaced verbatim as a custom event', () => {
  const r = parseTaboolaRequest(EV('en=some_new_thing'), null);
  assert.equal(r.event, 'some_new_thing');
  assert.equal(r.standardEvent, false);
  assert.equal(r.flags.custom, true);
});
