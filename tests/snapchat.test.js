import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSnapchatRequest, isSnapchatHost,
  extractSnapchatUserData, summarizeSnapchatIdentifiers, extractSnapchatEcommerce,
} from '../lib/snapchat.js';

// Real Snapchat Pixel GET /p hits captured on atomkraftwerke24.de (Markus'
// playground) via GTM: a PAGE_VIEW and a PURCHASE. The pixel id (UUID) is
// pseudonymised; the hashes are the playground's test data (email hash 973dfe46… =
// SHA-256 of test@example.com). Snapchat hashes email/phone/name/age AND geo.
const PSEUDO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const PAGE_VIEW = `https://tr.snapchat.com/p?pid=${PSEUDO}&ev=PAGE_VIEW&intg=gtm&u_hed=a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce1947&u_hem=973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b&u_fn=9baf3a40312f39849f46dad1040f2f039f1cffa1238c41e9db675315cfad39b6&u_hpn=8b47a52ed04d068c3a9c5632b98cec18780a9f9f4099d4f8afe233970ce116fe&pids=${PSEUDO}&u_ln=e32a370b7912ad78cc6a88fda605a5b3657e9c3b164cee669364aaf3f8cdbb36&e_tid=TRANS-TEST-SC1&e_ni=2&e_desc=Description%20here&e_ss=Some%20Search%20String&e_ic=cat1&e_pr=42.22&e_iids=A12%2CB20&e_cur=EUR&u_c1=35f34e89-1bb3-4466-abfa-af3c4d48073a&an_k=pn_al&an_v=u_c1&u_age=73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049&l_city=d1d470d61a1e5e55f9958c8f42c38112e3ba26e2c2e48039b6c68ce800a9be6f&l_gc=959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578&l_gpc=a258c6d49f04610d9f8186def1372332a593a70266652ede4a57083ef06fdf64&l_gr=72b289ec78e0a928c565480a435453e30acb92eddb3b78ff168b28737cf6a849&u_sclid=229dea27-6583-42cf-9f2a-1d8194669b6e&u_scsid=debfa99c-2416-4601-bbfd-e0d6d74a7a6b&gac=5e2a8062&pl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783195851823&rf=https%3A%2F%2Ftagassistant.google.com%2F&trackId=90c2cdd5-59b3-4e01-859c-7c5b0c6d4445&ts=1783196343520&v=3.59.0-2606221835`;

const PURCHASE = `https://tr.snapchat.com/p?pid=${PSEUDO}&ev=PURCHASE&intg=gtm&u_hed=f26ea0a90ac8fff650bf2fa5bf5cb4438ba7ff02e759a2c31d9261f7e07f2e79&u_hem=973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b&u_fn=24d9c7b19834aa278ce9609a00d156f61bd83184c2634d1c2b1d6aaa9c235b3a&u_hpn=8b47a52ed04d068c3a9c5632b98cec18780a9f9f4099d4f8afe233970ce116fe&pids=${PSEUDO}&u_ln=cebcb3427684c616b9d714d133df35c6f6a9e80819849223f55bab2900c4ad11&e_tid=TRANS-TEST-SC1&e_ni=2&e_desc=Description%20here&e_ss=Some%20Search%20String&e_ic=cat1&e_pr=42.22&e_iids=A12%2CB20&e_cur=EUR&u_c1=35f34e89-1bb3-4466-abfa-af3c4d48073a&an_k=pn_al&an_v=u_c1&e_bds=BrandA%2CBrandB&cdid=dedup-test-sc1&e_cs=returning&du=granted&e_dm=delivery&et=test-tag&e_lv=5&e_pia=1&e_sm=email&e_su=1&u_sclid=229dea27-6583-42cf-9f2a-1d8194669b6e&u_scsid=debfa99c-2416-4601-bbfd-e0d6d74a7a6b&gac=5e2a8062&pl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1783195851823&rf=https%3A%2F%2Ftagassistant.google.com%2F&trackId=5279b48e-a07f-4bcd-9156-965735b06250&ts=1783196371375&v=3.59.0-2606221835`;

test('real PAGE_VIEW: event, pixel id, page url, full identifier set', () => {
  const r = parseSnapchatRequest(PAGE_VIEW, null);
  assert.ok(r, 'should be recognised as a Snapchat Pixel event');
  assert.equal(r.provider, 'snapchat');
  assert.equal(r.method, 'GET');
  assert.equal(r.event, 'PAGE_VIEW');
  assert.equal(r.standardEvent, true);
  assert.equal(r.pixelId, PSEUDO);
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html?gtm_debug=1783195851823');
  // email(u_hem) phone(u_hpn) name(u_fn/u_ln) address(l_city/l_gc/l_gpc/l_gr)
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 1, address: 1 });
  assert.equal(r.userData.u_hem.hashed, true);
  assert.ok(r.userData.u_age && r.userData.l_city && r.userData.u_hed);
  assert.equal(r.flags.advancedMatching, true);
  assert.equal(r.clientId, '35f34e89-1bb3-4466-abfa-af3c4d48073a');
  assert.equal(r.clickId, '229dea27-6583-42cf-9f2a-1d8194669b6e');
  assert.equal(r.sessionId, 'debfa99c-2416-4601-bbfd-e0d6d74a7a6b');
});

test('real PURCHASE: revenue, items, dedup, purchase extras', () => {
  const r = parseSnapchatRequest(PURCHASE, null);
  assert.ok(r);
  assert.equal(r.event, 'PURCHASE');
  assert.deepEqual(r.revenue, { value: '42.22', currency: 'EUR' });
  assert.equal(r.ecommerce.transactionId, 'TRANS-TEST-SC1');
  assert.deepEqual(r.ecommerce.itemIds, ['A12', 'B20']);
  assert.deepEqual(r.ecommerce.brands, ['BrandA', 'BrandB']);
  assert.equal(r.flags.dedup, true);
  assert.equal(r.dedupId, 'dedup-test-sc1');
  // PURCHASE carried no geo/age this time → address 0
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 1, address: 0 });
  assert.equal(r.extras['client_deduplication_id'], 'dedup-test-sc1');
  assert.equal(r.extras['customer_status'], 'returning');
  assert.equal(r.extras['data_use'], 'granted');
  assert.equal(r.extras['event_tag'], 'test-tag');
  assert.equal(r.extras['success'], '1');
});

test('helpers: user data (geo hashed too), summary, ecommerce', () => {
  const get = (k) => ({ u_hem: 'a'.repeat(64), l_city: 'b'.repeat(64), u_age: 'c'.repeat(64) })[k] ?? null;
  const ud = extractSnapchatUserData(get);
  assert.equal(ud.u_hem.hashed, true);
  assert.equal(ud.l_city.bucket, 'city');
  assert.equal(ud.u_age.bucket, 'age');
  // age is demographic → not in the {email,phone,name,address} summary
  assert.deepEqual(summarizeSnapchatIdentifiers(ud), { email: 1, phone: 0, name: 0, address: 1 });

  const eget = (k) => ({ e_pr: '9.99', e_cur: 'EUR', e_iids: 'X1,X2' })[k] ?? null;
  assert.deepEqual(extractSnapchatEcommerce(eget), { value: '9.99', currency: 'EUR', itemIds: ['X1', 'X2'] });
});

test('detection: host, event path, and POST telemetry is ignored', () => {
  assert.equal(isSnapchatHost('tr.snapchat.com'), true);
  assert.equal(isSnapchatHost('tr6.snapchat.com'), true);
  assert.equal(isSnapchatHost('sc-static.net'), false);
  assert.equal(isSnapchatHost('snapchat.com'), false);

  // POST /p telemetry carries no pid/ev in the query (data sits in the JSON body) → ignored
  assert.equal(parseSnapchatRequest('https://tr.snapchat.com/p', '{"ctx":{"url":"x"},"req":[]}'), null);
  // config endpoint, wrong host
  assert.equal(parseSnapchatRequest('https://tr.snapchat.com/config/de/x.js', null), null);
  assert.equal(parseSnapchatRequest('https://ct.pinterest.com/p?pid=x&ev=PAGE_VIEW', null), null);
});
