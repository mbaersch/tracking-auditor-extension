import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGa4Request,
  tryDecodeCustomLoader,
  summarizeIdentifiers,
  parseConsent,
  extractUserData,
  extractParams,
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

test('first-party sGTM on standard collect path', () => {
  const r = parseGa4Request('https://sgtm.example.com/g/collect?v=2&tid=G-ABC1234XYZ&en=purchase', null);
  assert.ok(r);
  assert.equal(r.transport, 'first-party');
  assert.equal(r.en, 'purchase');
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
