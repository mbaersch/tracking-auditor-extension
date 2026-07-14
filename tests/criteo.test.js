import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCriteoRequest,
  parseCriteoItems,
  isCriteoHost,
} from '../lib/criteo.js';

// All fixtures are REAL Criteo OneTag /event hits captured on delife.de
// (account a=4216). vh/vl/vp came from a normal browse; ac/vb(console)/vc/lead +
// the cleartext email were fired via the OneTag console API (window.criteo_q) so
// the otherwise un-triggerable events are real, not spec-guessed. The opaque
// `bundle` identity token rides along verbatim (we don't decode it).

const VH   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvh%26tms%3Dgtm-template&p2=e%3Ddis&bundle=OHWJTF9XNUR&sc=%7B%22fbp%22%3A%22fb.1.1779186070581.784350244702828814.AQYCAQMA%22%7D&tld=delife.de&dy=1&fu=https%253A%252F%252Fwww.delife.de%252F&ceid=6027855e-6b12-4f34-83f9-f86e6c95c226&cs=1---&cv=1&gpp=DBAA&gpp_sid=-1';
const VL   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvl%26tms%3Dgtm-template%26ca%3Dproduct_listing%26p%3D20673&p2=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252Fsale%252F&pu=https%253A%252F%252Fwww.delife.de%252F&ceid=4698b99d-0a9d-421c-8101-9aa9c0445945&cs=1---&gpp=DBAA&gpp_sid=-1';
const VP   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvp%26tms%3Dgtm-template%26pr%3D159.9%26p%3D28249&p2=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252Fesszimmerstuhl-pejo-flex-beige%252Fa-28249&ceid=1b91f83f-fcd5-42ec-80e8-5d7ee2c4323d&cs=1---&gpp=DBAA&gpp_sid=-1';
// browse-fired viewBasket carries currency c=EUR + the double-encoded item array.
const VB   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvb%26tms%3Dgtm-template%26c%3DEUR%26p%3D%255Bi%25253D28249%252526pr%25253D159.9%252526q%25253D1%255D&p2=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252F&ceid=5f1ff121-fea5-43f4-911d-a3e840222dd5&cs=1---&gpp=DBAA&gpp_sid=-1';
// console-fired: setEmail (ce) rides along with add-to-cart / transaction / lead.
const AC   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dce%26m%3D%255Bauditor-test%252540example.com%255D&p2=e%3Dac%26p%3D%255Bi%25253D28249%252526pr%25253D159.9%252526q%25253D1%255D&p3=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252F&ceid=f816c45c-a84a-4517-8263-2ed7ef2b1213&cs=1---&gpp=DBAA&gpp_sid=-1';
const VC   = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dce%26m%3D%255Bauditor-test%252540example.com%255D&p2=e%3Dvc%26id%3DAUDIT-TEST-0001%26p%3D%255Bi%25253D28249%252526pr%25253D159.9%252526q%25253D1%255D&p3=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252F&ceid=05c490c7-dd34-4ca3-96c9-5d848e911813&cs=1---&gpp=DBAA&gpp_sid=-1';
const LEAD = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dce%26m%3D%255Bauditor-test%252540example.com%255D&p2=e%3Dtrackleads%26leadType%3Dtest&p3=e%3Ddis&bundle=x&tld=delife.de&fu=https%253A%252F%252Fwww.delife.de%252F&ceid=4db085fe-8a04-411c-b599-c61bec82fef6&cs=1---&gpp=DBAA&gpp_sid=-1';

// --- detection -------------------------------------------------------------
test('isCriteoHost / non-event paths are ignored', () => {
  assert.equal(isCriteoHost('sslwidget.criteo.com'), true);
  assert.equal(isCriteoHost('gum.criteo.com'), true);
  assert.equal(isCriteoHost('example.com'), false);
  // gum/dis/dynamic are identity-sync / loader, not the /event tracking endpoint
  assert.equal(parseCriteoRequest('https://gum.criteo.com/syncframe?topUrl=delife.de', null), null);
  assert.equal(parseCriteoRequest('https://dynamic.criteo.com/js/ld/ld.js?a=4216', null), null);
});

// --- events ----------------------------------------------------------------
test('viewHome (vh): account, version, no products, page url unwrapped', () => {
  const r = parseCriteoRequest(VH, null);
  assert.ok(r);
  assert.equal(r.provider, 'criteo');
  assert.equal(r.transport, 'standard');
  assert.equal(r.event, 'view home');
  assert.equal(r.eventCode, 'vh');
  assert.equal(r.account, '4216');
  assert.equal(r.version, '5.46.0');
  assert.equal(r.items, null);
  assert.equal(r.pageUrl, 'https://www.delife.de/');   // fu double-decoded
});

test('viewList (vl): category + product id', () => {
  const r = parseCriteoRequest(VL, null);
  assert.equal(r.eventCode, 'vl');
  assert.equal(r.category, 'product_listing');
  assert.deepEqual(r.items, [{ id: '20673', price: null, quantity: null }]);
});

test('viewItem (vp): id + price + revenue', () => {
  const r = parseCriteoRequest(VP, null);
  assert.equal(r.eventCode, 'vp');
  assert.deepEqual(r.items, [{ id: '28249', price: '159.9', quantity: null }]);
  assert.deepEqual(r.revenue, { value: '159.9', currency: null, computed: false }); // vp price IS the value
});

test('viewBasket (vb): item array + currency (double-encoded array survives)', () => {
  const r = parseCriteoRequest(VB, null);
  assert.equal(r.eventCode, 'vb');
  assert.equal(r.currency, 'EUR');
  assert.deepEqual(r.items, [{ id: '28249', price: '159.9', quantity: '1' }]);
  // Criteo sends no total; we derive it (price × qty) and mark it computed.
  assert.deepEqual(r.revenue, { value: '159.9', currency: 'EUR', computed: true });
});

test('addToCart (ac): item array parsed', () => {
  const r = parseCriteoRequest(AC, null);
  assert.equal(r.eventCode, 'ac');
  assert.equal(r.event, 'add to cart');
  assert.deepEqual(r.items, [{ id: '28249', price: '159.9', quantity: '1' }]);
});

test('transaction (vc): transaction id + items', () => {
  const r = parseCriteoRequest(VC, null);
  assert.equal(r.eventCode, 'vc');
  assert.equal(r.event, 'transaction');
  assert.equal(r.transactionId, 'AUDIT-TEST-0001');
  assert.deepEqual(r.items, [{ id: '28249', price: '159.9', quantity: '1' }]);
  // No value param on the wire — derived order total, no currency in this fixture.
  assert.deepEqual(r.revenue, { value: '159.9', currency: null, computed: true });
});

test('lead (trackleads): kept verbatim as its own event', () => {
  const r = parseCriteoRequest(LEAD, null);
  assert.equal(r.eventCode, 'trackleads');
  assert.equal(r.event, 'lead');
});

// --- PII: the whole point ---------------------------------------------------
test('setEmail (ce) carries the email in CLEARTEXT — surfaced as not hashed', () => {
  const r = parseCriteoRequest(AC, null);
  assert.ok(r.userData && r.userData.m);
  assert.equal(r.userData.m.bucket, 'email');
  assert.equal(r.userData.m.hashed, false);        // plaintext
  assert.equal(r.userData.m.algo, null);           // → "not hashed" in the PII table
  assert.equal(r.flags.cleartextEmail, true);
  assert.equal(r.identifiers.email, 1);
});

test('a browse event without setEmail carries no PII', () => {
  const r = parseCriteoRequest(VP, null);
  assert.equal(r.userData, null);
  assert.equal(r.flags.cleartextEmail, false);
});

// --- slots: technical codes hidden but retained -----------------------------
test('technical exd/dis are kept in slots but never the primary event', () => {
  const r = parseCriteoRequest(AC, null);
  assert.deepEqual(r.slots.map((s) => s.code), ['exd', 'ce', 'ac', 'dis']);
  assert.equal(r.eventCode, 'ac');                 // not exd/ce/dis
});

test('consent (cs/gpp) and shared fbp are surfaced', () => {
  const r = parseCriteoRequest(VH, null);
  assert.equal(r.consent.gpp, 'DBAA');
  assert.equal(r.consent.usPrivacy, '1---');
  assert.equal(r.consent.gppSid, '-1');
  assert.match(r.sharedCookies, /fbp/);            // {"fbp":…} cross-vendor id sharing
});

// --- unit: item parser + unknown-code fallback ------------------------------
test('parseCriteoItems handles a bare (already-decoded) array', () => {
  assert.deepEqual(parseCriteoItems('[i=1&pr=9.9&q=2]'), [{ id: '1', price: '9.9', quantity: '2' }]);
  assert.equal(parseCriteoItems('28249'), null);   // scalar → not an array
});

test('an unknown event code is surfaced verbatim, never dropped', () => {
  const url = 'https://sslwidget.criteo.com/event?a=4216&v=5.46.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dzz%26foo%3Dbar&p2=e%3Ddis';
  const r = parseCriteoRequest(url, null);
  assert.equal(r.eventCode, 'zz');
  assert.equal(r.event, 'zz');                     // no friendly name → raw code
});
