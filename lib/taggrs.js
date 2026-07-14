// TAGGRS custom-loader (a Stape alternative) detection & decryption — pure
// functions plus one async WebCrypto decode, so they run in the panel and under
// `node --test` (Node 22 ships crypto.subtle).
//
// The loader encrypts the real GTM / gtag request so the network tab shows only
// an opaque envelope. It is symmetric AES-256-GCM with the key HARDCODED in the
// loader JS (`const ENCRYPTION_KEY = '<32 hex chars>'`) — so, given the loader
// body captured in the same session, we decrypt in-session and surface the
// hidden hit through the normal parser registry.
//
// Two transports, both emitted by the loader's encrypt() as `${ivHex}:${ctHex}`:
//   POST envelope : body = {"m":<origMethod>,"u":<enc rel-url>,"b":<enc body>?}
//   GET  proxied  : url  = <proxyBase>/<clientId>?p=<enc rel-url>   (mostly scripts)
//
// Key detail that trips people up: the key is the TextEncoder bytes of the
// 32-char hex STRING (32 bytes → AES-256), NOT the 16 raw bytes the hex encodes.
// IV = first 12 bytes; ciphertext carries the trailing 16-byte GCM tag.

const KEY_RE  = /ENCRYPTION_KEY\s*=\s*['"]([0-9a-f]{32})['"]/i;
const BLOB_RE = /^([0-9a-f]{24}):([0-9a-f]{32,})$/i;   // ivHex(12B) : ctHex(≥16B tag)

// The 32-char AES key string from a loader body, or null.
export function extractTaggrsKey(jsText) {
  if (typeof jsText !== 'string') return null;
  const m = jsText.match(KEY_RE);
  return m ? m[1] : null;
}

// Is this JS a taggrs custom loader? (carries the key AND a taggrs-shaped marker,
// so we don't grab a stray 32-hex constant from an unrelated script).
export function looksLikeTaggrsLoader(jsText) {
  if (typeof jsText !== 'string' || !KEY_RE.test(jsText)) return false;
  return /AES-GCM/.test(jsText) &&
    /\$\{ivHex\}:\$\{encryptedHex\}|GTM_SERVER_URL|PROXY_BASE_URL/.test(jsText);
}

function splitBlob(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(BLOB_RE);
  return m ? { iv: m[1], ct: m[2] } : null;
}

function bodyText(postData) {
  if (typeof postData === 'string') return postData;
  return postData && typeof postData.text === 'string' ? postData.text : null;
}

// Recognise a taggrs-proxied request WITHOUT the key. Returns
// { method, host, clientId, u, b } where u/b are {iv,ct} (b may be null), or null.
export function parseTaggrsEnvelope(url, postData) {
  let host = '', pathname = '';
  try { const u = new URL(url); host = u.host; pathname = u.pathname; }
  catch (e) { return null; }
  const clientId = (pathname.match(/^\/([a-z0-9]+)/i) || [])[1] || null;

  // POST envelope {"m","u","b"?}
  const bt = bodyText(postData);
  if (bt) {
    let obj = null;
    try { obj = JSON.parse(bt); } catch (e) { obj = null; }
    if (obj && typeof obj === 'object' && typeof obj.u === 'string') {
      const u = splitBlob(obj.u);
      if (u) return { method: obj.m || 'POST', host, clientId, u, b: splitBlob(obj.b) || null };
    }
  }
  // GET ?p=<iv>:<ct>
  try {
    const u = splitBlob(new URL(url).searchParams.get('p'));
    if (u) return { method: 'GET', host, clientId, u, b: null };
  } catch (e) { /* unparseable */ }
  return null;
}

// True when a request carries a taggrs envelope (cheap; no decryption).
export function isTaggrsRequest(url, postData) {
  return parseTaggrsEnvelope(url, postData) != null;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Decrypt one {iv,ct} blob with the loader key. Async (WebCrypto). Resolves to the
// plaintext string; rejects on a bad key / failed GCM auth tag.
export async function decryptTaggrsBlob(blob, keyString) {
  const keyBytes = new TextEncoder().encode(keyString);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(blob.iv) }, key, hexToBytes(blob.ct));
  return new TextDecoder().decode(pt);
}

// Full decode: taggrs envelope + key → a plain request { url, method, postData }
// ready for the normal parser registry, or null. The decrypted `u` is a relative
// path (e.g. /g/collect?…&en=scroll…) rebuilt against the proxy host.
export async function decodeTaggrsRequest(url, postData, keyString) {
  const env = parseTaggrsEnvelope(url, postData);
  if (!env || !keyString) return null;
  const rel = await decryptTaggrsBlob(env.u, keyString);
  if (!rel.startsWith('/')) return null;                 // sanity: must be a path
  const body = env.b ? await decryptTaggrsBlob(env.b, keyString) : null;
  return {
    url: 'https://' + env.host + rel,
    method: env.method,
    postData: body,
    host: env.host,
    clientId: env.clientId,
  };
}
