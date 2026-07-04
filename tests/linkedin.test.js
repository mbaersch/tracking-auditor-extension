import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkedInRequest, isLinkedInHost } from '../lib/linkedin.js';
import { parseLinkedInWaRequest, isLinkedInWaRequest } from '../lib/linkedin.js';
import { WA_PAGE_VISIT, WA_CLICK } from './fixtures/linkedin-wa-bodies.js';
import { gzipSync } from 'node:zlib';

// Real LinkedIn Insight Tag hits captured on atomkraftwerke24.de (Markus'
// playground): a page-view burst (px + px4 collect, no conversionId) and a
// conversion burst (px + px4 collect, conversionId present). The px4 mirrors add
// the encrypted-IP `e_ipv6` param.

const PV_PX  = 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1783018238450&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783018219377&tm=gtmv2';
const PV_PX4 = 'https://px4.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1783018238450&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783018219377&tm=gtmv2&e_ipv6=AQKdMrP3gCBXlgAAAZ8kKzBLKIZqWcZwAjnFwSW4gKQevUSwa2iyg7TfAAEJd3SrN5bCZ0qoFHeqmbeTiiRtwAFkDgVH';
const CV_PX  = 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1783018301282&conversionId=111111111111&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783018219377&tm=gtmv2';
const CV_PX4 = 'https://px4.ads.linkedin.com/collect?v=2&fmt=js&pid=12345678&time=1783018301282&conversionId=111111111111&url=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783018219377&tm=gtmv2&e_ipv6=AQIIgn492Ge9OQAAAZ8kLCW04SWrcbUXmmYFGbT_e4C0fLxetHHzWtLGq58WvLu_xHRvjxcmZnYtXn_0e7PfWzT-wNH_';

test('real page view (px): partner id, PageView event, page url', () => {
  const r = parseLinkedInRequest(PV_PX, null);
  assert.ok(r, 'should be recognised as a LinkedIn Insight Tag hit');
  assert.equal(r.provider, 'linkedin');
  assert.equal(r.transport, 'standard');
  assert.equal(r.method, 'GET');
  assert.equal(r.pid, '12345678');
  assert.equal(r.conversionId, null);
  assert.equal(r.isConversion, false);
  assert.equal(r.eventName, 'PageView');
  assert.equal(r.flags.conversion, false);
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1783018219377');
  assert.equal(r.tagManager, 'gtmv2');
  assert.equal(r.ipHash, null);
  assert.equal(r.flags.ipHash, false);
  assert.deepEqual(r.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
});

test('real page view (px4 mirror): adds encrypted IP, still a PageView', () => {
  const r = parseLinkedInRequest(PV_PX4, null);
  assert.ok(r);
  assert.equal(r.eventName, 'PageView');
  assert.ok(r.ipHash && r.ipHash.startsWith('AQKdMrP3'));
  assert.equal(r.flags.ipHash, true);
  assert.equal(r._transportLabel, 'px4');
});

test('real conversion (px): conversionId promotes it to a Conversion', () => {
  const r = parseLinkedInRequest(CV_PX, null);
  assert.ok(r);
  assert.equal(r.eventName, 'Conversion');
  assert.equal(r.isConversion, true);
  assert.equal(r.conversionId, '111111111111');
  assert.equal(r.flags.conversion, true);
  assert.equal(r.pid, '12345678');
});

test('px and px4 mirrors of one hit share a collapse key; px4 outranks px', () => {
  const px  = parseLinkedInRequest(PV_PX, null);
  const px4 = parseLinkedInRequest(PV_PX4, null);
  assert.equal(px._collapseKey, px4._collapseKey);          // same pid + pv + time
  assert.ok(px4._transportRank > px._transportRank);        // the IP-hash mirror wins as survivor
  assert.equal(px._transportLabel, 'px');

  // A page view and a conversion in the same burst do NOT collapse together.
  const cv = parseLinkedInRequest(CV_PX, null);
  assert.notEqual(px._collapseKey, cv._collapseKey);
});

test('POST body params are read too', () => {
  const r = parseLinkedInRequest('https://px.ads.linkedin.com/collect', 'pid=99&conversionId=42');
  assert.ok(r);
  assert.equal(r.method, 'POST');
  assert.equal(r.pid, '99');
  assert.equal(r.eventName, 'Conversion');
});

test('detection: hosts, ignored endpoints, and required pid', () => {
  assert.equal(isLinkedInHost('px.ads.linkedin.com'), true);
  assert.equal(isLinkedInHost('px4.ads.linkedin.com'), true);
  assert.equal(isLinkedInHost('www.linkedin.com'), false);

  // /attribution_trigger has no per-hit event distinction → ignored. /wa/ is NOT
  // handled by the sync parser (it needs async gzip decode via parseLinkedInWaRequest),
  // so the sync parser correctly returns null here too.
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/attribution_trigger?pid=12345678&time=1', null), null);
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/wa/?medium=fetch&fmt=g', 'gzip-blob'), null);

  // collect without a partner id is not a real tag hit
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/collect?v=2', null), null);
  // wrong host
  assert.equal(parseLinkedInRequest('https://ct.pinterest.com/v3/?tid=26123', null), null);
});

const WA_URL = 'https://px.ads.linkedin.com/wa/';

test('wa detection: host + /wa/ path only', () => {
  assert.equal(isLinkedInWaRequest(WA_URL), true);
  assert.equal(isLinkedInWaRequest('https://px.ads.linkedin.com/collect?pid=1'), false);
  assert.equal(isLinkedInWaRequest('https://ct.pinterest.com/wa/'), false);
});

test('real /wa/ PAGE_VISIT: decoded, no hem, no PII', async () => {
  const r = await parseLinkedInWaRequest(WA_URL, { text: WA_PAGE_VISIT });
  assert.ok(r, 'should decode the /wa/ page-visit body');
  assert.equal(r.provider, 'linkedin');
  assert.equal(r._endpoint, 'wa');
  assert.equal(r.method, 'POST');
  assert.equal(r.signalType, 'PAGE_VISIT');
  assert.equal(r.eventName, 'PAGE_VISIT');
  assert.equal(r.pid, '12345678');
  assert.equal(r.hem, null);
  assert.equal(r.userData, null);
  assert.equal(r.flags.hashedEmail, false);
  assert.equal(r.flags.liFat, false);
  assert.deepEqual(r.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
  assert.equal(r.pageTitle, 'Enhanced Conversions Testseite');
  assert.equal(r._collapseKey, 'li-wa:a8b241ae-049f-6e40-7585-1466dc162595');
  assert.equal(r._transportLabel, 'px');
});

test('real /wa/ CLICK: hem present → email identifier + PII flag', async () => {
  const r = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  assert.ok(r);
  assert.equal(r.signalType, 'CLICK');
  assert.equal(r.eventName, 'CLICK');
  assert.equal(r.hem, '8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa');
  assert.equal(r.identifiers.email, 1);
  assert.equal(r.flags.hashedEmail, true);
  assert.ok(r.userData && r.userData.email && r.userData.email.hashed === true);
  assert.equal(r.waPayload.domAttributes.innerText, 'Absenden');
  assert.equal(r.waPayload.domAttributes.isFormSubmission, true);
  assert.equal(r._collapseKey, 'li-wa:465b5ae1-4213-c38b-d548-6c98d71b7a1e');
});

test('duplicate /wa/ fires collapse: same websiteSignalRequestId → same key', async () => {
  const a = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  const b = await parseLinkedInWaRequest(WA_URL, { text: WA_CLICK });
  assert.equal(a._collapseKey, b._collapseKey);
});

test('liFatId, when present, is surfaced and flagged', async () => {
  const body = { pids: [12345678], signalType: 'PAGE_VISIT', hem: null,
                 url: 'https://x.test/', pageTitle: 'x', time: 1, scriptVersion: 308,
                 websiteSignalRequestId: 'w-1', liFatId: 'abc123', liGiant: '' };
  const text = Buffer.from(gzipSync(Buffer.from(JSON.stringify(body)))).toString('base64');
  const r = await parseLinkedInWaRequest(WA_URL, { text });
  assert.equal(r.liFatId, 'abc123');
  assert.equal(r.flags.liFat, true);
});

test('/wa/ decode failures return null, never throw', async () => {
  assert.equal(await parseLinkedInWaRequest(WA_URL, { text: '' }), null);
  assert.equal(await parseLinkedInWaRequest(WA_URL, { text: 'not-base64-gzip!!' }), null);
  assert.equal(await parseLinkedInWaRequest(WA_URL, null), null);
  assert.equal(await parseLinkedInWaRequest('https://ct.pinterest.com/wa/', { text: WA_CLICK }), null);
});
