import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMetaRequest,
  extractMetaUserData,
  summarizeMetaIdentifiers,
  parseMetaConsent,
  parseMetaSignal,
  metaUnfiredPixelIds,
} from '../lib/meta.js';

// Real Meta Lead request captured on atomkraftwerke24.de (Markus' playground).
// Carries advanced matching in all four representations (cud/ncud masks + ud/aud
// hashes) and was sent via Stape's GTM template (a=stape-gtm-…) as a form POST.
const LEAD_QS = 'id=377194366672297&ev=Lead&dl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1782748830800&rl=https%3A%2F%2Ftagassistant.google.com%2F&if=false&ts=1782748875905&iw=false&sw=1920&sh=1080&cud%5Bph%5D=%2B%23%23%23%23%23%23%23%23%23%23%23&cud%5Bem%5D=****%40****.**&cud%5Bfn%5D=%5E***&cud%5Bln%5D=%5E***&cud%5Bct%5D=%5E**+%5E*********&cud%5Bst%5D=%5E%5E&cud%5Bzp%5D=%23%23%23%23%23&cud%5Bcountry%5D=%5E%5E&ncud%5Bem%5D=****%40****.**&ud%5Bem%5D=369c34cc4d37efef17780dc262a53e80ab7cb1c051a17ed889d711d5f94f78f3&ncud%5Bph%5D=%23%23%23%23%23%23%23%23%23%23%23&ud%5Bph%5D=62e6bd1bc2dc69da3405ca426ee312587c92b366287a2218bcecc1faf310bf6c&ncud%5Bfn%5D=****&ud%5Bfn%5D=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08&ncud%5Bln%5D=****&ud%5Bln%5D=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08&ncud%5Bct%5D=*************&ud%5Bct%5D=e68493a2f09bd8ad143d685fb5cef984a19282e9abc1013eb75b32d4e263de84&ncud%5Bst%5D=**&ud%5Bst%5D=a7e2d26e8d15814dd9c6a1bdc90585c8d0a3170dfffeb21fc42986683113041b&ncud%5Bzp%5D=%23%23%23%23%23&ud%5Bzp%5D=c36562c53838cb8ed23e9de694b67c8f42ebd246ce5073a43a8eac6535122504&ncud%5Bcountry%5D=**&ud%5Bcountry%5D=959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578&aud%5Bem%5D=369c34cc4d37efef17780dc262a53e80ab7cb1c051a17ed889d711d5f94f78f3&aud%5Bph%5D=62e6bd1bc2dc69da3405ca426ee312587c92b366287a2218bcecc1faf310bf6c&aud%5Bfn%5D=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08&aud%5Bln%5D=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08&aud%5Bct%5D=e68493a2f09bd8ad143d685fb5cef984a19282e9abc1013eb75b32d4e263de84&aud%5Bst%5D=a7e2d26e8d15814dd9c6a1bdc90585c8d0a3170dfffeb21fc42986683113041b&aud%5Bzp%5D=c36562c53838cb8ed23e9de694b67c8f42ebd246ce5073a43a8eac6535122504&aud%5Bcountry%5D=959a45d44e6fcf58361ed004681556fe50129f2109e817dec098c00c9e5d2578&v=2.9.345&r=stable&a=stape-gtm-1.2.0-pb&ec=2&o=4126&aems=0%3B0&fbp=fb.1.1778869247376.52390506499288804.AQYCAQMA&ler=other&cdl=API_unavailable&pmd%5Blocale%5D=de&plt=192&iss=1&imft=1&tz=120&it=1782748870896&coo=false&tm=1&expv2%5B0%5D=pl1&expv2%5B1%5D=el3&expv2%5B2%5D=bc1&expv2%5B3%5D=ra2&expv2%5B4%5D=rp2&expv2%5B5%5D=im0&expv2%5B6%5D=hf1&rqm=formPOST';
const LEAD_URL = 'https://www.facebook.com/tr/?' + LEAD_QS;

test('real Meta Lead is detected and core fields read', () => {
  const r = parseMetaRequest(LEAD_URL, null);
  assert.ok(r, 'should be recognised as a Meta pixel hit');
  assert.equal(r.provider, 'meta');
  assert.equal(r.transport, 'standard');
  assert.equal(r.host, 'www.facebook.com');
  assert.equal(r.id, '377194366672297');
  assert.equal(r.ev, 'Lead');
  assert.equal(r.standardEvent, true);
  assert.equal(r.method, 'POST');        // rqm=formPOST
  assert.equal(r.sourceLib, 'stape-gtm-1.2.0-pb');
});

test('advanced matching: four representations collapse to one field each', () => {
  const r = parseMetaRequest(LEAD_URL, null);
  assert.ok(r.userData);
  // 8 distinct fields: em ph fn ln ct st zp country
  assert.equal(Object.keys(r.userData).length, 8);
  const em = r.userData.em;
  assert.equal(em.bucket, 'email');
  assert.equal(em.hashed, true);          // ud[em] / aud[em]
  assert.equal(em.mask, '****@****.**');  // cud[em]
  // Meta st is state, not street
  assert.equal(r.userData.st.bucket, 'region');
});

test('identifier summary counts each field once across representations', () => {
  const r = parseMetaRequest(LEAD_URL, null);
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 1, address: 1 });
});

test('flags: advanced matching present, no dedup id, no custom data, no LDU', () => {
  const r = parseMetaRequest(LEAD_URL, null);
  assert.equal(r.flags.advancedMatching, true);
  assert.equal(r.flags.dedup, false);     // no eid in this hit
  assert.equal(r.flags.cdCount, 0);       // a Lead without custom data
  assert.equal(r.flags.ldu, false);
  assert.equal(r.consent, null);
});

test('standard facebook.com/tr GET PageView', () => {
  const r = parseMetaRequest('https://www.facebook.com/tr/?id=123&ev=PageView&dl=https%3A%2F%2Fx.de%2F', null);
  assert.ok(r);
  assert.equal(r.transport, 'standard');
  assert.equal(r.ev, 'PageView');
  assert.equal(r.method, 'GET');
  assert.equal(r.userData, null);
});

test('custom event with custom data and dedup id', () => {
  const r = parseMetaRequest('https://www.facebook.com/tr/?id=123&ev=MyCustom&eid=abc-1&cd%5Bvalue%5D=9.99&cd%5Bcurrency%5D=EUR', null);
  assert.ok(r);
  assert.equal(r.standardEvent, false);
  assert.equal(r.flags.dedup, true);
  assert.equal(r.flags.cdCount, 2);
  assert.equal(r.customData.value, '9.99');
  assert.equal(r.customData.currency, 'EUR');
});

test('first-party proxied /tr on own domain (numeric id + ev)', () => {
  const r = parseMetaRequest('https://track.example.com/abc/tr?id=999&ev=Purchase', null);
  assert.ok(r);
  assert.equal(r.transport, 'first-party');
  assert.equal(r.ev, 'Purchase');
});

test('LDU / data_processing_options is surfaced as consent', () => {
  const r = parseMetaRequest('https://www.facebook.com/tr/?id=123&ev=PageView&dpo=LDU&dpoco=1&dpost=1000', null);
  assert.ok(r.consent);
  assert.equal(r.consent.ldu, true);
  assert.equal(r.flags.ldu, true);
  assert.equal(r.consent.country, '1');
  assert.equal(r.consent.state, '1000');
});

test('form POST body params are parsed (urlencoded)', () => {
  const r = parseMetaRequest('https://www.facebook.com/tr/', 'id=123&ev=AddToCart&cd%5Bvalue%5D=5');
  assert.ok(r);
  assert.equal(r.ev, 'AddToCart');
  assert.equal(r.customData.value, '5');
});

test('the fbevents.js loader and non-pixel facebook URLs are ignored', () => {
  assert.equal(parseMetaRequest('https://connect.facebook.net/en_US/fbevents.js', null), null);
  assert.equal(parseMetaRequest('https://www.facebook.com/somepage?id=123', null), null);
  assert.equal(parseMetaRequest('https://www.facebook.com/tr/?ev=PageView', null), null); // no id
});

// Real pixel-init config fetch captured on erp.heizungsdiscount24.de — the pixel
// initialises but is blocked from sending events ("traffic permission" settings).
const SIGNAL_URL = 'https://connect.facebook.net/signals/config/549591473162841?v=2.9.349&r=stable&domain=erp.heizungsdiscount24.de&optin_meta_enabled_capi=true&hme=f29d86973612db0f0627890a64bdc8c47b471189050b33f2680b7d76997afc9a&ex_m=107%2C208';

test('parseMetaSignal reads the pixel-init config fetch', () => {
  const s = parseMetaSignal(SIGNAL_URL);
  assert.ok(s, 'should be recognised as a pixel-init signal');
  assert.equal(s.id, '549591473162841');
  assert.equal(s.domain, 'erp.heizungsdiscount24.de');
  assert.equal(s.capiOptin, true);
  assert.equal(s.version, '2.9.349');
});

test('parseMetaSignal ignores /tr events, the loader and unrelated URLs', () => {
  assert.equal(parseMetaSignal('https://www.facebook.com/tr/?id=123&ev=PageView'), null);
  assert.equal(parseMetaSignal('https://connect.facebook.net/en_US/fbevents.js'), null);
  assert.equal(parseMetaSignal('https://connect.facebook.net/signals/config/'), null); // no id
  assert.equal(parseMetaSignal('https://example.com/signals/config/123'), null);       // wrong host
});

test('metaUnfiredPixelIds returns config ids that never fired an event', () => {
  assert.deepEqual(metaUnfiredPixelIds(['123', '456'], ['456']), ['123']);
  assert.deepEqual(metaUnfiredPixelIds(['123', '123'], new Set()), ['123']); // dedupes
  assert.deepEqual(metaUnfiredPixelIds(['123'], ['123']), []);
  assert.deepEqual(metaUnfiredPixelIds([], ['123']), []);
});

test('extractMetaUserData / summarize work standalone', () => {
  const ud = extractMetaUserData({ 'ud[em]': 'h', 'cud[em]': '****@*.*', 'ud[ph]': 'h2' }, null);
  assert.equal(Object.keys(ud).length, 2);
  assert.deepEqual(summarizeMetaIdentifiers(ud), { email: 1, phone: 1, name: 0, address: 0 });
  assert.equal(parseMetaConsent((k) => null), null);
});
