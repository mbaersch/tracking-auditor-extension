import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkedInRequest, isLinkedInHost } from '../lib/linkedin.js';

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

  // /attribution_trigger and /wa/ carry no per-hit event distinction → ignored
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/attribution_trigger?pid=12345678&time=1', null), null);
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/wa/?medium=fetch&fmt=g', 'gzip-blob'), null);

  // collect without a partner id is not a real tag hit
  assert.equal(parseLinkedInRequest('https://px.ads.linkedin.com/collect?v=2', null), null);
  // wrong host
  assert.equal(parseLinkedInRequest('https://ct.pinterest.com/v3/?tid=26123', null), null);
});
