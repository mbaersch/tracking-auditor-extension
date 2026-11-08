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

// Google tag gateway, captured 2026-11-08 on www.markus-baersch.de (gateway path
// /gtgtestakw/, gtag AW-1071635065 loaded through it, test conversion 1adstest1).
// One conversion fans out to the gateway short form, the gateway ccm mirror, the
// gateway form-data hit and the direct googleadservices.com hit.
const GTG_ASP = "https://www.markus-baersch.de/gtgtestakw/as/p/c/1071635065/?random=1794150857211&cv=11&fst=1794150857211&fmt=3&bg=ffffff&guid=ON&async=1&en=conversion&gtm=45892e6b41v9210171140za204zb841843806zd841843806xecxf4&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tag_exp=115938466~115938468~118897920~118897930~120213116~120385422~120412526~120420416~120469145~120469153~120895657~121191153~121246026~121246034~123814185~124013662&u_w=1280&u_h=720&url=https%3A%2F%2Fwww.markus-baersch.de%2F%3Fgclid%3DTEST-gtg-gclid-1794150833611&gclaw_src=6_7&rcb=5&evjid=yZFERURFqf6k_5gShQ&label=1adstest1&capi=1&gtm_ee=1&frm=0&tiba=Markus%20Baersch%20-%20Webanalyse%2C%20sauberes%20Tagging%20%26%20Datenqualit%C3%A4t&did=dY2E1Nz&gdid=dY2E1Nz&oid=TEST-gtg-1794150833611&value=10&currency_code=EUR&hn=www.googleadservices.com&npa=0&gclaw=TEST-gtg-gclid-1794150833611&pscdl=noapi&auid=808511001.1794150857&uaa=x86&uab=64&uafvl=Chromium%3B145.0.7632.6%7CNot%253AA-Brand%3B99.0.0.0&uamb=0&uam=&uap=Linux&uapv=&uaw=0&oidsrc=1&ecsid=1654611584.1794150857&ecsid2=1088686842.1794150857&gtb=2&gcl_ctr=1~0~0~0&data=event%3Dconversion&gap.gtb=2&aecs=1&category=acrcp_v1_512&ept=74&epp=5~22~74";
const GTG_ASD = "https://www.markus-baersch.de/gtgtestakw/as/d/ccm/conversion/1071635065/?random=1794150857211&cv=11&fst=1794150857211&fmt=8&bg=ffffff&guid=ON&async=1&en=conversion&gtm=45892e6b41v9210171140za204zb841843806zd841843806xecxf4&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tag_exp=115938466~115938468~118897920~118897930~120213116~120385422~120412526~120420416~120469145~120469153~120895657~121191153~121246026~121246034~123814185~124013662&u_w=1280&u_h=720&url=https%3A%2F%2Fwww.markus-baersch.de%2F%3Fgclid%3DTEST-gtg-gclid-1794150833611&gclaw_src=6_7&rcb=5&evjid=yZFERURFqf6k_5gShQ&label=1adstest1&capi=1&gtm_ee=1&frm=0&tiba=Markus%20Baersch%20-%20Webanalyse%2C%20sauberes%20Tagging%20%26%20Datenqualit%C3%A4t&did=dY2E1Nz&gdid=dY2E1Nz&oid=TEST-gtg-1794150833611&value=10&currency_code=EUR&hn=www.googleadservices.com&npa=0&gclaw=TEST-gtg-gclid-1794150833611&pscdl=noapi&auid=808511001.1794150857&uaa=x86&uab=64&uafvl=Chromium%3B145.0.7632.6%7CNot%253AA-Brand%3B99.0.0.0&uamb=0&uam=&uap=Linux&uapv=&uaw=0&oidsrc=1&ecsid=1654611584.1794150857&ecsid2=1088686842.1794150857&gtb=2&gcl_ctr=1~0~0~0&data=event%3Dconversion&gap.gtb=2&aecs=1&category=acrcp_v1_512&_uip=%3A%3A";
const GTG_FD = "https://www.markus-baersch.de/gtgtestakw/d/ccm/form-data/1071635065?gtm=45892e6b41pdv9210171140za204zb841843806zd841843806xecxf4&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tag_exp=115938466~115938468~118897920~118897930~120213116~120385422~120412526~120420416~120469145~120469153~120895657~121191153~121246026~121246034~123814185~124013662&gclaw_src=0_1&rcb=5&did=dY2E1Nz&gdid=dY2E1Nz&npa=0&frm=0&gclaw=TEST-gtg-gclid-1794150833611&pscdl=noapi&auid=808511001.1794150857&uaa=x86&uab=64&uafvl=Chromium%3B145.0.7632.6%7CNot%253AA-Brand%3B99.0.0.0&uamb=0&uam=&uap=Linux&uapv=&uaw=0&ec_mode=c&ecsid2=1088686842.1794150857&gtb=2&gap.gtb=2&aecs=1&fmt=8&_uip=%3A%3A&emd=tvd.1~i1.fem.mc.r12.n12~i2.fpn.mc.r12.n12~i3.ffn0.mc.r4.n4~i4.fln0.mc.r4.n4~i5.fsa0.mc.r11.n9~i6.fct0.mc.r14.n14~i7.fpc0.mc.r5.n5~i8.frg0.mc.r2.n2~i9.fco0.mc.r2.n2&ecsid=1654611584.1794150857&gap.rp=1&eme=tv.1~emkid.a2929c31-ab70-4624-8eec-32e7c957b77e~ev.BEUxhASX-l5xxCE3sKLoUAElBliJbC03d_LPMwy-1KM8PdhJv1LayvmtQCCLOQC9d-98O3sk-yXrxQeDCXMEX818Wj6-T-CNFFO391YE237AG7NRVmk4wn9X2cD-KreFnC7rFayYNqsxSOEzA7dMICCj-YBYoJ_I7nq1BhUxUTMDaCWawbpixv7h--7KW0xmyc8AeIaNG2Jwru89CgcbgiKwgg8vNDHwX5khjNCfwazE-2MvNgjwuHYzYhHQnht42dU2u8LsjZYOj-J2VYn7QvmDifikQu8qnINryAWhB28rrPIjoZ6OnHuqDWNgAk92BLyLN_BLw_re-XhOjHDLSC0mBsNgMvqq5lxr2_1x8BrYbAhQYCM_azGP8TDLrpBzBrc6r-kJoFD-FxX0sZvcS7db2prSQ4kgX4tGxB4-E_62jBqYVT91tXvo2qbbUcb7UtteB-93yeXzacJyRfOcBx2wtCt6xJ0AcmzSzCieKafV7dRAKT4sf7uVSQM_qf9DDH_UAFgw1kkQRC_3FejspZ5_-WHuT5LUBqvd1yQUbX52QjB5BCHrP_hGjYmpozbqY5868ZzrLGyJ2_IICb7NmO7WGTV1xLw%3D&gap.ch=4&gap.el=47&gap.ps=374";
const GTG_DIRECT = "https://www.googleadservices.com/pagead/conversion/1071635065/?random=1794150857211&cv=11&fst=1794150857211&fmt=7&bg=ffffff&guid=ON&async=1&en=conversion&gtm=45892e6b41v9210171140za204zb841843806zd841843806xecxf4&gcs=G111&gcd=13r3r3r2r5l1&dma_cps=a&dma=1&tag_exp=115938466~115938468~118897920~118897930~120213116~120385422~120412526~120420416~120469145~120469153~120895657~121191153~121246026~121246034~123814185~124013662&u_w=1280&u_h=720&url=https%3A%2F%2Fwww.markus-baersch.de%2F%3Fgclid%3DTEST-gtg-gclid-1794150833611&gclaw_src=6_7&rcb=5&evjid=yZFERURFqf6k_5gShQ&label=1adstest1&capi=1&gtm_ee=1&frm=0&tiba=Markus%20Baersch%20-%20Webanalyse%2C%20sauberes%20Tagging%20%26%20Datenqualit%C3%A4t&did=dY2E1Nz&gdid=dY2E1Nz&oid=TEST-gtg-1794150833611&value=10&currency_code=EUR&hn=www.googleadservices.com&npa=0&gclaw=TEST-gtg-gclid-1794150833611&pscdl=noapi&auid=808511001.1794150857&uaa=x86&uab=64&uafvl=Chromium%3B145.0.7632.6%7CNot%253AA-Brand%3B99.0.0.0&uamb=0&uam=&uap=Linux&uapv=&uaw=0&oidsrc=1&ecsid=1654611584.1794150857&ecsid2=1088686842.1794150857&gtb=2&gcl_ctr=1~0~0~0&data=event%3Dconversion&gap.gtb=2&aecs=1&category=acrcp_v1_512&ept=5&epp=5~22~74";
const GTG_PAGE = 'https://www.markus-baersch.de/';

test('gateway: /as/p/c/ is a first-party conversion with label, value and order id', () => {
  const r = parseGoogleAdsRequest(GTG_ASP, null, GTG_PAGE);
  assert.ok(r, 'gateway short form should be recognised');
  assert.equal(r.transport, 'first-party');
  assert.equal(r.convId, '1071635065');
  assert.equal(r.label, '1adstest1');
  assert.deepEqual(r.revenue, { value: '10', currency: 'EUR' });
  assert.equal(r.oid, 'TEST-gtg-1794150833611');
});

test('gateway: /as/p/c/, /as/d/ccm/conversion/ and the direct hit collapse into one signal', () => {
  const keys = [GTG_ASP, GTG_ASD, GTG_DIRECT].map((u) => parseGoogleAdsRequest(u, null, GTG_PAGE)._collapseKey);
  assert.equal(new Set(keys).size, 1);
  assert.equal(parseGoogleAdsRequest(GTG_FD, null, GTG_PAGE).transport, 'first-party');
});
