import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isServiceWorkerPhantom, isTagGatewaySwIframe } from '../lib/har.js';

// Shapes derived from cloudflare-sw.har: a page fires GA4 hits while a Cloudflare
// service worker intercepts each fetch, so every hit shows up twice in DevTools —
// once as an aborted page-side phantom (no server connection) and once as the
// worker's real outgoing request (real serverIPAddress + connection).
const phantom = (en) => ({
  startedDateTime: '2026-07-06T10:05:14.606Z',
  serverIPAddress: '',                       // never reached a server
  request: { method: 'POST', url: `https://region1.analytics.google.com/g/collect?en=${en}` },
  response: { status: 204, _transferSize: 0, _error: 'net::ERR_ABORTED' },
});
const real = (en) => ({
  startedDateTime: '2026-07-06T10:05:14.607Z',
  serverIPAddress: '[2001:4860:4802:32::36]',
  connection: '443',
  request: { method: 'POST', url: `https://region1.analytics.google.com/g/collect?en=${en}` },
  response: { status: 204, _transferSize: 57 },
});

test('service-worker phantom (aborted, no connection) is detected', () => {
  assert.equal(isServiceWorkerPhantom(phantom('page_view')), true);
});

test('the real outgoing request is not treated as a phantom', () => {
  assert.equal(isServiceWorkerPhantom(real('page_view')), false);
});

test('a single successful hit (no service worker) is not a phantom', () => {
  // user_engagement in the capture arrived only once, with a real connection.
  assert.equal(isServiceWorkerPhantom(real('user_engagement')), false);
});

test('a client-blocked request keeps its server target and is not dropped', () => {
  // ERR_BLOCKED_BY_CLIENT still carries the intended serverIPAddress, so we keep
  // it — the auditor should still show that a tag tried to fire.
  const blocked = {
    serverIPAddress: '[2001:4860:4802:32::36]',
    request: { method: 'POST', url: 'https://region1.analytics.google.com/g/collect?en=purchase' },
    response: { status: 0, _error: 'net::ERR_BLOCKED_BY_CLIENT' },
  };
  assert.equal(isServiceWorkerPhantom(blocked), false);
});

test('filtering the full cloudflare-sw capture collapses 7 entries to 4 events', () => {
  const capture = [
    real('user_engagement'),          // arrived once
    phantom('page_view'), real('page_view'),
    phantom('FormView'),  real('FormView'),
    phantom('scroll'),    real('scroll'),
  ];
  const kept = capture.filter((e) => !isServiceWorkerPhantom(e));
  assert.equal(capture.length, 7);
  assert.equal(kept.length, 4);
  assert.deepEqual(
    kept.map((e) => new URL(e.request.url).searchParams.get('en')),
    ['user_engagement', 'page_view', 'FormView', 'scroll'],
  );
});

test('missing/empty entry is handled gracefully', () => {
  assert.equal(isServiceWorkerPhantom(null), false);
  assert.equal(isServiceWorkerPhantom({}), false);
});

test('Tag Gateway service-worker iframe loader is detected', () => {
  // Real shape captured on atomkraftwerke24.de.
  assert.equal(isTagGatewaySwIframe(
    'https://data.atomkraftwerke24.de/_/service_worker/66u0/sw_iframe.html?origin=https%3A%2F%2Fatomkraftwerke24.de&1p=1'), true);
});

test('ordinary tracking / asset requests are not the SW loader', () => {
  assert.equal(isTagGatewaySwIframe('https://data.atomkraftwerke24.de/g/collect?v=2&en=view_item'), false);
  assert.equal(isTagGatewaySwIframe('https://example.com/service_worker/sw.js'), false); // not the iframe html
  assert.equal(isTagGatewaySwIframe('not a url'), false);
});
