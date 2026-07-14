import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoogleAdsRequest,
  googleAdsCollapseKey,
  parseEmToken,
  parseDataParam,
  parseAdsItems,
} from '../lib/googleads.js';
import { parseGa4Request } from '../lib/ga4.js';

// All fixtures are real hits captured on atomkraftwerke24.de (Markus' playground,
// AW-1071635065). The opaque server blobs (eoid/crd/cerd/eitems/fsk/cpb/pscrd/
// cid/ezwbk) on the 1p-conversion / viewthroughconversion mirrors are trimmed —
// they don't affect parsing — everything we read is verbatim.

// --- measurement (ccm/collect, tid=AW-) ------------------------------------
const MEAS_PAGEVIEW = 'https://www.google.com/ccm/collect?rcb=18&frm=0&auid=1235240376.1778240583&dt=Enhanced%20Conversions%20Testseite&en=page_view&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&dr=tagassistant.google.com&rnd=294733418.1782761414&navt=r&npa=0&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xec&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tids=AW-1071635065&tid=AW-1071635065&fmt=8';
const MEAS_ATC = 'https://www.google.com/ccm/collect?rcb=18&frm=0&ae=g&auid=1235240376.1778240583&dt=Shop&en=add_to_cart&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fshop%2F&rnd=294733418.1782761414&navt=r&npa=0&epn.value=10&_tu=CA&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&tids=AW-1071635065&tid=AW-1071635065&fmt=8';

// --- remarketing (viewthrough / rmkt / 1p-user-list), one bundle = one random
const RMKT_CONFIG_VTC  = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1071635065/?random=1782761414360&en=gtag.config&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xec&gcd=13r3r3r2r5l1&dma=1&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&npa=0&data=event%3Dgtag.config&fmt=4';
const RMKT_CONFIG_RMKT = 'https://www.google.com/rmkt/collect/1071635065/?random=1782761414360&en=gtag.config&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xec&gcd=13r3r3r2r5l1&dma=1&npa=0&data=event%3Dgtag.config&fmt=8';
const RMKT_ATC_VTC  = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1071635065/?random=1782761468029&en=add_to_cart&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcd=13r3r3r2r5l1&dma=1&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&npa=0&value=10&_tu=CA&data=event%3Dadd_to_cart%3Bgoogle_business_vertical%3Dretail%3Bid%3Dtest%20product&fmt=4';
const RMKT_ATC_RMKT = 'https://www.google.com/rmkt/collect/1071635065/?random=1782761468029&en=add_to_cart&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcd=13r3r3r2r5l1&dma=1&npa=0&value=10&data=event%3Dadd_to_cart%3Bgoogle_business_vertical%3Dretail%3Bid%3Dtest%20product&fmt=8';
const RMKT_ATC_UL   = 'https://www.google.com/pagead/1p-user-list/1071635065/?random=1782761468029&en=add_to_cart&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcd=13r3r3r2r5l1&dma=1&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&npa=0&value=10&data=event%3Dadd_to_cart%3Bgoogle_business_vertical%3Dretail%3Bid%3Dtest%20product&fmt=3&is_vtc=1';

// --- conversion (purchase 1adstest1) — client twins + server chain, two randoms
const CONV_PAGEAD = 'https://www.googleadservices.com/pagead/conversion/1071635065/?random=1782761485612&en=conversion&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&label=1adstest1&capi=1&bttype=purchase&oid=7192923&value=10&currency_code=EUR&npa=0&ec_mode=a&oidsrc=1&ecsid=861586319.1782760733&_tu=CA&gcl_ctr=136~0~0~0&category=acrcp_v1_512&em=tv.1~em.vEeV7ovnKnqSqDpnsa095yzIATkGhxqenz7YhNfEpPU&emd=tvd.1~i1.fem.ma.r18.n18.lINPUT&fmt=7';
const CONV_CCM    = 'https://www.googleadservices.com/ccm/conversion/1071635065/?random=1782761485612&en=conversion&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&label=1adstest1&capi=1&bttype=purchase&oid=7192923&value=10&currency_code=EUR&npa=0&ec_mode=a&oidsrc=1&ecsid=861586319.1782760733&em=tv.1~em.vEeV7ovnKnqSqDpnsa095yzIATkGhxqenz7YhNfEpPU&emd=tvd.1~i1.fem.ma.r18.n18.lINPUT&fmt=3';
const CONV_VTC    = 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1071635065/?random=342465554&en=conversion&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&label=1adstest1&capi=1&value=10&currency_code=EUR&npa=0&ec_mode=a&oidsrc=1&ecsid=861586319.1782760733&category=acrcp_v1_512&em=tv.1~em.vEeV7ovnKnqSqDpnsa095yzIATkGhxqenz7YhNfEpPU&fmt=8';
const CONV_1P     = 'https://www.google.com/pagead/1p-conversion/1071635065/?random=342465554&en=conversion&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&label=1adstest1&capi=1&value=10&currency_code=EUR&npa=0&ec_mode=a&oidsrc=1&ecsid=861586319.1782760733&category=acrcp_v1_512&fmt=8&is_vtc=1';

// --- conversion (form submit K_4adstest…) — full em bundle + line items
const CONV_EC = 'https://www.googleadservices.com/pagead/conversion/1071635065/?random=1782761434863&en=conversion&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&label=K_4adstest4skfh8sdf--sdfsdA&capi=1&bttype=purchase&oid=1865539661&value=20&currency_code=EUR&npa=0&ec_mode=c&oidsrc=1&ecsid=861586319.1782760733&gcl_ctr=134~0~0~0&data=country%3DDeutschland%3Bshipping%3D12&item=(22.25*2*EK42**)(42.12*1*EK242**)&category=acrcp_v1_512&em=tv.1~em.bc4795ee8be72a7a92a83a67b1ad3de72cc8013906871a9e9f3ed884d7c4a4f5~pn.b5da6260f4a4af12d466354e5c6dc492e4c1ee7e6625c9571eb0442440a57a4a~fn0.9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08~ln0.9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08~sa0.7a33c38f4aa2cc2ea3a92fde79f53f55218f04c000baa2fdff3fd79658ac1509~pc0.12345~co0.DE&emd=tvd.1~i1.fem.mc.p1~i2.fpn.mc.p1&fmt=7';

// --- UPD (form-data pairs). Auto burst (gap.fsrc=1): empty pagead + em ccm.
const UPD_PAGEAD_EMPTY = 'https://www.google.com/pagead/form-data/1071635065?gtm=45Pe66p0v9210171140za20gzb836065292zd836065292xec&gcs=G111&gcd=13r3r3r2r5l1&dma=1&rcb=18&npa=0&ae=a&gap.fsrc=1';
const UPD_CCM_DATA = 'https://www.google.com/ccm/form-data/1071635065?gtm=45Pe66p0v9210171140za20gzb836065292zd836065292xec&gcs=G111&gcd=13r3r3r2r5l1&dma=1&rcb=18&npa=0&ae=a&ec_mode=a&gap.fsrc=1&em=tv.1~em.vEeV7ovnKnqSqDpnsa095yzIATkGhxqenz7YhNfEpPU&ecsid=861586319.1782760733&emd=tvd.1~i1.fem.ma.r18.n18.lINPUT';
// Explicit burst (no gap.fsrc, gtm xea): full address bundle.
const UPD_PAGEAD_FULL = 'https://www.google.com/pagead/form-data/1071635065?gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea&gcs=G111&gcd=13r3r3r2r5l1&dma=1&rcb=18&npa=0&ec_mode=c&em=tv.1~em.vEeV7ovnKnqSqDpnsa095yzIATkGhxqenz7YhNfEpPU~pn.sCrwpdCoTZxHtveoXYTFCwX4mj3zSTtZwBEpeyuoehQ~ct0.bad%2520wenigstadt~pc0.11234~rg0.by~co0.DE&emd=tvd.1';

// --- noise: server-side ccm beacon, no en/label ----------------------------
const NOISE_SERVER = 'https://ad.doubleclick.net/ccm/s/collect?auid=1235240376.1778240583&gtm=45Pe66p0v9210171140z8836065292za20gzb836065292zd836065292xea';

// ===========================================================================

test('measurement: ccm/collect page_view', () => {
  const r = parseGoogleAdsRequest(MEAS_PAGEVIEW, null);
  assert.ok(r);
  assert.equal(r.provider, 'googleads');
  assert.equal(r.signalType, 'measurement');
  assert.equal(r.event, 'page_view');
  assert.equal(r.accountId, 'AW-1071635065');
  assert.equal(r.transport, 'google');
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html');
  assert.equal(r.revenue, null);
  assert.equal(r.consent.adStorage, 'granted');         // gcs=G111
});

test('measurement: add_to_cart carries epn.value', () => {
  const r = parseGoogleAdsRequest(MEAS_ATC, null);
  assert.equal(r.signalType, 'measurement');
  assert.equal(r.event, 'add_to_cart');
  assert.deepEqual(r.revenue, { value: '10', currency: null });
});

// --- transport: where the hit egresses, not what fired it ------------------
// The first-party call uses the inspected page URL (3rd arg), NOT the payload's
// own dl — a hit can claim any dl. Real request captured on taggrs.io: a
// ccm/collect twin gtag fires straight to pagead2.googlesyndication.com. It is a
// Google host → third-party, regardless of the page.
const MEAS_SYNDICATION = 'https://pagead2.googlesyndication.com/ccm/collect?rcb=14&frm=0&en=page_view&dl=https%3A%2F%2Ftaggrs.io%2Fde%2F&dr=www.google.com&scrsrc=happytagging.taggrs.io&npa=1&did=dMWZhNz&gdid=dMWZhNz&_tu=CA&gcs=G100&dma=1&tids=AW-11030440615&tid=AW-11030440615';
// Same event, but genuinely sGTM-proxied onto the site's own registrable domain.
const MEAS_1P_PROXY = 'https://happytagging.taggrs.io/ccm/collect?en=page_view&gcs=G100&tids=AW-11030440615&tid=AW-11030440615';
// Ads path served from a foreign domain (shared sGTM vendor host, different site).
const MEAS_FOREIGN_PROXY = 'https://sgtm.othervendor.io/ccm/collect?en=page_view&gcs=G100&tid=AW-11030440615';

test('transport: googlesyndication.com is a Google host → third-party (not first-party)', () => {
  const r = parseGoogleAdsRequest(MEAS_SYNDICATION, null, 'https://taggrs.io/de/');
  assert.ok(r);
  assert.equal(r.host, 'pagead2.googlesyndication.com');
  assert.equal(r.transport, 'google');
});

test('transport: sGTM proxy on the page\'s own eTLD+1 is first-party', () => {
  const r = parseGoogleAdsRequest(MEAS_1P_PROXY, null, 'https://taggrs.io/de/');
  assert.ok(r);
  assert.equal(r.transport, 'first-party');   // happytagging.taggrs.io ↔ taggrs.io
});

test('transport: Ads path on a foreign domain is unknown, never first-party', () => {
  const r = parseGoogleAdsRequest(MEAS_FOREIGN_PROXY, null, 'https://example.com/');
  assert.ok(r);
  assert.equal(r.transport, 'unknown');       // sgtm.othervendor.io ↔ example.com
});

test('transport: non-Google host without a page URL cannot claim first-party', () => {
  const r = parseGoogleAdsRequest(MEAS_1P_PROXY, null);   // no pageUrl
  assert.ok(r);
  assert.equal(r.transport, 'unknown');
});

test('remarketing: product data lives in the remarketing bucket', () => {
  const r = parseGoogleAdsRequest(RMKT_ATC_VTC, null);
  assert.equal(r.signalType, 'remarketing');
  assert.equal(r.event, 'add_to_cart');
  assert.equal(r.family, 'viewthroughconversion');
  assert.deepEqual(r.productData, { event: 'add_to_cart', google_business_vertical: 'retail', id: 'test product' });
  assert.deepEqual(r.revenue, { value: '10', currency: null });
  assert.equal(r.userData, null);                       // never PII in remarketing
});

test('conversion: label, value, oid, EC stub', () => {
  const r = parseGoogleAdsRequest(CONV_PAGEAD, null);
  assert.equal(r.signalType, 'conversion');
  assert.equal(r.label, '1adstest1');
  assert.equal(r.bttype, 'purchase');
  assert.deepEqual(r.revenue, { value: '10', currency: 'EUR' });
  assert.equal(r.oid, '7192923');
  assert.equal(r.flags.enhancedConversions, true);      // capi=1 / em present
  assert.equal(r.flags.conversion, true);
});

test('conversion: full em bundle → identifiers + line items + context data', () => {
  const r = parseGoogleAdsRequest(CONV_EC, null);
  assert.equal(r.label, 'K_4adstest4skfh8sdf--sdfsdA');
  assert.deepEqual(r.revenue, { value: '20', currency: 'EUR' });
  // em carries email/phone/name/street (hashed) + postal/country (plain)
  assert.ok(r.userData.em.hashed);
  assert.ok(r.userData.pn.hashed);
  assert.equal(r.userData.pc0.hashed, false);           // postal sent plain
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 1, address: 1 }); // max() = presence, like the other providers
  assert.deepEqual(r.items, [
    { price: '22.25', quantity: '2', sku: 'EK42' },
    { price: '42.12', quantity: '1', sku: 'EK242' },
  ]);
  assert.deepEqual(r.contextData, { country: 'Deutschland', shipping: '12' });
});

test('upd: hashed em user data, no revenue', () => {
  const r = parseGoogleAdsRequest(UPD_CCM_DATA, null);
  assert.equal(r.signalType, 'upd');
  assert.ok(r.userData.em.hashed);
  assert.deepEqual(r.identifiers, { email: 1, phone: 0, name: 0, address: 0 });
  assert.equal(r.ecsid, '861586319.1782760733');
  assert.equal(r.revenue, null);
});

test('noise: server ccm/s/collect beacon is ignored', () => {
  assert.equal(parseGoogleAdsRequest(NOISE_SERVER, null), null);
});

test('GA4 parser does not claim ccm/collect (no PARSERS conflict)', () => {
  assert.equal(parseGa4Request(MEAS_PAGEVIEW, null), null);
});

// --- collapse: one logical hit per signal, transports fold in --------------

test('collapse: purchase conversion — client twins + server chain share a key', () => {
  const keys = [CONV_PAGEAD, CONV_CCM, CONV_VTC, CONV_1P]
    .map((u) => googleAdsCollapseKey(parseGoogleAdsRequest(u, null)));
  assert.equal(new Set(keys).size, 1, 'all four conversion mirrors collapse to one card');
});

test('collapse: remarketing bundle (viewthrough+rmkt+1p-user-list) shares a key', () => {
  const keys = [RMKT_ATC_VTC, RMKT_ATC_RMKT, RMKT_ATC_UL]
    .map((u) => googleAdsCollapseKey(parseGoogleAdsRequest(u, null)));
  assert.equal(new Set(keys).size, 1);
});

test('collapse: gtag.config init aggregates per page (random-independent)', () => {
  const a = googleAdsCollapseKey(parseGoogleAdsRequest(RMKT_CONFIG_VTC, null));
  const b = googleAdsCollapseKey(parseGoogleAdsRequest(RMKT_CONFIG_RMKT, null));
  assert.equal(a, b);
  assert.match(a, /:rmkt:config$/);
});

test('collapse: UPD pagead+ccm pair merges; different burst stays distinct', () => {
  const empty = parseGoogleAdsRequest(UPD_PAGEAD_EMPTY, null);
  const data  = parseGoogleAdsRequest(UPD_CCM_DATA, null);
  const full  = parseGoogleAdsRequest(UPD_PAGEAD_FULL, null);
  assert.equal(empty._collapseKey, data._collapseKey, 'auto-burst pagead+ccm collapse');
  assert.notEqual(empty._collapseKey, full._collapseKey, 'explicit burst is a separate card');
  // survivor ranking: ccm/form-data (has em+ecsid) outranks the empty pagead hit
  assert.ok(data._transportRank > empty._transportRank);
});

test('collapse: measurement page_view and add_to_cart are distinct cards', () => {
  const pv  = googleAdsCollapseKey(parseGoogleAdsRequest(MEAS_PAGEVIEW, null));
  const atc = googleAdsCollapseKey(parseGoogleAdsRequest(MEAS_ATC, null));
  assert.notEqual(pv, atc);
});

// --- helpers standalone ----------------------------------------------------

test('parseEmToken: maps fields, flags hashed vs plain', () => {
  const ud = parseEmToken('tv.1~em.' + 'a'.repeat(64) + '~pc0.12345~co0.DE');
  assert.equal(ud.em.bucket, 'email');
  assert.equal(ud.em.hashed, true);
  assert.equal(ud.pc0.bucket, 'postal');
  assert.equal(ud.pc0.hashed, false);
  assert.equal(parseEmToken('tv.1'), null);             // bare stub
});

test('parseDataParam / parseAdsItems standalone', () => {
  assert.deepEqual(parseDataParam('event=add_to_cart;google_business_vertical=retail;id=test product'),
    { event: 'add_to_cart', google_business_vertical: 'retail', id: 'test product' });
  assert.deepEqual(parseAdsItems('(22.25*2*EK42**)(42.12*1*EK242**)'),
    [{ price: '22.25', quantity: '2', sku: 'EK42' }, { price: '42.12', quantity: '1', sku: 'EK242' }]);
});
