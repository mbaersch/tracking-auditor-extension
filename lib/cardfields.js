// Per-provider card-field mapping — pure functions, no DOM / chrome APIs.
//
// A normalized record keeps each provider's own field names (a Meta pixel id
// lives in `id`, a UET tag id in `ti`, …). The card header needs four things out
// of any record regardless of provider: the account id, the label for it, the
// event name, and the document location (page url). This used to be four
// parallel `if (r.provider === …)` ladders in panel.js; a provider added to some
// ladders but not others would silently render a blank field. Here it is ONE
// descriptor per provider, so adding a provider is a single entry — and it is
// unit-tested, which the panel-side ladders never were.
//
// Each descriptor:
//   id(r)     -> the account/pixel/tag id value
//   idTitle   -> the human label for that id
//   event(r)  -> the friendly event name
//   page      -> 'payload' when the page url is on the record as r.pageUrl,
//                otherwise the query/body param key that carries it (dl / p)
export const CARD_FIELDS = {
  ga4:        { id: (r) => r.tid,          idTitle: 'Measurement ID (tid)',    event: (r) => r.en,        page: 'dl' },
  meta:       { id: (r) => r.id,           idTitle: 'Pixel ID (id)',           event: (r) => r.signalType === 'config-no-event' ? 'pixel initialised — no event' : r.ev, page: 'dl' },
  uet:        { id: (r) => r.ti,           idTitle: 'UET Tag ID (ti)',         event: (r) => r.eventName, page: 'p' },
  tiktok:     { id: (r) => r.code,         idTitle: 'Pixel Code',              event: (r) => r.event,     page: 'payload' },
  pinterest:  { id: (r) => r.tid,          idTitle: 'Tag ID (tid)',            event: (r) => r.event,     page: 'payload' },
  googleads:  { id: (r) => r.accountId,    idTitle: 'Conversion ID (AW)',      event: (r) => r.event || (r.signalType === 'upd' ? 'user data' : null), page: 'payload' },
  floodlight: { id: (r) => r.advertiserId, idTitle: 'Floodlight config (src)', event: (r) => r.event || (r.flags && r.flags.sales ? 'sales' : 'counter'), page: 'payload' },
  linkedin:   { id: (r) => r.pid,          idTitle: 'Partner ID (pid)',        event: (r) => r.eventName, page: 'payload' },
  reddit:     { id: (r) => r.pixelId,      idTitle: 'Pixel ID (id)',           event: (r) => r.event,     page: 'payload' },
  snapchat:   { id: (r) => r.pixelId,      idTitle: 'Pixel ID (pid)',          event: (r) => r.event,     page: 'payload' },
  hubspot:    { id: (r) => r.accountId,    idTitle: 'Hub ID (a)',              event: (r) => r.event,     page: 'payload' },
  criteo:     { id: (r) => r.account,      idTitle: 'Criteo account (a)',      event: (r) => r.event,     page: 'payload' },
  taboola:    { id: (r) => r.account,      idTitle: 'Taboola account',         event: (r) => r.event,     page: 'payload' },
  outbrain:   { id: (r) => r.account,      idTitle: 'Marketer ID',             event: (r) => r.event,     page: 'payload' },
  awin:       { id: (r) => r.merchantId,   idTitle: 'Awin merchant (MID)',     event: (r) => r.shape === 'plt' ? 'product level tracking' : (r.shape === 'landing' ? 'landing' : 'sale'), page: 'payload' },
};

// Unknown provider → GA4-style (tid / Measurement ID / en / dl), matching the
// old ladders' fall-through branches.
const DEFAULT = CARD_FIELDS.ga4;

function descriptor(r) {
  return CARD_FIELDS[r && r.provider] || DEFAULT;
}

export function accountId(r)    { return descriptor(r).id(r); }
export function accountTitle(r) { return descriptor(r).idTitle; }
export function eventName(r)    { return descriptor(r).event(r); }

export function docLocation(r) {
  const d = descriptor(r);
  if (d.page === 'payload') return r.pageUrl || null; // the page url lives in the payload
  const key = d.page;                                 // dl (default) / p (UET)
  // Body before query: a POST body carries the event's own payload, so a virtual
  // pageview's dl overrides the shared query value (and each event of a GA4 batch
  // brings its own).
  return (r.bodyParams && r.bodyParams[key]) || (r.queryParams && r.queryParams[key]) || null;
}
