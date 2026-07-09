// Helpers for interpreting DevTools HAR entries before they reach the parsers.

// Detects the phantom request a service worker leaves behind. When a page calls
// fetch() and a service worker (e.g. Cloudflare Zaraz) intercepts it via
// respondWith(fetch(...)), the DevTools network domain surfaces *two* entries for
// one logical hit: the page-side fetch — which never reaches the network and is
// reported as an abort with no server connection — and the service worker's own
// outgoing request, which carries the real connection. The webRequest API only
// ever sees the latter, which is why a webRequest-based observer never doubles.
//
// We drop the phantom: it has a network error *and* no server connection, so it
// provably never left the machine. A hit that actually went out always has a
// serverIPAddress, so real traffic (including client-blocked requests, which keep
// their intended server target) is untouched.
export function isServiceWorkerPhantom(harEntry) {
  if (!harEntry) return false;
  const res = harEntry.response || {};
  return Boolean(res._error) && !harEntry.serverIPAddress && harEntry.connection == null;
}

// Detects the Google Tag Gateway "first-party mode" service-worker loader, e.g.
//   https://data.example.com/_/service_worker/<hash>/sw_iframe.html?origin=…&1p=1
// Its presence means the site delivers tags first-party via a service worker, so
// the actual collect hits may be dispatched from the worker context and stay
// invisible to the page-scoped DevTools network — worth flagging to the user.
export function isTagGatewaySwIframe(url) {
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch (e) { return false; }
  return pathname.includes('/service_worker/') && pathname.endsWith('sw_iframe.html');
}
