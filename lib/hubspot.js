// HubSpot tracking-code request detection & parsing — pure functions, no DOM /
// chrome APIs, so they run both in the panel and under `node --test`. Mirrors
// lib/reddit.js so the panel treats every provider uniformly.
//
// The HubSpot tracking code (js.hs-scripts.com / js-eu1.hs-scripts.com) fires
// GET .gif beacons to track-<region>.hubspot.com:
//   /__ptq.gif    page view      (trackPageView / automatic)
//   /__ptbe.gif   behavioral hit (trackCustomBehavioralEvent) — event name in `n`
// The payload rides in the query string:
//   a       hub / portal id (the account id)
//   n       custom event name (only on __ptbe.gif)
//   _<name> custom event property, e.g. _property_name=property_value
//   i       identify payload — a URL-encoded querystring nested inside the outer
//           one, e.g. i=email%3Dvisitor%2540example.com%26firstname%3DJohn.
//           Decoded once by the URL layer, once more here → { email, firstname, … }.
//           These identity fields travel in CLEARTEXT (HubSpot does not hash),
//           which the shared PII block honestly reports as "not hashed".
//   pu      page url        t   page title       vi  visitor id
//   u / b   anonymous usertoken composites (not PII)
// identify() only sets identities in the tracker; they reach HubSpot on the next
// trackPageView / trackCustomBehavioralEvent, so `i` can ride on either beacon.

import { extractParams, hashAlgo, looksHashed } from './params.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function isHubspotHost(host) {
  // track.hubspot.com (US) and regional mirrors like track-eu1.hubspot.com.
  return /^track(-[a-z0-9]+)?\.hubspot\.com$/i.test(host || '');
}

// Returns 'pageview' | 'event' | null.
function hubspotPathKind(pathname) {
  if (/^\/__ptq\.gif$/i.test(pathname || '')) return 'pageview';
  if (/^\/__ptbe\.gif$/i.test(pathname || '')) return 'event';
  return null;
}

// ---------------------------------------------------------------------------
// Identify (the `i` param) → user data
// ---------------------------------------------------------------------------

// Known HubSpot contact properties → identifier bucket + label. Anything else in
// the identify payload is surfaced too (bucket 'other', label = the raw key), so
// nothing sent is hidden.
const IDENTIFY_FIELD = {
  email:       { bucket: 'email',     label: 'Email' },
  firstname:   { bucket: 'firstName', label: 'First name' },
  lastname:    { bucket: 'lastName',  label: 'Last name' },
  phone:       { bucket: 'phone',     label: 'Phone' },
  mobilephone: { bucket: 'phone',     label: 'Mobile phone' },
  company:     { bucket: 'other',     label: 'Company' },
  jobtitle:    { bucket: 'other',     label: 'Job title' },
  city:        { bucket: 'city',      label: 'City' },
  state:       { bucket: 'region',    label: 'State' },
  zip:         { bucket: 'postal',    label: 'Zip' },
  country:     { bucket: 'country',   label: 'Country' },
};

// Decode the nested identify querystring into { <field>: <value> } or null. The
// URL layer already decoded one level, so `iRaw` looks like a plain querystring.
export function extractHubspotIdentify(iRaw) {
  if (!iRaw) return null;
  let params;
  try { params = new URLSearchParams(String(iRaw)); } catch (e) { return null; }
  const out = {};
  for (const [k, v] of params) {
    if (v === '') continue;
    out[k.toLowerCase()] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Returns { <field>: { bucket, label, hashed, algo } } or null. HubSpot sends
// these in cleartext, so hashed is false / algo null — reported plainly, no
// leak alarm (that framing was deliberately dropped from the PII block).
export function extractHubspotUserData(identify) {
  if (!identify) return null;
  const ud = {};
  for (const [k, v] of Object.entries(identify)) {
    const def = IDENTIFY_FIELD[k] || { bucket: 'other', label: k };
    ud[k] = { bucket: def.bucket, label: def.label, hashed: looksHashed(v), algo: hashAlgo(v) };
  }
  return Object.keys(ud).length ? ud : null;
}

// Compact { email, phone, name, address } summary — same shape as the other
// providers. Presence-based (1 per bucket).
export function summarizeHubspotIdentifiers(userData) {
  const vals = Object.values(userData || {});
  const has = (...buckets) => vals.some((f) => buckets.includes(f.bucket));
  return {
    email: has('email') ? 1 : 0,
    phone: has('phone') ? 1 : 0,
    name: has('firstName', 'lastName') ? 1 : 0,
    address: has('city', 'region', 'postal', 'country', 'street') ? 1 : 0,
  };
}

// Custom event properties ride as `_<name>` params (trackCustomBehavioralEvent).
export function extractHubspotProperties(queryParams) {
  const props = {};
  for (const [k, v] of Object.entries(queryParams || {})) {
    if (k.length > 1 && k[0] === '_') props[k.slice(1)] = v;
  }
  return Object.keys(props).length ? props : null;
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

// Returns a normalized record or null for non-HubSpot requests.
export function parseHubspotRequest(url, postData) {
  let host = '', pathname = '';
  try { const u = new URL(url); host = u.host; pathname = u.pathname; }
  catch (e) { return null; }

  if (!isHubspotHost(host)) return null;
  const kind = hubspotPathKind(pathname);
  if (!kind) return null;

  const { queryParams, bodyParams } = extractParams(url, postData);
  const get = (k) => queryParams[k] ?? (bodyParams && bodyParams[k]) ?? null;

  const accountId = get('a');
  if (!accountId) return null;                             // every hit carries its hub id

  const eventNameRaw = kind === 'event' ? get('n') : null;
  const event = kind === 'pageview' ? 'Page View' : (eventNameRaw || '(unnamed event)');

  const identify = extractHubspotIdentify(get('i'));
  const userData = extractHubspotUserData(identify);
  const identifiers = summarizeHubspotIdentifiers(userData);
  const properties = kind === 'event' ? extractHubspotProperties(queryParams) : null;

  const flags = {
    pageview: kind === 'pageview',
    customEvent: kind === 'event',
    identify: !!identify,                                  // identify() data rode on this beacon
  };

  return {
    provider: 'hubspot',
    transport: 'standard',
    host,
    pathname,
    effectiveUrl: url,
    effectivePath: pathname,
    method: postData ? 'POST' : 'GET',
    eventType: kind,
    event,
    eventNameRaw,
    accountId: String(accountId),
    pageUrl: get('pu') || null,
    pageTitle: get('t') || null,
    visitorId: get('vi') || null,
    version: get('v') || null,
    properties,
    identify,
    flags,
    userData,
    identifiers,
    consent: null,
    queryParams,
    bodyParams,
  };
}
