import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGa4Request,
  tryDecodeCustomLoader,
  summarizeIdentifiers,
  parseConsent,
  extractUserData,
  extractParams,
  parseGa4ProductItem,
  parseGa4Products,
  ga4PiiFields,
} from '../lib/ga4.js';

const b64 = (s) => Buffer.from(s).toString('base64');

// Real Stape custom-loader request captured on data.europart.net (no user_data).
const STAPE_URL = "https://data.europart.net/6ifbjhkjas?de5cc8ea=L2cvY29sbGVjdD92PTImdGlkPUctSjBUUEo1N05GRCZndG09NDVoZTY2bzF2OTEzMzU5MTExMXo4OTI0NTA4NTMzOHphMjBremI5MjQ1MDg1MzM4emQ5MjQ1MDg1MzM4Jl9wPTE3ODI3MzYwMTI3MDYmZ2NzPUcxMTEmZ2NkPTEzbjNuUG4ybjVsMSZucGE9MCZkbWFfY3BzPWEmZG1hPTEmZ2RpZD1kT1RoaFpEJmVjaWQ9ODI1MTM4MDAzJl9ldT1BQUFBQUFRJmFyZT0xJmNpZD02OTU1NDY2MDQuMTc3MjQ2Mzg1NCZmcm09MCZwc2NkbD1ub2FwaSZyY2I9NiZzcj0xOTIweDEwODAmdWFhPXg4NiZ1YWI9NjQmdWFmdmw9R29vZ2xlJTI1MjBDaHJvbWUlM0IxNDkuMC43ODI3LjExNCU3Q0Nocm9taXVtJTNCMTQ5LjAuNzgyNy4xMTQlN0NOb3QpQSUyNTNCQnJhbmQlM0IyNC4wLjAuMCZ1YW09JnVhbWI9MCZ1YXA9V2luZG93cyZ1YXB2PTE5LjAuMCZ1YXc9MCZ1bD1kZS1kZSZ1cj1ERSZzc3Qucm5kPTMwNjk0MzUyMC4xNzgyNzM2MDEzJnNzdC5ldGxkPWdvb2dsZS5kZSZzc3QuZ2NzdWI9cmVnaW9uMSZzc3QudGZ0PTE3ODI3MzYwMTI3MDYmc3N0LmxwYz0xMDY4MjI3MiZzc3QubmF2dD1yJnNzdC51ZGU9MCZzc3Quc3dfZXhwPTEmX3M9MSZ0YWdfZXhwPTExNTYxNjk4NX4xMTU5Mzg0NjZ%2BMTE1OTM4NDY4fjExOTAyNzIyNH4xMTk1NzY4OTF%2BMTE5NTc2ODk1JnNpZD0xNzgyNzM1MDEyJnNjdD0yJnNlZz0xJmRsPWh0dHBzJTNBJTJGJTJGd3d3LmV1cm9wYXJ0Lm5ldCUyRiZkdD1FVVJPUEFSVCUyMCU3QyUyMENvbW1lcmNpYWwlMjB2ZWhpY2xlJTIwc3BhcmUlMjBwYXJ0cyUyMCU3QyUyMFdvcmtzaG9wJTIwc3VwcGxpZXMmX3R1PURBJmVuPXBhZ2VfdmlldyZnYXAuZ3RiPTImZXZuaWQ9MTc4MjczNjAxMjk3Ni4yNDY3MjYuNyZ0ZmQ9MzYzNyZyaWNoc3N0c3Nl";

test('Stape base64 transport is detected and decoded', () => {
  const r = parseGa4Request(STAPE_URL, null);
  assert.ok(r, 'should be recognised as GA4');
  assert.equal(r.transport, 'stape-b64');
  assert.equal(r.en, 'page_view');
  assert.equal(r.tid, 'G-J0TPJ57NFD');
  assert.equal(r.host, 'data.europart.net');
  assert.equal(r.userData, null);            // this hit carries no user_data
  assert.ok(r.consent, 'gcs=G111 should yield consent');
  assert.equal(r.consent.adStorage, 'granted');
  assert.equal(r.consent.analyticsStorage, 'granted');
});

test('standard Google GA4 request', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234XYZ&en=page_view', null);
  assert.ok(r);
  assert.equal(r.transport, 'standard');
  assert.equal(r.en, 'page_view');
});

test('first-party sGTM on the page’s own registrable domain', () => {
  // sgtm.example.com ↔ inspected page www.example.com → same eTLD+1 → first-party.
  const r = parseGa4Request('https://sgtm.example.com/g/collect?v=2&tid=G-ABC1234XYZ&en=purchase', null, 'https://www.example.com/checkout');
  assert.ok(r);
  assert.equal(r.transport, 'first-party');
  assert.equal(r.en, 'purchase');
});

test('sGTM on a foreign domain is unknown, not first-party', () => {
  // Common real setup: GA4 routed through the SSP vendor’s own subdomain.
  const r = parseGa4Request('https://abc.taggrs.io/g/collect?v=2&tid=G-ABC1234XYZ&en=purchase', null, 'https://example.com/');
  assert.ok(r);
  assert.equal(r.transport, 'unknown');
});

test('collect on a non-Google host without a page URL cannot claim first-party', () => {
  // No inspected page to compare against → no same-site evidence → unknown.
  const r = parseGa4Request('https://sgtm.example.com/g/collect?v=2&tid=G-ABC1234XYZ&en=purchase', null);
  assert.ok(r);
  assert.equal(r.transport, 'unknown');
});

test('plaintext custom path (cryptic path, plain params)', () => {
  const r = parseGa4Request('https://data.example.com/adhhsdf3?v=2&tid=G-ABC1234XYZ&en=purchase', null);
  assert.ok(r);
  assert.equal(r.transport, 'custom-path');
  assert.equal(r.en, 'purchase');
});

test('non-GA4 asset request is ignored', () => {
  assert.equal(parseGa4Request('https://data.example.com/static/app.js?v=2', null), null);
});

test('gtag/js loader (base64) is skipped — no event', () => {
  const url = 'https://data.example.com/loader?p=' + encodeURIComponent(b64('/gtag/js?id=G-ABC1234XYZ'));
  assert.equal(parseGa4Request(url, null), null);
  assert.deepEqual(tryDecodeCustomLoader(url), { kind: 'skip' });
});

test('POST body params are parsed (urlencoded)', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X', 'en=add_to_cart&cu=EUR');
  assert.ok(r);
  assert.equal(r.en, 'add_to_cart');
  assert.equal(r.method, 'POST');
});

test('user_data summary from structured ep.user_data params', () => {
  const url = 'https://data.example.com/xyz?enc=' + encodeURIComponent(b64(
    '/g/collect?v=2&tid=G-X&en=purchase&ep.user_data.sha256_email_address=aaa&ep.user_data.sha256_phone_number=bbb'));
  const r = parseGa4Request(url, null);
  assert.ok(r.userData);
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 0, address: 0 });
});

test('user_data summary from JSON body with arrays', () => {
  const body = JSON.stringify({ user_data: { email_address: ['a', 'b'], phone_number: 'p', address: [{ first_name: 'f', last_name: 'l', postal_code: '123' }] } });
  const r = parseGa4Request('https://sgtm.example.com/g/collect?v=2&tid=G-X&en=purchase', body);
  assert.ok(r.userData);
  assert.deepEqual(r.identifiers, { email: 2, phone: 1, name: 1, address: 1 });
});

test('ga4PiiFields: structured user_data flattened to category + hash form', () => {
  const sha = 'a'.repeat(64);
  const ud = { sha256_email_address: sha, phone_number: '+491701234567' };
  const fields = ga4PiiFields(ud, null);
  assert.equal(fields.sha256_email_address.label, 'Email');
  assert.equal(fields.sha256_email_address.algo, 'sha256');
  // A cleartext phone reports no hash form — stated plainly, not alarmed.
  assert.equal(fields.phone_number.label, 'Phone');
  assert.equal(fields.phone_number.algo, null);
  assert.equal(fields.phone_number.hashed, false);
});

test('ga4PiiFields: em token contributes fields too', () => {
  const sha = 'b'.repeat(64);
  const fields = ga4PiiFields(null, `tv.1~em.${sha}~fn0.${sha}`);
  assert.equal(fields.em.label, 'Email');
  assert.equal(fields.em.algo, 'sha256');
  assert.equal(fields.fn0.label, 'First name');
});

test('ga4PiiFields: null when no identifiers', () => {
  assert.equal(ga4PiiFields(null, null), null);
  assert.equal(ga4PiiFields({ non_identifier: 'x' }, ''), null);
});

test('identifier summary from em tokens', () => {
  const em = 'tv.1~em.HASH~pn.HASH~fn0.HASH~ln0.HASH~co0.HASH';
  const ids = summarizeIdentifiers(null, em);
  assert.deepEqual(ids, { email: 1, phone: 1, name: 1, address: 1 });
});

test('accepts HAR-style postData object (panel interface)', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X', { mimeType: 'text/plain', text: 'en=add_to_cart&cu=EUR' });
  assert.ok(r);
  assert.equal(r.en, 'add_to_cart');
});

test('flags: session start, first visit, ep count (unique across query+body)', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=page_view&_ss=1&_fv=1&ep.foo=a&epn.bar=2', null);
  assert.equal(r.flags.sessionStart, true);
  assert.equal(r.flags.firstVisit, true);
  assert.equal(r.flags.epCount, 2);
});

test('flags: user-property count (up.* / upn.*), kept separate from ep count', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=login&ep.foo=a&up.plan=pro&upn.age=42', null);
  assert.equal(r.flags.epCount, 1);
  assert.equal(r.flags.upCount, 2);
});

test('flags: conversion (_c) and external event (_ee)', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=purchase&_c=1&_ee=1', null);
  assert.equal(r.flags.conversion, true);
  assert.equal(r.flags.externalEvent, true);
});

test('flags default to false / 0 when absent', () => {
  const r = parseGa4Request('https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=page_view', null);
  assert.equal(r.flags.sessionStart, false);
  assert.equal(r.flags.firstVisit, false);
  assert.equal(r.flags.conversion, false);
  assert.equal(r.flags.externalEvent, false);
  assert.equal(r.flags.epCount, 0);
});

test('consent gcd decoding', () => {
  const c = parseConsent({ gcd: '13t3t3t3t5' }, null);
  assert.ok(c);
  assert.ok(Array.isArray(c.gcdDecoded));
  assert.equal(c.gcdDecoded[0].purpose, 'ad_storage');
  assert.equal(c.gcdDecoded[0].state, 'granted');
});

test('extractParams keeps JSON body accessible', () => {
  const { bodyJson, bodyParams } = extractParams('https://x/g/collect', '{"en":"x","user_data":{"email_address":"a"}}');
  assert.ok(bodyJson);
  assert.equal(bodyJson.en, 'x');
  assert.ok(extractUserData({}, bodyParams, bodyJson));
});

// --- e-commerce items (pr1..prN) -------------------------------------------

// Real, fully-loaded pr1 decoded from a view_item on atomkraftwerke24.de. Carries
// every standard item field plus two item-scoped custom params (k0/v0, k1/v1).
const PR1 = 'idca528821~nmCaleffi Sicherheitsgruppe SiCalCenter®, 1/2" 10 bar, 12 Liter~afOnline Store DE~cpITEM-CPN-1~ds5~lp0~brCaleffi~caHeizung~c2Sicherheitstechnik~c3Sicherheitsgruppen~c4Kategorie4~c5Kategorie5~lirelated_products~lnÄhnliche Produkte~va1/2 Zoll~loChIJ-DE-Store-001~pr76.9~qt1~piPROMO-SOMMER~pnSommeraktion 2026~cnhero_banner~csfeatured_1~k0test_ci_color~v0messing~k1test_ci_material~v1Rotguss & Messing';

test('parseGa4ProductItem decodes every standard field code', () => {
  const it = parseGa4ProductItem(PR1);
  assert.equal(it.fields.item_id, 'ca528821');
  assert.equal(it.fields.item_name, 'Caleffi Sicherheitsgruppe SiCalCenter®, 1/2" 10 bar, 12 Liter');
  assert.equal(it.fields.affiliation, 'Online Store DE');
  assert.equal(it.fields.coupon, 'ITEM-CPN-1');
  assert.equal(it.fields.discount, '5');
  assert.equal(it.fields.index, '0');
  assert.equal(it.fields.item_brand, 'Caleffi');
  assert.equal(it.fields.item_category, 'Heizung');
  assert.equal(it.fields.item_category2, 'Sicherheitstechnik');
  assert.equal(it.fields.item_category5, 'Kategorie5');
  assert.equal(it.fields.item_list_id, 'related_products');
  assert.equal(it.fields.item_list_name, 'Ähnliche Produkte');
  assert.equal(it.fields.item_variant, '1/2 Zoll');    // 'va' not mis-read as custom value
  assert.equal(it.fields.location_id, 'ChIJ-DE-Store-001');
  assert.equal(it.fields.price, '76.9');
  assert.equal(it.fields.quantity, '1');
  assert.equal(it.fields.promotion_id, 'PROMO-SOMMER');
  assert.equal(it.fields.promotion_name, 'Sommeraktion 2026');
  assert.equal(it.fields.creative_name, 'hero_banner');
  assert.equal(it.fields.creative_slot, 'featured_1');
});

test('parseGa4ProductItem pairs k<n>/v<n> custom params and surfaces unknowns', () => {
  const it = parseGa4ProductItem(PR1);
  assert.deepEqual(it.custom, { test_ci_color: 'messing', test_ci_material: 'Rotguss & Messing' });
  assert.deepEqual(it.unknown, {});
  // an unrecognised 2-char code is kept, never dropped
  const u = parseGa4ProductItem('idX~zz99');
  assert.equal(u.fields.item_id, 'X');
  assert.deepEqual(u.unknown, { zz: '99' });
});

test('parseGa4Products collects pr1..prN in numeric order', () => {
  const items = parseGa4Products({ pr2: 'idB~pr2', pr1: 'idA~pr1', en: 'view_item' }, null);
  assert.equal(items.length, 2);
  assert.equal(items[0].fields.item_id, 'A');
  assert.equal(items[1].fields.item_id, 'B');
  assert.equal(parseGa4Products({ en: 'page_view' }, null), null);
});

// Real, fully URL-encoded view_cart hit — exercises the whole path incl. decoding.
const VIEW_CART_URL = 'https://region1.analytics.google.com/g/collect?v=2&tid=G-6JRL4ZVK1J&_p=1783588249526&en=view_cart&cu=EUR&pr1=idca528821~nmCaleffi%20Sicherheitsgruppe%20SiCalCenter%C2%AE%2C%201%2F2%22%2010%20bar%2C%2012%20Liter~afOnline%20Store%20DE~cpITEM-CPN-1~ds5~lp0~brCaleffi~caHeizung~c2Sicherheitstechnik~c3Sicherheitsgruppen~c4Kategorie4~c5Kategorie5~lirelated_products~ln%C3%84hnliche%20Produkte~va1%2F2%20Zoll~loChIJ-DE-Store-001~pr76.9~qt1~piPROMO-SOMMER~pnSommeraktion%202026~cnhero_banner~csfeatured_1~k0test_ci_color~v0messing~k1test_ci_material~v1Rotguss%20%26%20Messing&pr2=idrxekhhe200cv37~nmDaikin%20Altherma%20M%20HW%20200%2C%20Warmwasser-W%C3%A4rmepumpe%20200L~brDaikin~caW%C3%A4rmepumpen~va200%20Liter~pr1745~qt1~lp1~k0test_ci_color~v0wei%C3%9F~k1test_ci_material~v1Stahl&ep.transaction_id=T-DEBUG-0001&epn.value=1821.9';

test('parseGa4Request surfaces decoded items end-to-end', () => {
  const r = parseGa4Request(VIEW_CART_URL, null);
  assert.ok(r);
  assert.equal(r.en, 'view_cart');
  assert.equal(r.currency, 'EUR');
  assert.equal(r.flags.itemCount, 2);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].fields.item_name, 'Caleffi Sicherheitsgruppe SiCalCenter®, 1/2" 10 bar, 12 Liter');
  assert.equal(r.items[0].custom.test_ci_material, 'Rotguss & Messing');   // %26 → & decoded
  assert.equal(r.items[1].fields.item_name, 'Daikin Altherma M HW 200, Warmwasser-Wärmepumpe 200L');
  assert.equal(r.items[1].custom.test_ci_color, 'weiß');                   // %C3%9F → ß decoded
});
