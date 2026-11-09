import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFloodlightRequest,
  isFloodlightHost,
  extractFloodlightUserData,
} from '../lib/floodlight.js';

// The four ACTIVITY / ACTIVITYI fixtures below are REAL Floodlight fires captured
// on delife.de (Floodlight config src=14804749). Each fire is a mirror pair:
//   ad.doubleclick.net/activity      — the counter
//   14804749.fls.doubleclick.net/activityi — the image mirror
// They share (src,type,cat,ord) so the panel folds them into one card. Both
// captured activities are COUNTERS (no cost / value) — the store fires no sales
// counter we could trigger without a real purchase. The two constructed cases at
// the end (sales value, cleartext email) exercise branches the real captures
// never hit; they are clearly marked as synthetic.

const ACTIVITY_VIEW  = 'https://ad.doubleclick.net/activity;src=14804749;type=delif0;cat=allvi0;rcb=15;ord=5426429458572;npa=0;auiddc=2106096883.1779186070;u1=https%3A%2F%2Fwww.delife.de%2F;gdid=dMzk4MW;pscdl=noapi;frm=0;gpp=DBAA;gpp_sid=-1;gcs=G111;gcd=13r3r3r2r5l1;dma_cps=a;dma=1;dc_fmt=3;epver=2;~oref=https%3A%2F%2Fwww.delife.de%2F?';
const ACTIVITYI_VIEW = 'https://14804749.fls.doubleclick.net/activityi;src=14804749;type=delif0;cat=allvi0;rcb=15;ord=5426429458572;npa=0;auiddc=2106096883.1779186070;u1=https%3A%2F%2Fwww.delife.de%2F;gdid=dMzk4MW;pscdl=noapi;frm=0;gpp=DBAA;gpp_sid=-1;gcs=G111;gcd=13r3r3r2r5l1;dma_cps=a;dma=1;dc_fmt=2;epver=2;_dc_test=1;~oref=https%3A%2F%2Fwww.delife.de%2F?';
const ACTIVITY_PROD  = 'https://ad.doubleclick.net/activity;src=14804749;type=delif0;cat=waren0;rcb=8;ord=8732078144165;npa=0;auiddc=2106096883.1779186070;u3=28249;gdid=dMzk4MW;gpp=DBAA;gpp_sid=-1;gcs=G111;gcd=13r3r3r2r5l1;dma=1;dc_fmt=3;~oref=https%3A%2F%2Fwww.delife.de%2Fesszimmerstuhl-pejo-flex-beige%2Fa-28249?';

// --- detection -------------------------------------------------------------
test('isFloodlightHost / non-Floodlight is ignored', () => {
  assert.equal(isFloodlightHost('ad.doubleclick.net'), true);
  assert.equal(isFloodlightHost('14804749.fls.doubleclick.net'), true);
  assert.equal(isFloodlightHost('googleads.g.doubleclick.net'), false); // that is a Google Ads host
  assert.equal(isFloodlightHost('example.com'), false);
  // a non-activity DoubleClick path is not a Floodlight fire
  assert.equal(parseFloodlightRequest('https://ad.doubleclick.net/ddm/trackclk/N123', null), null);
});

// --- the counter activity (view) -------------------------------------------
test('activity (view counter): src / group / tag / ordinal / page url', () => {
  const r = parseFloodlightRequest(ACTIVITY_VIEW);
  assert.ok(r);
  assert.equal(r.provider, 'floodlight');
  assert.equal(r.transport, 'activity');
  assert.equal(r.advertiserId, '14804749');
  assert.equal(r.group, 'delif0');           // type
  assert.equal(r.activityTag, 'allvi0');     // cat
  assert.equal(r.event, 'delif0/allvi0');    // advertiser-defined, verbatim
  assert.equal(r.ord, '5426429458572');
  assert.equal(r.flags.counter, true);
  assert.equal(r.flags.sales, false);
  assert.equal(r.revenue, null);
  assert.equal(r.pageUrl, 'https://www.delife.de/');   // ~oref, decoded
  assert.deepEqual(r.customVars, { u1: 'https://www.delife.de/' });
});

test('activityi (image mirror) parses and shares the collapse key with its activity', () => {
  const a = parseFloodlightRequest(ACTIVITY_VIEW);
  const i = parseFloodlightRequest(ACTIVITYI_VIEW);
  assert.equal(i.transport, 'activityi');
  assert.equal(i.host, '14804749.fls.doubleclick.net');
  // same (src,type,cat,ord) → same collapse key → the panel folds them into one card
  assert.equal(i._collapseKey, a._collapseKey);
  assert.ok(a._transportRank > i._transportRank);   // the /activity counter wins the merge
});

test('a product-view activity carries the product id in u3 + a deep page url', () => {
  const r = parseFloodlightRequest(ACTIVITY_PROD);
  assert.equal(r.activityTag, 'waren0');
  assert.deepEqual(r.customVars, { u3: '28249' });
  assert.equal(r.pageUrl, 'https://www.delife.de/esszimmerstuhl-pejo-flex-beige/a-28249');
  assert.equal(r.userData, null);            // a product id is not PII
  assert.equal(r.flags.cleartextEmail, false);
});

// --- consent ---------------------------------------------------------------
test('consent (gcs/gcd/dma/npa/gpp) is decoded', () => {
  const r = parseFloodlightRequest(ACTIVITY_VIEW);
  assert.ok(r.consent);
  assert.equal(r.consent.adStorage, 'granted');       // gcs=G111
  assert.equal(r.consent.analyticsStorage, 'granted');
  assert.equal(r.consent.dma, '1');
  assert.equal(r.consent.npa, '0');
  assert.equal(r.consent.gpp, 'DBAA');
  assert.equal(r.consent.gppSid, '-1');
});

// --- constructed: branches the real (counter-only) captures never hit -------
test('CONSTRUCTED sales activity: cost becomes revenue, qty the quantity', () => {
  // Not a real capture — a Floodlight sales activity (dc_fmt with cost/qty/ord=orderid).
  const url = 'https://ad.doubleclick.net/activity;src=14804749;type=delif0;cat=purch0;ord=ORDER-42;cost=199.90;qty=2;~oref=https%3A%2F%2Fwww.delife.de%2Fdanke';
  const r = parseFloodlightRequest(url);
  assert.equal(r.flags.sales, true);
  assert.equal(r.flags.counter, false);
  assert.deepEqual(r.revenue, { value: '199.90', currency: null });
  assert.equal(r.quantity, '2');
  assert.equal(r.ord, 'ORDER-42');
});

test('CONSTRUCTED cleartext email in a custom var is surfaced as not hashed', () => {
  const url = 'https://ad.doubleclick.net/activity;src=14804749;type=delif0;cat=allvi0;ord=1;u5=auditor-test%40example.com';
  const r = parseFloodlightRequest(url);
  assert.ok(r.userData && r.userData.u5);
  assert.equal(r.userData.u5.bucket, 'email');
  assert.equal(r.userData.u5.hashed, false);
  assert.equal(r.flags.cleartextEmail, true);
  assert.equal(r.identifiers.email, 1);
});

// --- purpose classification: advertiser counter vs Google Ads / Signals -----
// A DoubleClick /activity fired by gtag's Google Ads / Signals integration carries
// gcl* click-linking + enhanced-conversions markers instead of custom variables.
// It IS a real Floodlight endpoint hit — we keep it as a Floodlight card but flag
// why it fired. (Real capture: type=crite0 on www4.criteo.com, Criteo's own FL.)
const ADS_LINKED = 'https://ad.doubleclick.net/activity;src=15299229;type=crite0;cat=uk_tm002;rcb=15;ord=2123734405067;npa=0;auiddc=1538393434.1784034435;gclgs=1;gclst=1425720;gcllp=136208867;gclaw=CjwKCAjw_x;gdid=dOThhZD;pscdl=noapi;frm=0;user_data_mode=a;gtm=45fe67d0h2v9209549821;gcs=G111;gcd=13r3r3r2r5l1;dma=1;dc_fmt=3;em=tv.1;~oref=https%3A%2F%2Fwww4.criteo.com%2Fde%2F?';

test('a Google Ads / Signals-linked activity is flagged (gcl* + em), still Floodlight', () => {
  const r = parseFloodlightRequest(ADS_LINKED);
  assert.equal(r.provider, 'floodlight');       // endpoint is Floodlight — provider stays
  assert.equal(r.flags.googleAdsLinked, true);  // gclaw/gclgs/gclst/gcllp present
  assert.equal(r.flags.enhancedConversions, true); // em / user_data_mode
  assert.equal(r.gclid, 'CjwKCAjw_x');
  assert.equal(r.customVars, null);             // no advertiser custom vars
});

test('a classic advertiser counter is NOT Ads-linked (has custom vars, no gcl*)', () => {
  const r = parseFloodlightRequest(ACTIVITY_VIEW);
  assert.equal(r.flags.googleAdsLinked, false);
  assert.equal(r.flags.enhancedConversions, false);
  assert.equal(r.gclid, null);
  assert.deepEqual(r.customVars, { u1: 'https://www.delife.de/' });
});

// --- unit: PII scan does not false-positive on ids/hashes -------------------
test('extractFloodlightUserData flags only real emails, not product/order ids', () => {
  assert.equal(extractFloodlightUserData({ u3: '28249' }), null);
  assert.equal(extractFloodlightUserData({ u1: 'https://www.delife.de/' }), null);
  assert.equal(extractFloodlightUserData(null), null);
  const ud = extractFloodlightUserData({ u2: 'a@b.de' });
  assert.ok(ud && ud.u2 && ud.u2.bucket === 'email');
});

// Real capture, atomkraftwerke24.de 2026-11-09: a Google tag with a DC- id and no
// Floodlight activity tag sends only this ccm/collect page_view.
const DC_CCM_COLLECT = 'https://www.google.com/ccm/collect?rcb=10&frm=0&apvc=0&auid=1723142630.1794249870&dt=atomkraftwerke24.de%20%E2%80%93%20Ein%20Testshop.%20Nicht%20ernst%20gemeint%2C%20aber%20n%C3%BCtzlich&tid=DC-12345667&en=page_view&dl=https%3A%2F%2Fatomkraftwerke24.de%2F&scrsrc=stp.atomkraftwerke24.de&rnd=202481454.1794249870&navt=n&npa=0&gdid=dNGJiYT&gtm=45fe6b61h2z8c_DC-12345667za20szb836065292zd836065292xecxf3&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tft=1794249875948&tfd=17328&tids=DC-12345667&fmt=8';

test('floodlight: ccm/collect with tid=DC- is a measurement card', () => {
  const r = parseFloodlightRequest(DC_CCM_COLLECT, null, 'https://atomkraftwerke24.de/');
  assert.equal(r.provider, 'floodlight');
  assert.equal(r.signalType, 'measurement');
  assert.equal(r.advertiserId, '12345667');
  assert.equal(r.event, 'page_view');
  assert.equal(r.transport, 'google');
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/');
  assert.equal(r.consent.adStorage, 'granted');
  assert.equal(r.consent.npa, '0');
  assert.equal(r.flags.counter, false);
  assert.equal(r._collapseKey, 'fl:12345667:collect:page_view');
});

test('floodlight: ccm/collect on the site domain (tag gateway) is first-party', () => {
  const url = 'https://data.example.com/ccm/collect?tid=DC-12345667&en=page_view&gcs=G111';
  assert.equal(parseFloodlightRequest(url, null, 'https://www.example.com/').transport, 'first-party');
});

test('floodlight: ccm/collect with tid=AW- or without tid is not Floodlight', () => {
  assert.equal(parseFloodlightRequest('https://www.google.com/ccm/collect?tid=AW-123456789&en=page_view'), null);
  assert.equal(parseFloodlightRequest('https://www.google.com/ccm/collect?en=page_view&ae=g'), null);
  assert.equal(parseFloodlightRequest('https://ad.doubleclick.net/ccm/s/collect?auid=1.2&gcs=G111'), null);
});

test('googleads: ccm/collect with tid=DC- stays out of Google Ads', async () => {
  const { parseGoogleAdsRequest } = await import('../lib/googleads.js');
  assert.equal(parseGoogleAdsRequest(DC_CCM_COLLECT, null, 'https://atomkraftwerke24.de/'), null);
});
