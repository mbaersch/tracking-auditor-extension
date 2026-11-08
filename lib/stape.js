// Stape Custom Loader tunnel: the real request path+query rides base64-encoded in a
// single query parameter of a disguised first-party URL. Pure functions, no DOM /
// chrome APIs. GA4 decodes its own tunnel in lib/ga4.js; this generic decode lets the
// panel re-run every OTHER provider on the plaintext URL.

import { decodeBase64Utf8 } from './ga4.js';

// Providers whose parser is bound to the vendor host get the decoded path rebuilt
// on that host (same table as tracking-auditor's STAPE_PATH_HOSTS); everything else
// stays on the tunnel host, where path-based parsers (Google Ads, Meta /tr) match.
const CANONICAL_HOSTS = [
  { prefix: '/activity', host: 'ad.doubleclick.net' },
];

// Script loads share the tunnel's URL shape but are not hits.
const SCRIPT_PATH = /^\/(gtag\/js|gtm\.js)(\?|$)|\.js(\?|$)/;

// → { url, host, encodedParam, decodedPath } | null
export function decodeStapeTunnel(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  for (const [key, value] of u.searchParams) {
    if (!value || value.length < 10) continue;
    let decoded;
    try { decoded = decodeBase64Utf8(decodeURIComponent(value)); } catch (e) { continue; }
    if (!/^\/[^\s]*$/.test(decoded) || SCRIPT_PATH.test(decoded)) continue;
    const canon = CANONICAL_HOSTS.find((c) => decoded.startsWith(c.prefix));
    try {
      const target = new URL('https://' + (canon ? canon.host : u.host) + decoded);
      return { url: target.href, host: u.host, encodedParam: key, decodedPath: decoded };
    } catch (e) { continue; }
  }
  return null;
}
