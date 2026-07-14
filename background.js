// Deep Capture (Spike) — second capture source.
//
// The panel's primary feed is chrome.devtools.network, which is bound to the
// inspected tab's page target. Hits dispatched from a *service worker's own scope*
// (first-party Tag Gateway / Cloudflare edge) run in a separate worker context and
// never surface there. chrome.webRequest, by contrast, observes traffic at the
// network layer regardless of the initiating context, so it *does* see those
// worker hits.
//
// This background worker registers webRequest listeners and relays matching events
// to any DevTools panel that has connected and told us which tab it inspects. The
// panel de-dupes against its DevTools feed (see panel.js): a hit both sources see
// is shown once (DevTools wins); a hit only webRequest delivers is the invisible
// worker hit we're hunting.
//
// Worker-dispatched requests often carry tabId === -1 (no frame association) —
// which is *why* the page-scoped API misses them. We can't map those back to a
// tab, so we relay them to every connected panel. To keep one inspected tab's
// hits out of another's capture, the panel drops a fanned-out (tabId < 0) hit
// whose initiator origin doesn't match its own inspected page (see
// onWebRequestEvent in panel.js) — a first-party worker is same-origin with its
// page, so the legitimate hits we're hunting still pass.

const ports = new Map(); // tabId -> Set<Port>

function relay(tabId, event) {
  const set = ports.get(tabId);
  if (!set) return;
  for (const port of set) {
    try { port.postMessage(event); } catch (e) { /* port is tearing down */ }
  }
}

// Decode a webRequest requestBody into a plain string the parsers understand —
// extractParams() accepts a string or {text}. Handles raw bytes (fetch / Beacon
// JSON or form-encoded payloads) and structured formData.
function decodeBody(requestBody) {
  if (!requestBody) return '';
  if (requestBody.raw && requestBody.raw.length) {
    try {
      const dec = new TextDecoder('utf-8');
      return requestBody.raw.map((part) => (part.bytes ? dec.decode(part.bytes) : '')).join('');
    } catch (e) { return ''; }
  }
  if (requestBody.formData) {
    return Object.entries(requestBody.formData)
      .map(([k, vals]) => vals.map((v) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'))
      .join('&');
  }
  return '';
}

function toEvent(details) {
  return {
    kind: 'wr-request',
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    postData: details.method !== 'GET' ? decodeBody(details.requestBody) : '',
    tabId: details.tabId,
    ts: details.timeStamp,
    initiator: details.initiator || null,
    resourceType: details.type,   // 'xmlhttprequest' | 'ping' | 'image' | …
  };
}

function onBeforeRequest(details) {
  if (!ports.size) return;                 // no panel listening — nothing to relay
  const event = toEvent(details);
  if (details.tabId >= 0) { relay(details.tabId, event); return; }
  // No tab association — likely a worker-dispatched hit. Fan out to all panels.
  for (const tabId of ports.keys()) relay(tabId, event);
}

// The <all_urls> host permission is optional and requested at runtime when the user
// enables Deep Capture (see panel.js). webRequest delivers nothing without it, so we
// only attach the listener while the permission is actually held — and (de)attach it
// live as the user grants or revokes it.
const HOST = { origins: ['<all_urls>'] };
let listening = false;

function syncListener() {
  chrome.permissions.contains(HOST, (has) => {
    if (has && !listening) {
      chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ['<all_urls>'] }, ['requestBody']);
      listening = true;
    } else if (!has && listening) {
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
      listening = false;
    }
  });
}

chrome.permissions.onAdded.addListener(syncListener);
chrome.permissions.onRemoved.addListener(syncListener);
syncListener();   // on service-worker startup: attach if the permission is already held

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'auditor-panel') return;
  let myTab = null;
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'init' && typeof msg.tabId === 'number') {
      myTab = msg.tabId;
      if (!ports.has(myTab)) ports.set(myTab, new Set());
      ports.get(myTab).add(port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (myTab == null) return;
    const set = ports.get(myTab);
    if (!set) return;
    set.delete(port);
    if (!set.size) ports.delete(myTab);
  });
});
