// LinkedIn Insight Tag request detection & parsing — pure functions, no DOM /
// chrome APIs, so they run both in the panel and under `node --test`. Mirrors the
// shape of the other provider modules so the panel treats every provider uniformly.
//
// A LinkedIn Insight Tag hit goes to px.ads.linkedin.com/collect as a GET beacon,
// and is mirrored 1:1 to px4.ads.linkedin.com/collect — the px4 twin adds an
// `e_ipv6` param (an encrypted/hashed client IP) but is otherwise identical. We
// collapse the two into a single card (the px4 mirror wins as survivor because it
// carries the IP hash). The payload rides entirely in the query string:
//   pid          partner id (the Insight Tag / ad account id)
//   conversionId present ONLY on a conversion — its absence means a plain page view
//   url          page url · tm  tag manager (gtmv2) · time  timestamp · v/fmt  version
//
// Two neighbouring endpoints are intentionally ignored: `/attribution_trigger`
// (pid/time/url only — a redundant duplicate of the collect signal) and `/wa/`
// (a gzip-compressed POST carrying pageTitle + a hashed-email `hem` for enhanced
// conversions; decompressing it needs an async DecompressionStream that would
// break the synchronous parser, and the collect hit already carries the signal
// that matters). The collect beacon holds the info worth surfacing.

import { extractParams } from './params.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// px.ads.linkedin.com, px4.ads.linkedin.com, bare ads.linkedin.com.
export function isLinkedInHost(host) {
  const h = (host || '').toLowerCase();
  return /(^|\.)ads\.linkedin\.com$/.test(h);
}

function isCollectPath(pathname) {
  return /\/collect(\/|$)/.test(pathname || '');
}

// The subdomain label (px / px4) used as the transport mirror label on collapse.
function subdomainLabel(host) {
  const h = (host || '').toLowerCase();
  const m = h.match(/^([^.]+)\.ads\.linkedin\.com$/);
  return m ? m[1] : 'linkedin';
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

// Returns a normalized record or null for non-LinkedIn / ignored requests.
export function parseLinkedInRequest(url, postData) {
  let host = '', pathname = '';
  try { const u = new URL(url); host = u.host; pathname = u.pathname; }
  catch (e) { return null; }

  if (!isLinkedInHost(host)) return null;
  if (!isCollectPath(pathname)) return null;              // /wa/, /attribution_trigger → ignored

  const { queryParams, bodyParams } = extractParams(url, postData);
  const get = (k) => queryParams[k] ?? (bodyParams && bodyParams[k]) ?? null;

  const pid = get('pid');
  if (!pid) return null;                                  // a collect hit always carries its partner id

  const conversionId = get('conversionId');
  const isConversion = conversionId != null && conversionId !== '';
  const ipHash = get('e_ipv6');
  const label = subdomainLabel(host);

  const flags = {
    conversion: isConversion,
    ipHash: !!ipHash,                                     // e_ipv6 present (px4 mirror)
  };

  return {
    provider: 'linkedin',
    transport: 'standard',
    host,
    pathname,
    effectiveUrl: url,
    effectivePath: pathname,
    method: postData ? 'POST' : 'GET',
    pid: String(pid),
    conversionId: isConversion ? String(conversionId) : null,
    eventName: isConversion ? 'Conversion' : 'PageView',
    isConversion,
    pageUrl: get('url') || null,
    tagManager: get('tm') || null,
    version: get('v') || null,
    ipHash: ipHash || null,
    time: get('time') || null,
    // no user identifiers travel in the collect beacon (hem rides in the ignored
    // /wa/ POST) — keep the standard shape so summary rendering stays uniform.
    userData: null,
    identifiers: { email: 0, phone: 0, name: 0, address: 0 },
    consent: null,                                        // no consent signal in the collect request
    flags,
    queryParams,
    bodyParams,
    // transport bundling (consumed by the panel's generic collapse step): the px4
    // mirror carries e_ipv6, so it outranks the plain px hit and wins as survivor.
    _collapseKey: `li:${pid}:${isConversion ? conversionId : 'pv'}:${get('time') || ''}`,
    _transportLabel: label,
    _transportRank: ipHash ? 100 : 90,
  };
}
