// Outbrain pixel detection & parsing — pure functions, no DOM / chrome APIs, so
// they run in the panel and under `node --test`. Sits next to Taboola as the
// other native-ads pixel.
//
// Outbrain's conversion pixel (obApi) loads from amplify.outbrain.com/cp/obtp.js
// and fires a GET to tr.outbrain.com/unifiedPixel. The `PAGE_VIEW` is automatic;
// conversions are advertiser-named events sent via obApi('track', '<name>', {…}).
// (amplify./wave./my./sync.outbrain.com are the loader, dashboard and id-sync —
// not tracking events — and are ignored.)
//
// unifiedPixel query params (PAGE_VIEW captured natively on posterlounge; the
// conversion shapes come from obApi('track', …) fired from the console — that
// exercises the same client code path and reveals the parameter NAMES, which is
// the point; on posterlounge the real conversions run server-side via ssGTM, so a
// client-side conversion pixel is synthesized here, not that site's normal flow):
//   marketerId  the Outbrain account (32-hex)      name  the event (PAGE_VIEW, or an
//   dl          document location (page url)             advertiser conversion name:
//   referrer    the page's referrer                      Purchase / AddToCart / Lead /
//   pRef        the previous page                        ViewContent / …)
//   cht         channel the pixel fired through (e.g. 'gtm')   zone  region (euZone1)
//   orderValue / currency / orderId   conversion value, when a conversion is fired
//                                     client-side with values (many advertisers do)
//   obApiVersion · obtpVersion  API / pixel build   ·  bust  cache-buster · au · g · pld
//
// No hashed PII rode these hits. Outbrain does offer hashed-identifier matching in
// some setups; if it ever appears we surface it, but we do not guess a parameter.

import { extractParams } from './params.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// Only the tracking host counts; the loader / dashboard / id-sync hosts do not.
export function isOutbrainHost(host) {
  return (host || '').toLowerCase() === 'tr.outbrain.com';
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

export function parseOutbrainRequest(url, postData) {
  let host = '', pathname = '', search = null;
  try { const u = new URL(url); host = u.host; pathname = u.pathname; search = u.searchParams; }
  catch (e) { return null; }

  if (!isOutbrainHost(host)) return null;
  if (pathname !== '/unifiedPixel') return null;          // the only tracking endpoint

  const marketerId = search.get('marketerId');
  const name = search.get('name');
  if (!marketerId || !name) return null;                  // every fire carries both

  const { queryParams, bodyParams } = extractParams(url, postData);

  const pageView = name === 'PAGE_VIEW';
  const orderValue = search.get('orderValue');
  const revenue = (orderValue != null && orderValue !== '')
    ? { value: String(orderValue), currency: search.get('currency') || null }
    : null;

  const flags = {
    pageView,
    conversion: !pageView,                                // any non-PAGE_VIEW is an advertiser conversion
    ecommerce: !!revenue,
  };

  return {
    provider: 'outbrain',
    transport: 'standard',
    host,
    pathname,
    effectiveUrl: url,
    effectivePath: pathname,
    method: postData ? 'POST' : 'GET',
    event: String(name),                                  // advertiser-defined, verbatim
    account: String(marketerId),                          // marketerId
    pageUrl: search.get('dl') || null,
    referrer: search.get('referrer') || null,
    previousPage: search.get('pRef') || null,
    channel: search.get('cht') || null,                   // how it fired, e.g. 'gtm'
    zone: search.get('zone') || null,
    apiVersion: search.get('obApiVersion') || null,
    pixelVersion: search.get('obtpVersion') || null,
    revenue,
    orderId: search.get('orderId') || null,
    flags,
    consent: null,                                        // no consent signal on the unifiedPixel
    userData: null,                                       // no hashed PII observed
    identifiers: { email: 0, phone: 0, name: 0, address: 0 },
    queryParams,
    bodyParams,
  };
}
