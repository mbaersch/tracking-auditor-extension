// Microsoft Bing UET request detection & parsing — pure functions, no DOM /
// chrome APIs, so they run both in the panel and under `node --test`. Mirrors the
// shape of lib/ga4.js / lib/meta.js so the panel can treat all providers uniformly.
//
// A UET hit goes to https://bat.bing.com/action/0 (or /actionp/0) as a GET beacon.
// evt distinguishes pageLoad from custom (conversion / e-commerce) events. User
// data (enhanced conversions) rides inside the `pid` parameter as a nested
// querystring: em=<sha256>&ph=<sha256>.

import { extractParams } from './params.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function isBingHost(host) {
  const h = (host || '').toLowerCase();
  return h === 'bat.bing.com' || h.endsWith('.bing.com');
}

function isActionPath(pathname) {
  return /\/actionp?(\/|$)/.test(pathname || '');   // /action/0 or /actionp/0
}

// ---------------------------------------------------------------------------
// user data (enhanced conversions) — inside the pid sub-querystring
// ---------------------------------------------------------------------------

const UET_FIELD = {
  em: { bucket: 'email',     label: 'Email' },
  ph: { bucket: 'phone',     label: 'Phone' },
  fn: { bucket: 'firstName', label: 'First name' },
  ln: { bucket: 'lastName',  label: 'Last name' },
};

// pid looks like "em=<hash>&ph=<hash>" (already %-decoded by extractParams).
// Returns { <key>: { bucket, label, hashed } } or null.
export function parseUetUserData(pid) {
  if (!pid) return null;
  const fields = {};
  let params;
  try { params = new URLSearchParams(pid); } catch (e) { return null; }
  for (const [k, v] of params) {
    const def = UET_FIELD[k];
    if (!def) continue;
    fields[k] = { bucket: def.bucket, label: def.label, hashed: /^[a-f0-9]{64}$/i.test(v) };
  }
  return Object.keys(fields).length ? fields : null;
}

export function summarizeUetIdentifiers(userData) {
  const b = { email: 0, phone: 0, firstName: 0, lastName: 0 };
  for (const key of Object.keys(userData || {})) {
    const bucket = (UET_FIELD[key] || {}).bucket;
    if (bucket && bucket in b) b[bucket] += 1;
  }
  return {
    email: b.email,
    phone: b.phone,
    name: Math.max(b.firstName, b.lastName),
    address: 0,
  };
}

// ---------------------------------------------------------------------------
// Consent — Microsoft Consent Mode
// ---------------------------------------------------------------------------
//
// asc carries the ad_storage consent: "G" = granted, "D" = denied. Its ABSENCE
// is itself meaningful (no consent signal sent), so we always report a state and
// surface "unset" rather than silently omitting it.
export function parseUetConsent(get) {
  const asc = get('asc');
  const cdb = get('cdb');
  let adStorage;
  if (asc === 'G') adStorage = 'granted';
  else if (asc === 'D') adStorage = 'denied';
  else adStorage = 'unset';
  return { adStorage, asc: asc ?? null, cdb: cdb ?? null };
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

// Returns a normalized record or null for non-UET requests.
// transport: 'standard' | 'first-party'
export function parseUetRequest(url, postData) {
  let host = '', pathname = '';
  try { const u = new URL(url); host = u.host; pathname = u.pathname; }
  catch (e) { return null; }

  if (!isActionPath(pathname)) return null;

  const { queryParams, bodyParams } = extractParams(url, postData);
  const get = (k) => queryParams[k] ?? (bodyParams && bodyParams[k]) ?? null;

  const ti = get('ti');
  const evt = get('evt');
  if (!ti) return null; // a UET hit always carries its tag id

  let transport = null;
  if (isBingHost(host)) transport = 'standard';
  else if (/^\d+$/.test(String(ti)) && evt) transport = 'first-party'; // proxied /action on own domain
  if (!transport) return null;

  const userData = parseUetUserData(get('pid'));
  const identifiers = summarizeUetIdentifiers(userData);
  const consent = parseUetConsent(get);

  // Friendly event name: pageLoad stays as-is; custom events take their action
  // (ea), falling back to category (ec).
  const ea = get('ea'), ec = get('ec'), el = get('el'), ev = get('ev');
  const eventName = evt === 'pageLoad' ? 'pageLoad' : (ea || ec || 'custom event');

  const gv = get('gv'), gc = get('gc'), ecv = get('ecomm_totalvalue');
  const revVal = gv != null ? gv : ecv;
  const revenue = revVal != null ? { value: revVal, currency: gc || null } : null;

  const ecommerce = {};
  for (const k of ['prodid', 'pagetype', 'ecomm_totalvalue', 'ecomm_category']) {
    const v = get(k);
    if (v != null) ecommerce[k] = v;
  }
  const hasEcommerce = Object.keys(ecommerce).length > 0;

  const flags = {
    custom: evt !== 'pageLoad',
    revenue: !!revenue,
    enhancedConv: !!userData,
    ecommerce: hasEcommerce,
  };

  return {
    provider: 'uet',
    transport,
    host,
    pathname,
    effectiveUrl: url,
    effectivePath: pathname,
    method: postData ? 'POST' : 'GET',
    ti,
    evt,
    eventName,
    ec, ea, el, ev,
    revenue,
    ecommerce: hasEcommerce ? ecommerce : null,
    userData,
    identifiers,
    flags,
    consent,
    tagManager: get('tm') || null,
    mid: get('mid') || null,
    queryParams,
    bodyParams,
  };
}
