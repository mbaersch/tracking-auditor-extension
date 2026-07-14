// Panel UI controller: captures tracking requests of the inspected tab via the
// DevTools network API and renders them in blocks per navigation. Each request is
// offered to every provider parser (GA4, Meta); the first that claims it wins.
import { parseGa4Request } from './lib/ga4.js';
import { parseMetaRequest, parseMetaSignal } from './lib/meta.js';
import { parseUetRequest } from './lib/uet.js';
import { parseTiktokRequest } from './lib/tiktok.js';
import { parsePinterestRequest } from './lib/pinterest.js';
import { parseGoogleAdsRequest } from './lib/googleads.js';
import { parseFloodlightRequest } from './lib/floodlight.js';
import { parseLinkedInRequest, isLinkedInWaRequest, parseLinkedInWaRequest } from './lib/linkedin.js';
import { parseRedditRequest } from './lib/reddit.js';
import { parseSnapchatRequest } from './lib/snapchat.js';
import { parseHubspotRequest } from './lib/hubspot.js';
import { parseCriteoRequest } from './lib/criteo.js';
import { parseTaboolaRequest } from './lib/taboola.js';
import { parseOutbrainRequest } from './lib/outbrain.js';
import { isServiceWorkerPhantom, isTagGatewaySwIframe } from './lib/har.js';
import { isTaggrsRequest, decodeTaggrsRequest, looksLikeTaggrsLoader, extractTaggrsKey } from './lib/taggrs.js';
import { algoLabel, algoNote } from './lib/params.js';

const recordBtn = document.getElementById('recordBtn');
const clearBtn  = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const recDot    = document.getElementById('recDot');
const recCount  = document.getElementById('recCount');
const emptyEl   = document.getElementById('empty');
const blocksEl  = document.getElementById('blocks');

// Provider parsers, tried in order. Each returns a normalized record or null.
const PARSERS = [
  { id: 'ga4',    parse: parseGa4Request },
  { id: 'meta',   parse: parseMetaRequest },
  { id: 'uet',    parse: parseUetRequest },
  { id: 'tiktok', parse: parseTiktokRequest },
  { id: 'pinterest', parse: parsePinterestRequest },
  // GA4 stays ahead of Google Ads: GA4 only claims /g/collect, Ads owns
  // /ccm/collect (tid=AW-) and the conversion/remarketing/form-data endpoints.
  { id: 'googleads', parse: parseGoogleAdsRequest },
  // Floodlight sits right after Ads: same DoubleClick infrastructure, but a
  // distinct endpoint (ad.doubleclick.net/activity, *.fls.doubleclick.net).
  { id: 'floodlight', parse: parseFloodlightRequest },
  { id: 'linkedin', parse: parseLinkedInRequest },
  { id: 'reddit', parse: parseRedditRequest },
  { id: 'snapchat', parse: parseSnapchatRequest },
  { id: 'hubspot', parse: parseHubspotRequest },
  { id: 'criteo', parse: parseCriteoRequest },
  { id: 'taboola', parse: parseTaboolaRequest },
  { id: 'outbrain', parse: parseOutbrainRequest },
];

const state = {
  recording: false,
  blocks: [],                                             // [{ navUrl, navTime, events:[], _el, _eventsEl }]
  record: { ga4: true, meta: true, uet: true, tiktok: true, pinterest: true, googleads: true, floodlight: true, linkedin: true, reddit: true, snapchat: true, hubspot: true, criteo: true, taboola: true, outbrain: true },           // capture switches (the "in" side)
  filter: { ga4: true, meta: true, uet: true, tiktok: true, pinterest: true, googleads: true, floodlight: true, linkedin: true, reddit: true, snapchat: true, hubspot: true, criteo: true, taboola: true, outbrain: true, text: '' }, // display filter (the "out" side)
  seen: new Set(),                                         // providers that actually appeared in the current capture (drives filter pills for since-disabled/imported services)
  swNoticeMuted: false,                                    // "mute for session": suppress the Tag-Gateway SW notice until the panel reloads
  deepCapture: false,                                       // Spike: also ingest webRequest events (catches worker/edge-dispatched hits the DevTools feed misses)
  taggrsKeys: {},                                          // sGTM host → AES key sniffed from the taggrs loader body (decrypts its envelopes)
  taggrsPending: {},                                        // sGTM host → [{block,req,ts,source}] hits that raced ahead of the loader key
};

// Filter pills are built from this order; only enabled or already-seen services
// get a pill, so the bar carries nothing for a service you never record.
const PROVIDER_ORDER = ['ga4', 'googleads', 'floodlight', 'meta', 'uet', 'tiktok', 'pinterest', 'linkedin', 'reddit', 'snapchat', 'hubspot', 'criteo', 'taboola', 'outbrain'];
const PROVIDER_LABEL = { ga4: 'GA4', googleads: 'Google Ads', floodlight: 'Floodlight', meta: 'Meta', uet: 'Bing', tiktok: 'TikTok', pinterest: 'Pinterest', linkedin: 'LinkedIn', reddit: 'Reddit', snapchat: 'Snapchat', hubspot: 'HubSpot', criteo: 'Criteo', taboola: 'Taboola', outbrain: 'Outbrain' };

// --- helpers ---------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }
function pathOf(url) { try { return new URL(url).pathname; } catch (e) { return ''; } }

function totalEvents() {
  return state.blocks.reduce((n, b) => n + b.events.length, 0);
}

function formatTime(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// Provider-agnostic accessors.
function eventName(r) {
  if (r.provider === 'meta')   return r.signalType === 'config-no-event' ? 'pixel initialised — no event' : r.ev;
  if (r.provider === 'uet')    return r.eventName;
  if (r.provider === 'tiktok') return r.event;
  if (r.provider === 'pinterest') return r.event;
  if (r.provider === 'googleads') return r.event || (r.signalType === 'upd' ? 'user data' : null); // UPD form-data carries no en
  if (r.provider === 'floodlight') return r.event || (r.flags && r.flags.sales ? 'sales' : 'counter'); // type/cat is the advertiser's own name
  if (r.provider === 'linkedin') return r.eventName;
  if (r.provider === 'reddit')   return r.event;
  if (r.provider === 'snapchat') return r.event;
  if (r.provider === 'hubspot')  return r.event;
  if (r.provider === 'criteo')   return r.event;
  if (r.provider === 'taboola')  return r.event;
  if (r.provider === 'outbrain') return r.event;

  return r.en;
}
function accountId(r) {
  if (r.provider === 'meta')   return r.id;
  if (r.provider === 'uet')    return r.ti;
  if (r.provider === 'tiktok') return r.code;
  if (r.provider === 'pinterest') return r.tid;
  if (r.provider === 'googleads') return r.accountId;   // AW-<convId>
  if (r.provider === 'floodlight') return r.advertiserId; // src — Floodlight config / advertiser id
  if (r.provider === 'linkedin') return r.pid;
  if (r.provider === 'reddit')   return r.pixelId;
  if (r.provider === 'snapchat') return r.pixelId;
  if (r.provider === 'hubspot')  return r.accountId;      // hub / portal id (a)
  if (r.provider === 'criteo')   return r.account;        // Criteo account (a)
  if (r.provider === 'taboola')  return r.account;        // Taboola account (numeric)
  if (r.provider === 'outbrain') return r.account;        // Outbrain marketerId
  return r.tid;
}
function accountTitle(r) {
  if (r.provider === 'meta')   return 'Pixel ID (id)';
  if (r.provider === 'uet')    return 'UET Tag ID (ti)';
  if (r.provider === 'tiktok') return 'Pixel Code';
  if (r.provider === 'pinterest') return 'Tag ID (tid)';
  if (r.provider === 'googleads') return 'Conversion ID (AW)';
  if (r.provider === 'floodlight') return 'Floodlight config (src)';
  if (r.provider === 'linkedin') return 'Partner ID (pid)';
  if (r.provider === 'reddit')   return 'Pixel ID (id)';
  if (r.provider === 'snapchat') return 'Pixel ID (pid)';
  if (r.provider === 'hubspot')  return 'Hub ID (a)';
  if (r.provider === 'criteo')   return 'Criteo account (a)';
  if (r.provider === 'taboola')  return 'Taboola account';
  if (r.provider === 'outbrain') return 'Marketer ID';
  return 'Measurement ID (tid)';
}
function docLocation(r) {
  if (r.provider === 'tiktok' || r.provider === 'pinterest' || r.provider === 'googleads' || r.provider === 'floodlight' || r.provider === 'linkedin' || r.provider === 'reddit' || r.provider === 'snapchat' || r.provider === 'hubspot' || r.provider === 'criteo' || r.provider === 'taboola' || r.provider === 'outbrain') return r.pageUrl || null; // page url lives in the payload
  const key = r.provider === 'uet' ? 'p' : 'dl';   // UET carries the page url in p
  return (r.queryParams && r.queryParams[key]) || (r.bodyParams && r.bodyParams[key]) || null;
}

// --- pill / summary rendering ---------------------------------------------

// GA4 transport sub-pills shown next to the GA4 provider pill. 'standard' and
// 'unknown' get none: standard is the plain vendor path, and 'unknown' is an
// unconfirmed transport we deliberately do NOT label (it may change tomorrow).
const GA4_TRANSPORT_SUB = {
  'first-party': { cls: 'pill-custom', label: 'first-party', tip: 'sGTM / Tag Gateway on the site’s own registrable domain (page eTLD+1 == host eTLD+1)' },
  'stape-b64':   { cls: 'pill-stape',  label: 'Stape b64',   tip: 'Stape Custom Loader — GA4 path was base64-encoded inside the request URL' },
  'custom-path': { cls: 'pill-custom', label: 'Custom path',  tip: 'Custom delivery path without a standard /collect segment' },
};

// Every card leads with a solid provider pill (GA4 / Meta / Bing) so the stream
// reads consistently; transport variants follow as secondary pills.
function providerPills(r) {
  if (r.provider === 'meta') {
    const pills = ['<span class="pill pill-meta" title="Meta (Facebook) Pixel — facebook.com/tr">Meta</span>'];
    if (r.transport === 'first-party') {
      pills.push('<span class="pill pill-custom" title="First-party proxied /tr on the site&#39;s own domain">first-party</span>');
    }
    return pills.join('');
  }
  if (r.provider === 'uet') {
    const pills = ['<span class="pill pill-bing" title="Microsoft Bing UET — bat.bing.com/action">Bing</span>'];
    if (r.transport === 'first-party') {
      pills.push('<span class="pill pill-custom" title="First-party proxied /action on the site&#39;s own domain">first-party</span>');
    }
    return pills.join('');
  }
  if (r.provider === 'tiktok') {
    const pills = ['<span class="pill pill-tiktok" title="TikTok Pixel — analytics.tiktok.com/api/v2/pixel">TikTok</span>'];
    if (r.transport === 'base64') {
      pills.push('<span class="pill pill-stape" title="base64 transport — JSON payload base64-encoded in ?analytics_message=">base64</span>');
    }
    return pills.join('');
  }
  if (r.provider === 'pinterest') {
    return '<span class="pill pill-pinterest" title="Pinterest Tag — ct.pinterest.com/v3">Pinterest</span>';
  }
  if (r.provider === 'googleads') {
    const SIG = { conversion: 'conversion', remarketing: 'remarketing', measurement: 'measurement', upd: 'UPD' };
    const pills = ['<span class="pill pill-googleads" title="Google Ads — googleadservices.com / doubleclick / google.com ccm">Google Ads</span>'];
    const sig = SIG[r.signalType];
    if (sig) pills.push(`<span class="pill pill-event" title="signal type — all transport mirrors of one hit are folded into this card">${escapeHtml(sig)}</span>`);
    if (r.transport === 'first-party') {
      pills.push('<span class="pill pill-custom" title="sGTM-proxied Ads endpoint on the site&#39;s own registrable domain (page eTLD+1 == host eTLD+1)">first-party</span>');
    }
    return pills.join('');
  }
  if (r.provider === 'floodlight') {
    const pills = ['<span class="pill pill-floodlight" title="Google Marketing Platform Floodlight (CM360 / DV360) — ad.doubleclick.net/activity + *.fls.doubleclick.net/activityi">Floodlight</span>'];
    pills.push(r.flags && r.flags.sales
      ? '<span class="pill pill-event" title="a sales activity (dc_pre=…;cost / qty present) — a conversion with value">sales</span>'
      : '<span class="pill pill-event" title="a counter activity — a page/action count, no monetary value">counter</span>');
    return pills.join('');
  }
  if (r.provider === 'linkedin') {
    const pills = ['<span class="pill pill-linkedin" title="LinkedIn Insight Tag — px.ads.linkedin.com/collect">LinkedIn</span>'];
    if (r.isConversion) pills.push('<span class="pill pill-event" title="conversionId present — a LinkedIn conversion">conversion</span>');
    return pills.join('');
  }
  if (r.provider === 'reddit') {
    return '<span class="pill pill-reddit" title="Reddit Pixel — alb.reddit.com/rp.gif">Reddit</span>';
  }
  if (r.provider === 'snapchat') {
    return '<span class="pill pill-snapchat" title="Snapchat Pixel — tr.snapchat.com/p">Snapchat</span>';
  }
  if (r.provider === 'criteo') {
    return '<span class="pill pill-criteo" title="Criteo OneTag — sslwidget.criteo.com/event">Criteo</span>';
  }
  if (r.provider === 'taboola') {
    const pills = ['<span class="pill pill-taboola" title="Taboola Pixel — trc.taboola.com (/trc/3/json page view · /log/3 events)">Taboola</span>'];
    if (r.shape === 'pageview') pills.push('<span class="pill pill-event" title="/trc/3/json — the page-view pixel (event in data.mpvd.en)">page view</span>');
    if (r.flags && r.flags.engagement) pills.push('<span class="pill pill-consent-info" title="en=pre_d_eng_tb — time-on-site / scroll telemetry, not a real event (the Taboola helper blacklists it)">engagement</span>');
    return pills.join('');
  }
  if (r.provider === 'outbrain') {
    const pills = ['<span class="pill pill-outbrain" title="Outbrain Pixel — tr.outbrain.com/unifiedPixel (obApi)">Outbrain</span>'];
    if (r.flags && r.flags.pageView) pills.push('<span class="pill pill-event" title="name=PAGE_VIEW — the automatic page-view fire">page view</span>');
    return pills.join('');
  }
  if (r.provider === 'hubspot') {
    const pills = ['<span class="pill pill-hubspot" title="HubSpot — track.hubspot.com beacons (__ptq/__ptbe/__ptc) + Collected Forms">HubSpot</span>'];
    if (r.eventType === 'pageview') pills.push('<span class="pill pill-event" title="__ptq.gif — a page view">page view</span>');
    if (r.eventType === 'click')    pills.push('<span class="pill pill-event" title="__ptc.gif — a click / interaction on a tracked element">click</span>');
    if (r.eventType === 'form')     pills.push('<span class="pill pill-custom" title="Collected Forms — a scraped form submission (hscollectedforms.net)">collected form</span>');
    return pills.join('');
  }
  const pills = ['<span class="pill pill-ga4" title="Google Analytics 4">GA4</span>'];
  // For a taggrs hit the taggrsPill IS the transport indicator (like Stape b64),
  // so skip the native sub-pill to keep the card parallel: GA4 · taggrs.
  const sub = r._taggrs ? null : GA4_TRANSPORT_SUB[r.transport];
  if (sub) pills.push(`<span class="pill ${sub.cls}" title="${escapeHtml(sub.tip)}">${escapeHtml(sub.label)}</span>`);
  return pills.join('');
}

// Transport pill for a hit decrypted out of a taggrs custom-loader envelope. Sits
// next to the provider pill — the same slot as the Stape b64 sub-pill — because
// it describes the same thing: an obfuscated delivery the panel saw through.
function taggrsPill(r) {
  if (!r._taggrs) return '';
  const tip = `Decrypted from a taggrs custom-loader (AES-256-GCM) envelope sent to ${r._taggrs.host} — the real request was hidden as an opaque blob. See the detail for the encrypted original.`;
  return `<span class="pill pill-taggrs" title="${escapeHtml(tip)}">taggrs</span>`;
}

function flagPills(r) {
  const out = [];
  if (r.provider === 'meta') {
    const f = r.flags || {};
    if (r.signalType === 'config-no-event') {
      return '<span class="pill pill-consent-denied" title="Pixel init (signals/config) seen but no /tr/ event fired within 2s — likely Meta traffic-permission settings">no event sent</span>';
    }
    if (!r.standardEvent) out.push('<span class="pill pill-ee" title="Custom event (not a Meta standard event)">custom event</span>');
    if (f.dedup)          out.push('<span class="pill pill-event" title="eid present — event ID for CAPI deduplication">dedup</span>');
    if (f.cdCount)        out.push(`<span class="pill pill-ep" title="${f.cdCount} custom-data field(s): cd[...]">cd ×${f.cdCount}</span>`);
    return out.join('');
  }
  if (r.provider === 'uet') {
    const f = r.flags || {};
    if (f.consentEvent) out.push('<span class="pill pill-consent-info" title="evt=consent — a consent signal (Microsoft Consent Mode), not a tracking event">consent signal</span>');
    if (f.personalData) out.push('<span class="pill pill-em" title="evt=pid — payload is user data / enhanced conversions only">personal data</span>');
    if (f.custom)    out.push('<span class="pill pill-ee" title="Custom event (evt=custom) — typically a conversion goal">custom event</span>');
    if (f.ecommerce) out.push('<span class="pill pill-event" title="E-commerce fields present (prodid / pagetype / ecomm_*)">ecommerce</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="Goal value (gv) / e-commerce total">revenue: ${amount}</span>`);
    }
    if (f.iframe) out.push('<span class="pill pill-ep" title="ifm=1 — fired inside an iframe">iframe</span>');
    if (f.spa)    out.push('<span class="pill pill-ep" title="spa=1 — single-page-app navigation">SPA</span>');
    return out.join('');
  }
  if (r.provider === 'tiktok') {
    const f = r.flags || {};
    if (!r.standardEvent) out.push('<span class="pill pill-ee" title="Custom event (not a TikTok standard event)">custom event</span>');
    if (f.dedup)          out.push('<span class="pill pill-event" title="event_id present — event ID for Events API deduplication">dedup</span>');
    if (f.ecommerce)      out.push('<span class="pill pill-event" title="E-commerce event with content/value data (properties.contents[])">ecommerce</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="properties.value / currency">revenue: ${amount}</span>`);
    }
    if (f.invalidSignal) out.push('<span class="pill pill-consent-denied" title="TikTok flagged a sent identifier as invalid (signal_diagnostic_labels)">signal: invalid</span>');
    return out.join('');
  }
  if (r.provider === 'pinterest') {
    const f = r.flags || {};
    if (!r.standardEvent) out.push('<span class="pill pill-ee" title="Custom event (not a Pinterest standard event)">custom event</span>');
    if (f.dedup)          out.push('<span class="pill pill-event" title="ed.event_id present — event ID for Conversions API deduplication">dedup</span>');
    if (f.ecommerce)      out.push('<span class="pill pill-event" title="E-commerce event with value / line_items">ecommerce</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="ed.value / currency">revenue: ${amount}</span>`);
    }
    if (f.cdCount)        out.push(`<span class="pill pill-ep" title="${f.cdCount} custom field(s) in ed">cd ×${f.cdCount}</span>`);
    if (f.isEu)          out.push('<span class="pill pill-consent-info" title="ad.is_eu — request originated in an EU/privacy region">EU</span>');
    return out.join('');
  }
  if (r.provider === 'googleads') {
    const f = r.flags || {};
    if (f.conversion && r.label) out.push(`<span class="pill pill-ee" title="conversion label — AW-${escapeHtml(String(r.convId))}/${escapeHtml(r.label)}">label: ${escapeHtml(r.label)}</span>`);
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="value / currency_code">revenue: ${amount}</span>`);
    }
    if (f.enhancedConversions) out.push('<span class="pill pill-em" title="Enhanced conversions active (capi / em / ec_mode)">EC</span>');
    if (r.productData && r.productData.id) out.push(`<span class="pill pill-ep" title="dynamic remarketing product (data: google_business_vertical / id)">item: ${escapeHtml(r.productData.id)}</span>`);
    if (f.isEu) out.push('<span class="pill pill-consent-info" title="dma=1 — EU/EEA consent context">EU</span>');
    if (r._transports && r._transports.length > 1) {
      out.push(`<span class="pill pill-ud" title="transport mirrors folded into this card: ${escapeHtml(r._transports.join(' · '))}">×${r._transports.length} transports</span>`);
    }
    return out.join('');
  }
  if (r.provider === 'floodlight') {
    const f = r.flags || {};
    if (r.group) out.push(`<span class="pill pill-ee" title="activity GROUP tag (type) — advertiser-defined">group: ${escapeHtml(r.group)}</span>`);
    if (r.activityTag) out.push(`<span class="pill pill-event" title="activity tag (cat) — advertiser-defined">tag: ${escapeHtml(r.activityTag)}</span>`);
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="cost / value on the sales activity">revenue: ${amount}</span>`);
    }
    if (r.customVars) out.push(`<span class="pill pill-ep" title="custom Floodlight variables: ${escapeHtml(Object.keys(r.customVars).join(', '))}">u ×${Object.keys(r.customVars).length}</span>`);
    // Purpose markers read off the parameter set (see lib/floodlight.js): a fire
    // carrying gcl* click-linking is a Google Ads / Signals remarketing signal
    // riding the Floodlight endpoint, not a classic advertiser counter.
    if (f.googleAdsLinked) out.push(`<span class="pill pill-em" title="gcl* click-linking present (gclaw/gclgs/gclst/gcllp)${r.gclid ? ' — gclid ' + escapeHtml(r.gclid) : ''} — fired by gtag's Google Ads / Signals integration, not a CM360 conversion counter">Ads-linked</span>`);
    if (f.enhancedConversions) out.push('<span class="pill pill-em" title="em / user_data_mode — enhanced-conversions context (hashed user-data marker)">EC</span>');
    if (r.consent && r.consent.npa === '1') out.push('<span class="pill pill-consent-info" title="npa=1 — non-personalised ads">NPA</span>');
    if (r._transports && r._transports.length > 1) {
      out.push(`<span class="pill pill-ud" title="mirror requests folded into this card: ${escapeHtml(r._transports.join(' · '))}">×${r._transports.length} transports</span>`);
    }
    return out.join('');
  }
  if (r.provider === 'linkedin') {
    const f = r.flags || {};
    if (r._endpoint === 'wa') {
      if (f.signal)      out.push(`<span class="pill pill-event" title="signalType — the LinkedIn /wa/ signal">${escapeHtml(f.signal)}</span>`);
      if (f.hashedEmail) out.push('<span class="pill pill-em" title="hem — SHA-256 of the email, sent in the /wa/ body (enhanced conversions PII)">hashed email</span>');
      if (f.liFat)       out.push('<span class="pill pill-ud" title="liFatId / liGiant — LinkedIn first-party ad-tracking id">li_fat</span>');
      if (r._transports && r._transports.length > 1) {
        out.push(`<span class="pill pill-ud" title="duplicate fires folded into this card: ${escapeHtml(r._transports.join(' · '))}">×${r._transports.length} transports</span>`);
      }
      return out.join('');
    }
    if (f.conversion) out.push(`<span class="pill pill-conversion" title="conversionId — the LinkedIn conversion rule id">conv id: ${escapeHtml(r.conversionId)}</span>`);
    if (f.ipHash)     out.push('<span class="pill pill-em" title="e_ipv6 — encrypted client IP (sent to the px4 mirror)">IP hash</span>');
    return out.join('');
  }
  if (r.provider === 'reddit') {
    const f = r.flags || {};
    if (f.custom)      out.push('<span class="pill pill-ee" title="Custom event (not a Reddit standard event) — name in m.customEventName">custom event</span>');
    if (f.dedup)       out.push('<span class="pill pill-event" title="m.transactionId / m.conversionId present — Conversions API deduplication">dedup</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="m.value / m.valueDecimal + m.currency">revenue: ${amount}</span>`);
    }
    if (f.autoMatching) out.push('<span class="pill pill-ud" title="Auto-collected identifiers present (auto_em / auto_pn)">auto match</span>');
    if (f.externalId)   out.push('<span class="pill pill-ud" title="external_id present (hashed)">external_id</span>');
    if (f.optOut)       out.push('<span class="pill pill-consent-denied" title="opt_out=1">opt-out</span>');
    return out.join('');
  }
  if (r.provider === 'snapchat') {
    const f = r.flags || {};
    if (f.custom)  out.push('<span class="pill pill-ee" title="Custom event (not a Snapchat standard event)">custom event</span>');
    if (f.dedup)   out.push('<span class="pill pill-event" title="cdid present — client_deduplication_id (Conversions API dedup)">dedup</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="e_pr / e_cur">revenue: ${amount}</span>`);
    }
    if (f.ecommerce) out.push('<span class="pill pill-event" title="E-commerce fields present (e_*)">ecommerce</span>');
    return out.join('');
  }
  if (r.provider === 'taboola') {
    const f = r.flags || {};
    if (f.custom)    out.push('<span class="pill pill-ee" title="Custom event (not a Taboola standard event)">custom event</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="revenue / currency on the conversion event">revenue: ${amount}</span>`);
    }
    if (r.orderId)  out.push(`<span class="pill pill-event" title="orderid on the make_purchase event">order: ${escapeHtml(r.orderId)}</span>`);
    return out.join('');
  }
  if (r.provider === 'outbrain') {
    const f = r.flags || {};
    if (f.custom && !f.pageView) out.push('<span class="pill pill-ee" title="Custom event (not a documented Outbrain standard event name)">custom event</span>');
    if (r.revenue) {
      const amount = `${escapeHtml(r.revenue.value)}${r.revenue.currency ? ' ' + escapeHtml(r.revenue.currency) : ''}`;
      out.push(`<span class="pill pill-conversion" title="orderValue / currency">revenue: ${amount}</span>`);
    }
    if (r.orderId) out.push(`<span class="pill pill-event" title="orderId on the conversion">order: ${escapeHtml(r.orderId)}</span>`);
    if (r.channel) out.push(`<span class="pill pill-ep" title="cht — the channel the pixel fired through">via: ${escapeHtml(r.channel)}</span>`);
    return out.join('');
  }
  if (r.provider === 'hubspot') {
    const f = r.flags || {};
    if (f.customEvent) out.push('<span class="pill pill-ee" title="__ptbe.gif — a custom behavioral event (name in n)">custom event</span>');
    if (r.properties)  out.push(`<span class="pill pill-ep" title="event properties: _${escapeHtml(Object.keys(r.properties).join(', _'))}">props ×${Object.keys(r.properties).length}</span>`);
    if (f.form)        out.push('<span class="pill pill-em" title="contactFields (email / name / phone) submitted in CLEARTEXT via Collected Forms">contact fields</span>');
    else if (f.identify) out.push('<span class="pill pill-em" title="identify() data rides on this beacon (i=) — email / name in CLEARTEXT (HubSpot does not hash)">identify</span>');
    return out.join('');
  }
  const f = r.flags;
  if (!f) return '';
  if (f.conversion)    out.push('<span class="pill pill-conversion" title="_c=1 — conversion / key event">conversion</span>');
  if (f.externalEvent) out.push('<span class="pill pill-ee" title="_ee=1 — external event (created via GA4 configuration)">external</span>');
  if (f.sessionStart)  out.push('<span class="pill pill-event" title="_ss=1 — session start">session start</span>');
  if (f.firstVisit)    out.push('<span class="pill pill-event" title="_fv=1 — first visit">first visit</span>');
  if (f.itemCount)     out.push(`<span class="pill pill-event" title="${f.itemCount} e-commerce item(s) in the pr1..prN payload">items ×${f.itemCount}</span>`);
  if (f.epCount)       out.push(`<span class="pill pill-ep" title="${f.epCount} custom event parameter(s): ep.* / epn.*">ep ×${f.epCount}</span>`);
  return out.join('');
}

function consentPills(r) {
  const out = [];
  const stateClsConsent = (s) => s === 'granted' ? 'pill-consent-granted' : s === 'denied' ? 'pill-consent-denied' : 'pill-consent-unset';
  if (r.provider === 'meta') {
    if (r.consent && r.consent.ldu) {
      out.push('<span class="pill pill-consent-unset" title="Limited Data Use active (data_processing_options / dpo)">LDU</span>');
    }
    return out.join('');
  }
  if (r.provider === 'uet') {
    // Always shown — the absence of asc (unset) is itself meaningful.
    const s = r.consent ? r.consent.adStorage : 'unset';
    const label = s === 'unset' ? 'consent: unset' : `ad: ${s}`;
    const tip = 'Microsoft Consent Mode (asc): G=granted, D=denied, absent=unset';
    out.push(`<span class="pill ${stateClsConsent(s)}" title="${escapeHtml(tip)}">${escapeHtml(label)}</span>`);
    return out.join('');
  }
  const consent = r.consent;
  if (!consent) return '';
  const stateCls = (s) => s === 'granted' ? 'pill-consent-granted' : s === 'denied' ? 'pill-consent-denied' : 'pill-consent-unset';
  if (consent.adStorage)        out.push(`<span class="pill ${stateCls(consent.adStorage)}" title="ad_storage (gcs)">ad: ${escapeHtml(consent.adStorage)}</span>`);
  if (consent.analyticsStorage) out.push(`<span class="pill ${stateCls(consent.analyticsStorage)}" title="analytics_storage (gcs)">analytics: ${escapeHtml(consent.analyticsStorage)}</span>`);
  return out.join('');
}

function summaryPills(r) {
  const ids = r.identifiers;
  const parts = [];
  for (const key of ['email', 'phone', 'name', 'address']) {
    if (ids && ids[key]) parts.push(`${ids[key]}× ${key}`);
  }
  const pills = [];
  if (parts.length) {
    pills.push(`<span class="pill pill-ud" title="Identifiers found in user data">${escapeHtml(parts.join(' · '))}</span>`);
  }
  if (r.provider === 'meta') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Advanced matching present (hashed ud[...] tokens)">adv. matching</span>');
    }
  } else if (r.provider === 'uet') {
    if (r.flags && r.flags.enhancedConv) {
      pills.push('<span class="pill pill-em" title="Enhanced conversions present (hashed identifiers in pid)">enhanced conv.</span>');
    }
  } else if (r.provider === 'tiktok') {
    if (r.flags && r.flags.externalId) {
      pills.push('<span class="pill pill-ud" title="external_id present in context.user">external_id</span>');
    }
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Advanced matching present (hashed identifiers in context.user)">adv. matching</span>');
    }
  } else if (r.provider === 'pinterest') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Enhanced match present (hashed identifiers in pd)">enhanced match</span>');
    }
  } else if (r.provider === 'googleads') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Enhanced conversions user data present (hashed em token)">enhanced match</span>');
    }
  } else if (r.provider === 'floodlight') {
    if (r.flags && r.flags.cleartextEmail) {
      pills.push('<span class="pill pill-ud" title="a custom Floodlight variable (u*) carries an email address in cleartext">cleartext email</span>');
    }
  } else if (r.provider === 'linkedin') {
    if (r.flags && r.flags.hashedEmail) {
      pills.push('<span class="pill pill-em" title="Enhanced conversions: hashed email (hem) sent in the /wa/ body">enhanced conv.</span>');
    }
  } else if (r.provider === 'reddit') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Advanced matching present (hashed em / pn / external_id)">adv. matching</span>');
    }
  } else if (r.provider === 'snapchat') {
    if (r.flags && r.flags.advancedMatching) {
      pills.push('<span class="pill pill-em" title="Advanced matching present (hashed u_* / l_* identifiers incl. geo/age)">adv. matching</span>');
    }
  } else if (r.provider === 'criteo') {
    if (r.flags && r.flags.cleartextEmail) {
      pills.push('<span class="pill pill-ud" title="setEmail sent the email address to Criteo in cleartext (not hashed)">cleartext email</span>');
    }
  } else if (r.provider === 'taboola') {
    if (r.flags && r.flags.hashedEmail) {
      pills.push('<span class="pill pill-em" title="unified_id — SHA-256 of the email (Taboola AudienceMatch identity), sent as a query param">hashed email</span>');
    }
  } else if (r.em) {
    pills.push('<span class="pill pill-em" title="Request carries an em parameter (hashed enhanced-conversion identifiers)">em</span>');
  }
  return pills.join('');
}

// --- inline detail ---------------------------------------------------------

function paramRows(obj) {
  const keys = Object.keys(obj || {}).sort();
  if (!keys.length) return '';
  return keys.map(k => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(obj[k])}</td></tr>`).join('');
}

function kvTable(rows) {
  return `<table class="det-table">${
    rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
}

function section(title, inner) {
  return inner ? `<div class="det-section">${escapeHtml(title)}</div>${inner}` : '';
}

// Section titles keep each provider's useful context (which param carries the
// data, e.g. "(pd)" or "(context.user)") while sharing the "PII / " prefix so
// the block reads as one recognisable thing across all providers.
const PII_SECTION_TITLE = {
  ga4: 'PII / user data',
  meta: 'PII / user data (advanced matching)',
  uet: 'PII / user data (enhanced conversions)',
  tiktok: 'PII / user data (context.user)',
  pinterest: 'PII / enhanced match (pd)',
  googleads: 'PII / enhanced conversions (em)',
  floodlight: 'PII / custom variables (u*)',
  linkedin: 'PII / enhanced conversions (hem)',
  reddit: 'PII / user data (advanced + auto matching)',
  snapchat: 'PII / user data (advanced matching — incl. geo/age)',
  hubspot: 'PII / user data (identify — cleartext)',
  criteo: 'PII / user data (setEmail — cleartext)',
  taboola: 'PII / identity (unified_id)',
};

// The one place PII surfaces in the details: every user-data field a request
// carries, translated to its plain-language category, with the detected hash
// form. A terse note appears only when the form contradicts the algorithm the
// provider requires (algoNote). Meta additionally keeps its PII-free masked
// value. Reads only — no plaintext comparison, no validation.
function piiSection(r) {
  const ud = r.piiFields || r.userData;
  if (!ud || !Object.keys(ud).length) return '';
  const hasMask = Object.values(ud).some((f) => f.mask || f.normalizedMask);
  const head = hasMask
    ? '<tr><th>field</th><th>category</th><th>masked value</th><th>form</th></tr>'
    : '<tr><th>field</th><th>category</th><th>form</th></tr>';
  const rows = Object.entries(ud).map(([key, f]) => {
    const algo = ('algo' in f) ? f.algo : (f.hashed ? 'sha256' : null);
    const note = algoNote(r.provider, algo);
    let form = escapeHtml(algoLabel(algo));
    if (note) form += ` · <span class="pii-note">${escapeHtml(note)}</span>`;
    if (f.list) form += ` · ${f.list.length} value(s)`;
    const maskCell = hasMask ? `<td>${escapeHtml(f.mask || f.normalizedMask || '')}</td>` : '';
    return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(f.label || key)}</td>${maskCell}<td>${form}</td></tr>`;
  }).join('');
  return section(PII_SECTION_TITLE[r.provider] || 'PII / user data',
    `<table class="det-table pii-table">${head}${rows}</table>`);
}

// GA4 e-commerce items (pr1..prN): one readable sub-table per product. Custom
// item params and any unknown codes are shown too, so nothing the request
// carried is hidden.
function ga4ItemsSection(items, currency) {
  if (!Array.isArray(items) || !items.length) return '';
  const cur = currency ? ` ${currency}` : '';
  return items.map((it, i) => {
    const rows = [];
    for (const [label, val] of Object.entries(it.fields)) {
      const shown = (label === 'price' && val) ? `${val}${cur}` : val;
      rows.push([label, shown]);
    }
    for (const [k, v] of Object.entries(it.custom)) rows.push([`custom: ${k}`, v]);
    for (const [code, v] of Object.entries(it.unknown)) rows.push([`? unknown (${code})`, v]);
    const name = it.fields.item_name || it.fields.item_id || `item ${i + 1}`;
    return section(`item ${i + 1}: ${name}`, kvTable(rows));
  }).join('');
}

function detailHtml(r) {
  let meta, extras = '';

  if (r.provider === 'meta' && r.signalType === 'config-no-event') {
    meta = [
      ['pixel id (id)', r.id],
      ['domain', r.domain],
      ['CAPI opt-in', r.capiOptin ? 'yes (optin_meta_enabled_capi)' : 'no'],
      ['pixel version (v)', r.version],
    ].filter(([, v]) => v != null && v !== '');
    const help = 'https://www.facebook.com/business/help/572690630080597';
    extras = section('Why this card',
      `<div class="det-note">The pixel fetched its config (signals/config) but sent no event ` +
      `(no PageView/conversion) within 2&nbsp;s. The most common cause is the pixel's ` +
      `traffic-permission settings blocking this domain — see ` +
      `<a href="${escapeHtml(help)}" target="_blank" rel="noopener">Meta&nbsp;Help</a>. ` +
      `Other possible causes: the event was never triggered, or consent was not granted.</div>`);
    return `<div class="ev-detail" hidden>${kvTable(meta)}${extras}</div>`;
  }

  if (r.provider === 'meta') {
    meta = [
      ['event (ev)', r.ev], ['pixel id (id)', r.id],
      ['transport', r.transport], ['method', r.method],
      ['source lib (a)', r.sourceLib], ['event id (eid)', r.eid],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.consent) {
      const rows = [['Limited Data Use', r.consent.ldu ? 'active' : 'inactive']];
      if (r.consent.dpo != null)     rows.push(['dpo', r.consent.dpo]);
      if (r.consent.country != null) rows.push(['country (dpoco)', r.consent.country]);
      if (r.consent.state != null)   rows.push(['state (dpost)', r.consent.state]);
      extras += section('Consent', kvTable(rows));
    }
    extras += piiSection(r);
    if (r.customData && Object.keys(r.customData).length) {
      extras += section('custom data (cd)', `<table class="det-table">${paramRows(r.customData)}</table>`);
    }
  } else if (r.provider === 'uet') {
    meta = [
      ['event type (evt)', r.evt], ['consent source (src)', r.src], ['UET tag id (ti)', r.ti],
      ['transport', r.transport], ['method', r.method],
      ['tag manager (tm)', r.tagManager], ['message id (mid)', r.mid],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    const evRows = [];
    if (r.ec != null) evRows.push(['category (ec)', r.ec]);
    if (r.ea != null) evRows.push(['action (ea)', r.ea]);
    if (r.el != null) evRows.push(['label (el)', r.el]);
    if (r.ev != null) evRows.push(['value (ev)', r.ev]);
    if (r.revenue)    evRows.push(['revenue (gv/gc)', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]);
    if (evRows.length) extras += section('Event', kvTable(evRows));

    if (r.ecommerce) extras += section('e-commerce', `<table class="det-table">${paramRows(r.ecommerce)}</table>`);

    // Consent is always shown — the absence of asc (unset) is meaningful.
    const cRows = [['ad_storage', (r.consent && r.consent.adStorage) || 'unset']];
    if (r.consent && r.consent.asc != null) cRows.push(['asc', r.consent.asc]);
    if (r.consent && r.consent.cdb != null) cRows.push(['cdb', r.consent.cdb]);
    extras += section('Consent', kvTable(cRows));

    extras += piiSection(r);
  } else if (r.provider === 'tiktok') {
    meta = [
      ['event', r.event], ['pixel code', r.code],
      ['transport', r.transport], ['method', r.method],
      ['event id (dedup)', r.eventId], ['message id', r.messageId],
      ['library', r.library],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    extras += piiSection(r);

    if (r.ecommerce) {
      const e = r.ecommerce;
      const rows = [];
      if (e.value != null)       rows.push(['value', `${e.value}${e.currency ? ' ' + e.currency : ''}`]);
      if (e.contentType)         rows.push(['content_type', e.contentType]);
      if (e.query)               rows.push(['query', e.query]);
      if (e.contentIds)          rows.push(['content_ids', e.contentIds.join(', ')]);
      if (rows.length) extras += section('e-commerce (properties)', kvTable(rows));
      if (Array.isArray(e.contents) && e.contents.length) {
        const items = e.contents.map((it) => {
          const name = it.name || it.id || '?';
          const price = it.price != null ? ` @ ${it.price}${e.currency ? ' ' + e.currency : ''}` : '';
          const qty = it.quantity != null ? ` × ${it.quantity}` : '';
          return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(`${it.id != null ? '#' + it.id : ''}${qty}${price}`)}</td></tr>`;
        }).join('');
        extras += section(`contents (${e.contents.length})`, `<table class="det-table">${items}</table>`);
      }
    }

    // TikTok's own data-quality verdict — surfaced verbatim (reading parameters,
    // not validating). Invalid signals carry the reason and whether TikTok offered
    // a corrected hash.
    if (r.diagnostics) {
      const sigRows = (r.diagnostics.signals || []).map((s) => {
        const detail = [
          s.abnormal ? s.abnormal.join(', ') : '',
          s.suggested ? 'suggested value provided' : '',
        ].filter(Boolean).join(' · ');
        return `<tr><td>${escapeHtml(s.field)}</td><td>${escapeHtml(s.label)}${detail ? ' — ' + escapeHtml(detail) : ''}</td></tr>`;
      }).join('');
      if (sigRows) extras += section('signal diagnostics (TikTok verdict)', `<table class="det-table">${sigRows}</table>`);
      if (r.diagnostics.identityParams) {
        const ipRows = Object.entries(r.diagnostics.identityParams).map(([k, v]) =>
          `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</td></tr>`).join('');
        extras += section('identity params (_inspection)', `<table class="det-table">${ipRows}</table>`);
      }
    }
  } else if (r.provider === 'pinterest') {
    meta = [
      ['event', r.event], ['event (raw)', r.eventRaw && r.eventRaw !== r.event ? r.eventRaw : null],
      ['tag id (tid)', r.tid], ['transport', r.transport], ['method', r.method],
      ['event id (dedup)', r.eventId],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    extras += piiSection(r);
    if (r.pinUnauth || (r.aemEligible && r.aemEligible.length)) {
      const rows = [];
      if (r.pinUnauth)                       rows.push(['pin_unauth', r.pinUnauth]);
      if (r.aemEligible && r.aemEligible.length) rows.push(['aem_eligible_list', r.aemEligible.join(', ')]);
      extras += section('pd extras', kvTable(rows));
    }

    if (r.ecommerce) {
      const e = r.ecommerce;
      const rows = [];
      if (e.value != null)     rows.push(['value', `${e.value}${e.currency ? ' ' + e.currency : ''}`]);
      if (e.orderId)           rows.push(['order_id', e.orderId]);
      if (e.orderQuantity)     rows.push(['order_quantity', e.orderQuantity]);
      if (e.promoCode)         rows.push(['promo_code', e.promoCode]);
      if (e.searchQuery)       rows.push(['search_query', e.searchQuery]);
      if (e.contentIds)        rows.push(['content_ids', e.contentIds.join(', ')]);
      if (rows.length) extras += section('e-commerce (ed)', kvTable(rows));
      if (Array.isArray(e.lineItems) && e.lineItems.length) {
        const items = e.lineItems.map((it) => {
          const name = it.name || it.id || '?';
          const price = it.price != null ? ` @ ${it.price}${e.currency ? ' ' + e.currency : ''}` : '';
          const qty = it.quantity != null ? ` × ${it.quantity}` : '';
          const cat = it.category ? ` (${it.category})` : '';
          return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(`${it.id != null ? '#' + it.id : ''}${qty}${price}${cat}`)}</td></tr>`;
        }).join('');
        extras += section(`line items (${e.lineItems.length})`, `<table class="det-table">${items}</table>`);
      }
    }

    if (r.customData && Object.keys(r.customData).length) {
      extras += section('custom data (ed)', `<table class="det-table">${paramRows(r.customData)}</table>`);
    }
  } else if (r.provider === 'googleads') {
    meta = [
      ['signal', r.signalType],
      ['event (en)', r.event],
      ['conversion id', r.accountId],
      ['label', r.label],
      ['conversion type (bttype)', r.bttype],
      ['order id (oid)', r.oid],
      ['transport', r.transport], ['method', r.method],
      ['enhanced conversions', r.flags && r.flags.enhancedConversions ? 'active (capi / em / ec_mode)' : null],
      ['ec session id (ecsid)', r.ecsid],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      extras += section('revenue', kvTable([['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]]));
    }
    if (r._transports && r._transports.length) {
      extras += section(`transports (${r._transports.length})`, kvTable([['endpoints', r._transports.join(' · ')]]));
    }
    extras += piiSection(r);
    if (r.emd) extras += section('match diagnostics (emd)', kvTable([['emd', r.emd]]));
    if (Array.isArray(r.items) && r.items.length) {
      const rows = r.items.map((it) =>
        `<tr><td>${escapeHtml(it.sku || '?')}</td><td>${escapeHtml(`${it.price || ''}${it.quantity ? ' × ' + it.quantity : ''}`)}</td></tr>`).join('');
      extras += section(`line items (${r.items.length})`, `<table class="det-table">${rows}</table>`);
    }
    if (r.productData) extras += section('remarketing data (data)', `<table class="det-table">${paramRows(r.productData)}</table>`);
    if (r.contextData) extras += section('conversion context (data)', `<table class="det-table">${paramRows(r.contextData)}</table>`);

    if (r.consent) {
      const rows = [];
      if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
      if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
      if (Array.isArray(r.consent.gcdDecoded)) {
        for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
      }
      if (r.consent.dma != null) rows.push(['dma', r.consent.dma]);
      if (r.consent.npa != null) rows.push(['npa', r.consent.npa]);
      extras += section('Consent', kvTable(rows));
    }
  } else if (r.provider === 'floodlight') {
    meta = [
      ['event (type/cat)', r.event],
      ['activity kind', r.flags && r.flags.sales ? 'sales (has value)' : 'counter'],
      ['floodlight config (src)', r.advertiserId],
      ['activity group (type)', r.group],
      ['activity tag (cat)', r.activityTag],
      ['ordinal (ord)', r.ord],
      ['quantity (qty)', r.quantity],
      ['DoubleClick id (auiddc)', r.dcUserId],
      ['Google Ads click (gclaw)', r.gclid],
      ['fired via', r.flags && r.flags.googleAdsLinked ? 'Google Ads / Signals (gtag)' : (r.customVars ? 'advertiser activity (custom vars)' : null)],
      ['transport', r.transport], ['method', r.method],
      ['page url (~oref)', r.pageUrl],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      extras += section('revenue', kvTable([['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]]));
    }
    if (r._transports && r._transports.length > 1) {
      extras += section(`transports (${r._transports.length})`, kvTable([['mirrors', r._transports.join(' · ')]]));
    }
    extras += piiSection(r);
    if (r.customVars && Object.keys(r.customVars).length) {
      extras += section(`custom variables (${Object.keys(r.customVars).length})`, `<table class="det-table">${paramRows(r.customVars)}</table>`);
    }
    if (r.consent) {
      const rows = [];
      if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
      if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
      if (Array.isArray(r.consent.gcdDecoded)) {
        for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
      }
      if (r.consent.dma != null) rows.push(['dma', r.consent.dma]);
      if (r.consent.npa != null) rows.push(['npa', r.consent.npa]);
      if (r.consent.gpp) rows.push(['gpp', r.consent.gpp]);
      if (r.consent.gppSid) rows.push(['gpp_sid', r.consent.gppSid]);
      extras += section('Consent', kvTable(rows));
    }
  } else if (r.provider === 'linkedin' && r._endpoint === 'wa') {
    meta = [
      ['signal type', r.signalType], ['partner id (pid)', r.pid],
      ['page title', r.pageTitle], ['page url', r.pageUrl],
      ['transport', r.transport], ['method', r.method],
      ['version (scriptVersion)', r.version], ['time', r.time],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    extras += piiSection(r);
    if (r.liFatId || r.liGiant) {
      const rows = [];
      if (r.liFatId) rows.push(['liFatId', r.liFatId]);
      if (r.liGiant) rows.push(['liGiant', r.liGiant]);
      extras += section('LinkedIn ad-tracking ids', kvTable(rows));
    }
    if (r._transports && r._transports.length > 1) {
      extras += section(`transports (${r._transports.length})`, kvTable([['fires', r._transports.join(' · ')]]));
    }
    if (r.waPayload) {
      extras += section('full decoded payload',
        `<pre class="det-dump">${escapeHtml(JSON.stringify(r.waPayload, null, 2))}</pre>`);
    }
  } else if (r.provider === 'linkedin') {
    meta = [
      ['event', r.eventName], ['partner id (pid)', r.pid],
      ['conversion id', r.conversionId],
      ['transport', r.transport], ['method', r.method],
      ['tag manager (tm)', r.tagManager], ['version (v)', r.version],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r._transports && r._transports.length) {
      extras += section(`transports (${r._transports.length})`, kvTable([['mirrors', r._transports.join(' · ')]]));
    }
    if (r.ipHash) {
      extras += section('encrypted IP (e_ipv6)', kvTable([['e_ipv6', r.ipHash]]));
    }
  } else if (r.provider === 'reddit') {
    meta = [
      ['event', r.event], ['pixel id (id)', r.pixelId],
      ['custom event name', r.customEventName],
      ['transport', r.transport], ['method', r.method],
      ['integration', r.integration], ['version (v)', r.version],
      ['page url', r.pageUrl],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      extras += section('revenue', kvTable([['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]]));
    }
    extras += piiSection(r);
    const convRows = [];
    if (r.transactionId) convRows.push(['transaction id (m.transactionId)', r.transactionId]);
    if (r.conversionId)  convRows.push(['conversion id (m.conversionId)', r.conversionId]);
    if (r.conversion && r.conversion.products) convRows.push(['products (m.products)', r.conversion.products]);
    if (convRows.length) extras += section('conversion (m.*)', kvTable(convRows));
  } else if (r.provider === 'snapchat') {
    meta = [
      ['event', r.event], ['pixel id (pid)', r.pixelId],
      ['transport', r.transport], ['method', r.method],
      ['integration', r.integration], ['version (v)', r.version],
      ['client id (u_c1)', r.clientId], ['session id (u_scsid)', r.sessionId], ['click id (u_sclid)', r.clickId],
      ['page url', r.pageUrl], ['referrer', r.referrer],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      extras += section('revenue', kvTable([['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]]));
    }
    extras += piiSection(r);
    if (r.ecommerce) {
      const e = r.ecommerce;
      const rows = [];
      if (e.transactionId) rows.push(['transaction id', e.transactionId]);
      if (e.numItems)      rows.push(['number of items', e.numItems]);
      if (e.category)      rows.push(['category', e.category]);
      if (Array.isArray(e.itemIds)) rows.push(['item ids', e.itemIds.join(', ')]);
      if (Array.isArray(e.brands))  rows.push(['brands', e.brands.join(', ')]);
      if (e.searchString)  rows.push(['search string', e.searchString]);
      if (e.description)   rows.push(['description', e.description]);
      if (rows.length) extras += section('e-commerce (e_*)', kvTable(rows));
    }
    if (r.extras && Object.keys(r.extras).length) {
      extras += section('purchase extras', `<table class="det-table">${paramRows(r.extras)}</table>`);
    }
  } else if (r.provider === 'hubspot') {
    const TYPE_LABEL = {
      pageview: 'page view (__ptq.gif)',
      event: 'custom event (__ptbe.gif)',
      click: 'click / interaction (__ptc.gif)',
      form: 'collected form submit (hscollectedforms.net)',
    };
    meta = [
      ['type', TYPE_LABEL[r.eventType] || r.eventType],
      ['event name (n)', r.eventNameRaw],
      ['hub id (a)', r.accountId],
      ['form id', r.formId], ['form type', r.formType],
      ['transport', r.transport], ['method', r.method],
      [r.eventType === 'form' ? 'user token (utk)' : 'visitor id (vi)', r.visitorId], ['version', r.version],
      ['page title', r.pageTitle], ['page url', r.pageUrl],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    extras += piiSection(r);
    if (r.click) {
      const rows = [];
      if (r.click.tag)          rows.push(['element', `<${r.click.tag.toLowerCase()}>`]);
      if (r.click.text)         rows.push(['text', r.click.text]);
      if (r.click.href)         rows.push(['link href', r.click.href]);
      if (r.click.elementClass) rows.push(['class', r.click.elementClass]);
      rows.push(['navigation', r.click.isNavigation ? 'yes' : 'no']);
      extras += section('click target (_hs_*)', kvTable(rows));
    }
    if (r.formValues && Object.keys(r.formValues).length) {
      extras += section('form values (submitted)', `<table class="det-table">${paramRows(r.formValues)}</table>`);
    }
    if (r.properties) {
      extras += section('event properties (_*)', `<table class="det-table">${paramRows(r.properties)}</table>`);
    }
  } else if (r.provider === 'criteo') {
    meta = [
      ['event', r.event], ['event code', r.eventCode], ['account (a)', r.account],
      ['transport', r.transport], ['method', r.method], ['OneTag version (v)', r.version],
      ['transaction id', r.transactionId], ['category', r.category], ['currency', r.currency],
      ['page url (fu)', r.pageUrl], ['referrer (pu)', r.referrer], ['event id (ceid)', r.eventId],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      const val = `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`;
      // Criteo sends no order total — for cart/basket/transaction the value is
      // derived (Σ items), labelled so it isn't mistaken for a sent parameter.
      extras += section('revenue', kvTable([[r.revenue.computed ? 'value (computed — Σ items)' : 'value', val]]));
    }
    if (r.items && r.items.length) {
      const rows = r.items.map((it, i) => [`item ${i + 1}`,
        [it.id ? `id ${it.id}` : null, it.price ? `price ${it.price}${r.currency ? ' ' + r.currency : ''}` : null, it.quantity ? `×${it.quantity}` : null].filter(Boolean).join('  ·  ')]);
      extras += section(`products (${r.items.length})`, kvTable(rows));
    }
    extras += piiSection(r);
    if (r.consent) {
      const rows = [];
      if (r.consent.gpp)       rows.push(['GPP string', r.consent.gpp]);
      if (r.consent.gppSid)    rows.push(['GPP section id', r.consent.gppSid]);
      if (r.consent.usPrivacy) rows.push(['US Privacy (cs)', r.consent.usPrivacy]);
      if (rows.length) extras += section('Consent', kvTable(rows));
    }
    // The full slot list makes the multi-event batching + technical exd/dis visible.
    extras += section('OneTag events (slots p0..pN)', kvTable(r.slots.map((s) => [s.code, s.name])));
    if (r.sharedCookies) {
      extras += section('shared cookies (sc)', kvTable([['sc', r.sharedCookies]]));
    }
  } else if (r.provider === 'taboola') {
    meta = [
      ['event', r.event],
      ['shape', r.shape === 'pageview' ? 'page view (/trc/3/json)' : 'event (/log/3)'],
      ['standard event', r.standardEvent ? 'yes' : (r.flags && r.flags.engagement ? 'no (engagement telemetry)' : 'no (custom)')],
      ['Taboola account', r.account],
      ['user id (ui)', r.userId],
      ['transport', r.transport], ['method', r.method],
      ['client version (cv)', r.version],
      ['page url', r.pageUrl], ['referrer', r.referrer],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      const rows = [['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]];
      if (r.orderId)  rows.push(['order id', r.orderId]);
      if (r.quantity) rows.push(['quantity', r.quantity]);
      extras += section('conversion', kvTable(rows));
    }
    if (r.consent) {
      const rows = [];
      if (r.consent.cmp)        rows.push(['CMP (cbp)', `${r.consent.cmp}${r.consent.cmpVersion ? ' v' + r.consent.cmpVersion : ''}`]);
      if (r.consent.tcf)        rows.push(['TCF string (tcs)', r.consent.tcf]);
      if (r.consent.usPrivacy)  rows.push(['US Privacy (ccpaPs)', r.consent.usPrivacy]);
      extras += section('Consent', kvTable(rows));
    }
    extras += piiSection(r);
  } else if (r.provider === 'outbrain') {
    meta = [
      ['event (name)', r.event],
      ['kind', r.flags && r.flags.pageView ? 'page view' : (r.standardEvent ? 'standard event' : 'custom event')],
      ['marketer id', r.account],
      ['transport', r.transport], ['method', r.method],
      ['channel (cht)', r.channel], ['zone', r.zone],
      ['obApi version', r.apiVersion], ['pixel build (obtpVersion)', r.pixelVersion],
      ['page url (dl)', r.pageUrl], ['referrer', r.referrer], ['previous page (pRef)', r.previousPage],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.revenue) {
      const rows = [['value', `${r.revenue.value}${r.revenue.currency ? ' ' + r.revenue.currency : ''}`]];
      if (r.orderId) rows.push(['order id', r.orderId]);
      extras += section('conversion', kvTable(rows));
    }
  } else {
    meta = [
      ['event (en)', r.en], ['measurement id (tid)', r.tid],
      ['transport', r.transport], ['method', r.method],
      ['currency (cu)', r.currency],
      ['request url', r.effectiveUrl],
      ['original (masked) url', r._originalUrl && r._originalUrl !== r.effectiveUrl ? r._originalUrl : null],
    ].filter(([, v]) => v != null && v !== '');

    if (r.items && r.items.length) {
      extras += section(`e-commerce items (${r.items.length})`, ga4ItemsSection(r.items, r.currency));
    }
    if (r.consent) {
      const rows = [];
      if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
      if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
      if (Array.isArray(r.consent.gcdDecoded)) {
        for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
      }
      extras += section('Consent', kvTable(rows));
    }
    extras += piiSection(r);
  }

  // taggrs: show the encrypted original next to the decrypted request (which
  // rides in each provider's "request url" row) — same idea as the Stape b64 card.
  if (r._taggrs) {
    const rows = [
      ['delivered to (proxy)', r._taggrs.endpoint],
      ['client id', r._taggrs.clientId],
      ['encrypted request (u)', r._taggrs.cipherU],
    ];
    if (r._taggrs.cipherB) rows.push(['encrypted body (b)', r._taggrs.cipherB]);
    extras = section('taggrs envelope (AES-256-GCM, decrypted in-session)', kvTable(rows)) + extras;
  }

  const qSection = section('Query parameters', `<table class="det-table">${paramRows(r.queryParams)}</table>`);
  const bSection = (r.bodyParams && Object.keys(r.bodyParams).length)
    ? section('Body parameters', `<table class="det-table">${paramRows(r.bodyParams)}</table>`) : '';

  return `<div class="ev-detail" hidden>
    ${kvTable(meta)}
    ${extras}${qSection}${bSection}
  </div>`;
}

// --- filtering (the "out" side) --------------------------------------------

function buildSearchText(r) {
  const bits = [r.provider, eventName(r), accountId(r), r.host, docLocation(r)];
  if (r._source === 'worker') bits.push('service worker');   // matches the ⚡ badge label in free-text search
  if (r.provider === 'googleads') {
    // Mirror the manual "filter the network tab by AW-xxxxx / bare xxxxx / label" workflow.
    bits.push(r.convId, r.label, r.signalType);
  }
  for (const o of [r.queryParams, r.bodyParams]) {
    if (o) for (const [k, v] of Object.entries(o)) { bits.push(k); bits.push(v); }
  }
  return bits.filter(Boolean).join(' ').toLowerCase();
}

function cardMatchesFilter(r) {
  if (!state.filter[r.provider]) return false;
  const t = state.filter.text.trim().toLowerCase();
  if (t && !(r._search || '').includes(t)) return false;
  return true;
}

function applyCardVisibility(r) {
  if (r._el) r._el.hidden = !cardMatchesFilter(r);
}

// Re-apply the filter to all cards. A block with events but none visible is
// hidden; an empty block (fresh navigation marker) stays visible.
function applyFilter() {
  for (const block of state.blocks) {
    let anyVisible = false;
    for (const r of block.events) {
      const visible = cardMatchesFilter(r);
      if (r._el) r._el.hidden = !visible;
      if (visible) anyVisible = true;
    }
    if (block._el) block._el.hidden = block.events.length > 0 && !anyVisible;
  }
}

// --- DOM building (incremental, preserves expanded state) ------------------

function blockHeadHtml(block) {
  return `<span class="blk-time">${escapeHtml(formatTime(new Date(block.navTime)))}</span>${
    escapeHtml(block.navUrl || '(current page)')}`;
}

function appendBlockDom(block) {
  const el = document.createElement('div');
  el.className = 'blk';
  const head = document.createElement('div');
  head.className = 'blk-head';
  head.innerHTML = blockHeadHtml(block);
  const events = document.createElement('div');
  events.className = 'blk-events';
  el.append(head, events);
  blocksEl.insertBefore(el, blocksEl.firstChild);   // newest page-load block on top
  block._el = el;
  block._headEl = head;
  block._eventsEl = events;
}

// Backfill the URL of a block that was opened before onNavigated fired (so its
// title shows the real page instead of the "(current page)" placeholder).
function setBlockUrl(block, url) {
  if (!url || block.navUrl) return;
  block.navUrl = url;
  if (block._headEl) block._headEl.innerHTML = blockHeadHtml(block);
}

// Resolve the inspected page's real URL straight from the page context — works
// for any provider (Meta, Bing, …) and doesn't depend on a tracking parameter
// like dl ever being present.
function resolveCurrentPageUrl(block) {
  try {
    chrome.devtools.inspectedWindow.eval('location.href', (result, err) => {
      if (!err && typeof result === 'string') setBlockUrl(block, result);
    });
  } catch (e) { /* eval unavailable — leave the placeholder */ }
}

function cardInnerHtml(r) {
  const dl = docLocation(r);
  const idChip = accountId(r);
  const idTitle = accountTitle(r);
  return `
    <div class="ev-head">
      <span class="ev-time">${escapeHtml(formatTime(new Date(r._ts)))}</span>
      <span class="ev-method">${escapeHtml(r.method)}</span>
      ${idChip ? `<span class="ev-tid" title="${escapeHtml(idTitle)}">${escapeHtml(idChip)}</span>` : ''}
      ${r._source === 'worker' ? '<span class="ev-src" title="Deep Capture: seen only via webRequest, not the DevTools network panel — dispatched from a service worker / cloud edge">⚡ service worker</span>' : ''}
      <span class="ev-caret" title="Show all parameters">▼</span>
    </div>
    <div class="ev-name">${escapeHtml(eventName(r) || '(no event name)')}</div>
    ${dl ? `<div class="ev-dl" title="document location (dl)">${escapeHtml(dl)}</div>` : ''}
    <div class="ev-pills">${providerPills(r)}${taggrsPill(r)}${flagPills(r)}${consentPills(r)}</div>
    ${summaryPills(r) ? `<div class="ev-summary">${summaryPills(r)}</div>` : ''}
    ${detailHtml(r)}`;
}

// Card element classes: provider + transport, plus ev-alert for the synthetic
// silent-pixel warning so its title can be flagged in red.
function cardClass(r) {
  return `ev p-${r.provider} t-${r.transport}${r.signalType === 'config-no-event' ? ' ev-alert' : ''}`;
}

function appendEventDom(block, r) {
  const card = document.createElement('div');
  card.className = cardClass(r);
  card.innerHTML = cardInnerHtml(r);
  card.addEventListener('click', (e) => {
    if (e.target.closest('.ev-detail')) return;   // let users select/copy in the table
    const det = card.querySelector('.ev-detail');
    const caret = card.querySelector('.ev-caret');
    if (det) {
      det.hidden = !det.hidden;
      if (caret) { caret.textContent = det.hidden ? '▼' : '▲'; caret.title = det.hidden ? 'Show all parameters' : 'Hide parameters'; }
    }
  });
  // Newest event on top; keep any SW notice pinned above the cards.
  const anchor = block._swNoticeEl ? block._swNoticeEl.nextSibling : block._eventsEl.firstChild;
  block._eventsEl.insertBefore(card, anchor);
  r._el = card;
  if (r.provider && !state.seen.has(r.provider)) { state.seen.add(r.provider); renderFilterBar(); }   // ensure a pill exists for this service
  applyCardVisibility(r);
}

// Re-render a card in place after a collapse merge (transport list grew, or a
// richer transport mirror replaced the displayed payload). The element and its
// click listener are kept; only the inner markup is rebuilt.
function rerenderCard(r) {
  if (!r._el) return;
  r._el.className = cardClass(r);
  r._el.innerHTML = cardInnerHtml(r);
  applyCardVisibility(r);
}

function renderStatus() {
  recCount.textContent = `${totalEvents()} events / ${state.blocks.length} pages`;
  recDot.classList.toggle('live', state.recording);
  recordBtn.textContent = state.recording ? 'Stop' : 'Start & Reload';
  recordBtn.classList.toggle('recording', state.recording);
  emptyEl.hidden = state.blocks.length > 0;
}

// --- capture (the "in" side) -----------------------------------------------

function startBlock(navUrl) {
  const block = { navUrl, navTime: Date.now(), events: [] };
  state.blocks.push(block);
  appendBlockDom(block);
  if (!navUrl) resolveCurrentPageUrl(block);   // opened pre-onNavigated: get the real URL
  return block;
}

function currentBlock() {
  return state.blocks.length ? state.blocks[state.blocks.length - 1] : startBlock(null);
}

// pageUrl is the inspected page's real URL (the current block's navUrl). It is
// the only trusted source for the first-party call — a hit's own payload can
// claim any dl. When it isn't resolved yet, parsers fall back to 'unknown'
// rather than assuming first-party.
function parseRequest(url, postData, pageUrl) {
  for (const p of PARSERS) {
    if (!state.record[p.id]) continue;          // service capture switched off
    const r = p.parse(url, postData, pageUrl);
    if (r) return r;
  }
  return null;
}

function onRequest(harEntry) {
  if (!state.recording) return;
  // A service worker (e.g. Cloudflare) that intercepts the page's fetch leaves a
  // phantom entry that never hit the network; the SW's real outgoing request is
  // captured separately. Drop the phantom so one logical hit counts once.
  if (isServiceWorkerPhantom(harEntry)) return;
  const req = harEntry && harEntry.request;
  if (!req || !req.url) return;
  captureTaggrsKey(harEntry);                     // sniff the loader key from JS bodies (one-time per host)
  const ts = harEntry.startedDateTime ? new Date(harEntry.startedDateTime).getTime() : Date.now();
  // Deep Capture dedup: remember that DevTools saw this hit (and drop any pending
  // webRequest copy of it). A hit both sources see is shown once — via DevTools,
  // the richer feed. See noteDevtoolsSeen / the webRequest port handler below.
  noteDevtoolsSeen(req.method, req.url);
  ingestRequest({ url: req.url, method: req.method, postData: req.postData }, ts, 'devtools');
}

// Shared processing core for a single request, fed by both capture sources: the
// DevTools network feed (source 'devtools') and the webRequest fallback that
// catches worker-dispatched hits (source 'worker'). req is { url, method, postData }
// where postData is a HAR-style {text} object or a plain string — extractParams
// accepts either.
function ingestRequest(req, ts, source) {
  // Environmental signal (not a tracking hit): a first-party Tag Gateway service
  // worker. Flag it so the user knows some hits may be dispatched invisibly.
  if (isTagGatewaySwIframe(req.url)) { showSwNotice(currentBlock()); return; }
  const block = currentBlock();
  const r = parseRequest(req.url, req.postData, block.navUrl);
  if (r) { r._source = source; commitRecord(block, r, req, ts); return; }
  // Meta pixel-init signal (silent-pixel detection): the config fetch is not a
  // tracking event, so no parser claims it. When Meta recording is on, register
  // it and arm the 2s "did an event follow?" check.
  if (state.record.meta) {
    const sig = parseMetaSignal(req.url);
    if (sig) { registerMetaSignal(currentBlock(), sig, ts); return; }
  }
  // Async side-path: the LinkedIn /wa/ POST is base64(gzip(JSON)) and needs an
  // async DecompressionStream, so it can't ride the synchronous parser registry.
  // onRequestFinished listeners are fire-and-forget, so awaiting here is safe; the
  // block is resolved when the decode settles (it takes ~ms).
  if (state.record.linkedin && isLinkedInWaRequest(req.url)) {
    parseLinkedInWaRequest(req.url, req.postData)
      .then(rec => { if (rec) { rec._source = source; commitRecord(currentBlock(), rec, req, ts); } })
      .catch(() => {});
    return;
  }
  // Async side-path: a taggrs custom-loader POST envelope hides the real hit as an
  // AES-256-GCM blob. Decrypt it in-session with the key sniffed from the loader
  // body, then run the plaintext through the normal registry. GET ?p= blobs are
  // proxied scripts (huge, no body) — skip them; only POST envelopes carry hits.
  if (req.postData && isTaggrsRequest(req.url, req.postData)) {
    handleTaggrs(block, req, ts, source);
  }
}

// Read a JS response body once per host and, if it's a taggrs loader, cache its
// hardcoded AES key. Flushes any hits that arrived before the key was known.
function captureTaggrsKey(harEntry) {
  const res = harEntry.response;
  const mime = (res && res.content && res.content.mimeType) || '';
  if (!/javascript/i.test(mime)) return;
  const url = harEntry.request && harEntry.request.url;
  const host = hostOf(url);
  if (!host || state.taggrsKeys[host]) return;              // unknown or already keyed
  if (!/^\/[a-z0-9_-]+(\.js)?$/i.test(pathOf(url))) return; // plausible loader path only
  try {
    harEntry.getContent((content) => {
      if (!content || state.taggrsKeys[host] || !looksLikeTaggrsLoader(content)) return;
      const key = extractTaggrsKey(content);
      if (!key) return;
      state.taggrsKeys[host] = key;
      flushTaggrsPending(host);
    });
  } catch (e) { /* getContent unavailable on this entry */ }
}

// Decrypt a taggrs envelope and commit the plaintext hit, or buffer it until the
// loader key for its host is captured (the loader usually loads first, but the
// getContent read is async so an early hit can race ahead).
function handleTaggrs(block, req, ts, source) {
  const host = hostOf(req.url);
  const key = state.taggrsKeys[host];
  if (!key) {
    (state.taggrsPending[host] || (state.taggrsPending[host] = [])).push({ block, req, ts, source });
    return;
  }
  decodeTaggrsAndCommit(block, req, ts, source, key);
}

function decodeTaggrsAndCommit(block, req, ts, source, key) {
  decodeTaggrsRequest(req.url, req.postData, key)
    .then((dec) => {
      if (!dec) return;
      const r = parseRequest(dec.url, dec.postData, block.navUrl);   // respects per-provider capture switches
      if (!r) return;
      r._source = source;
      r._taggrs = { host: dec.host, clientId: dec.clientId, endpoint: dec.endpoint, cipherU: dec.cipherU, cipherB: dec.cipherB };
      // Pass the opaque envelope endpoint as the "original" so the detail shows
      // the encrypted destination; effectiveUrl already holds the decrypted URL.
      commitRecord(block, r, { url: dec.endpoint, method: dec.method, postData: dec.postData }, ts);
    })
    .catch(() => { /* wrong key / auth-tag failure → not decodable, drop silently */ });
}

function flushTaggrsPending(host) {
  const q = state.taggrsPending[host];
  const key = state.taggrsKeys[host];
  if (!q || !q.length || !key) return;
  state.taggrsPending[host] = [];
  for (const p of q) decodeTaggrsAndCommit(p.block, p.req, p.ts, p.source, key);
}

// Stamp, transport-collapse and append a parsed record. Shared by the synchronous
// registry path and the async LinkedIn /wa/ path.
function commitRecord(block, r, req, ts) {
  r.method = req.method || r.method;
  r._originalUrl = req.url;
  r._ts = ts;
  r._search = buildSearchText(r);
  // A real Meta /tr/ event clears any pending / shown silent-pixel warning for
  // its pixel id (before the collapse return, so it always registers).
  if (r.provider === 'meta' && r.id) markMetaFired(block, r.id);
  // Generic transport-collapse: records carrying a _collapseKey fold every
  // transport mirror / duplicate fire of one logical hit into a single card.
  if (r._collapseKey) {
    const map = block._collapse || (block._collapse = new Map());
    const existing = map.get(r._collapseKey);
    if (existing) { mergeTransport(existing, r); renderStatus(); return; }
    map.set(r._collapseKey, r);
    r._transports = r._transportLabel ? [r._transportLabel] : [];
  }
  block.events.push(r);
  appendEventDom(block, r);
  renderStatus();
}

// Fold an incoming mirror into an already-displayed record: grow its transport
// list and, if the mirror is a richer endpoint, swap in its payload while keeping
// the card's identity (DOM element, first-seen timestamp, collapse key, search).
function mergeTransport(existing, incoming) {
  if (!existing._transports) existing._transports = existing._transportLabel ? [existing._transportLabel] : [];
  if (incoming._transportLabel && !existing._transports.includes(incoming._transportLabel)) {
    existing._transports.push(incoming._transportLabel);
  }
  if ((incoming._transportRank || 0) > (existing._transportRank || 0)) {
    const keep = { _el: existing._el, _ts: existing._ts, _transports: existing._transports, _collapseKey: existing._collapseKey };
    const mergedSearch = `${existing._search || ''} ${incoming._search || ''}`;
    Object.assign(existing, incoming, keep);
    existing._search = mergedSearch;
  }
  rerenderCard(existing);
}

// --- silent Meta pixel (absence diagnosis) ---------------------------------
// A pixel fetches signals/config on init but sends no /tr/ event. We arm a timer
// per pixel id when its config is seen; if no matching event fires within the
// window, we emit one synthetic warning card. A late event self-heals the card.
const SILENT_PIXEL_DELAY_MS = 2000;

function registerMetaSignal(block, sig, ts) {
  const map = block._metaSignals || (block._metaSignals = new Map());
  if (map.has(sig.id)) return;                                    // one config per pixel per load
  if (block._metaFired && block._metaFired.has(sig.id)) return;   // event already fired first
  const entry = { ...sig, ts, timer: null, warnEl: null, record: null };
  map.set(sig.id, entry);
  entry.timer = setTimeout(() => { entry.timer = null; emitSilentPixelCard(block, entry); }, SILENT_PIXEL_DELAY_MS);
}

function markMetaFired(block, id) {
  (block._metaFired || (block._metaFired = new Set())).add(id);
  const entry = block._metaSignals && block._metaSignals.get(id);
  if (!entry) return;
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (entry.warnEl) {                                             // late event → drop the warning
    const idx = block.events.indexOf(entry.record);
    if (idx >= 0) block.events.splice(idx, 1);
    entry.warnEl.remove();
    entry.warnEl = null;
    entry.record = null;
    renderStatus();
  }
}

function emitSilentPixelCard(block, entry) {
  if (block._metaFired && block._metaFired.has(entry.id)) return; // fired in the meantime
  if (entry.warnEl) return;
  const r = {
    provider: 'meta', signalType: 'config-no-event', transport: 'signal',
    id: entry.id, domain: entry.domain, capiOptin: entry.capiOptin, version: entry.version,
    method: 'GET', host: 'connect.facebook.net',
    queryParams: { id: entry.id, domain: entry.domain || '' },
    _ts: entry.ts,
  };
  r._search = buildSearchText(r);
  block.events.push(r);
  appendEventDom(block, r);
  entry.record = r;
  entry.warnEl = r._el;
  renderStatus();
}

function forEachMetaSignal(fn) {
  for (const block of state.blocks) {
    if (!block._metaSignals) continue;
    for (const entry of block._metaSignals.values()) fn(block, entry);
  }
}

// Stop: decide pending pixels now instead of leaving a timer to fire post-stop.
function flushMetaSignalTimers() {
  forEachMetaSignal((block, entry) => {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; emitSilentPixelCard(block, entry); }
  });
}

// Clear / import: cancel pending timers before the blocks they reference are dropped.
function clearMetaSignalTimers() {
  forEachMetaSignal((block, entry) => { if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; } });
}

// --- service-worker notice (environmental warning) -------------------------
// A compact, per-block strip (not a card, so it stays out of the filter / export
// / event counter) warning that a first-party Tag Gateway service worker is
// active. "mute for session" hides it and any siblings until the panel reloads.
function showSwNotice(block) {
  if (state.swNoticeMuted || block._swNoticeEl) return;
  const el = document.createElement('div');
  el.className = 'blk-notice';
  block._eventsEl.insertBefore(el, block._eventsEl.firstChild);   // sit above this block's cards
  block._swNoticeEl = el;
  paintSwNotice(el);
}

// Render a SW-notice strip for the current Deep Capture state, so the same strip
// flips between two messages: an amber warning with an "enable Deep Capture" link
// while capture is off, and a green all-clear once it's on.
function paintSwNotice(el) {
  const deep = state.deepCapture;
  el.classList.toggle('blk-notice-ok', deep);
  el.innerHTML = deep
    ? `<span class="blk-notice-icon" aria-hidden="true">✓</span>` +
      `<span class="blk-notice-text">Service worker active (first-party tag delivery) — Deep Capture is on, so worker-dispatched hits are captured (marked ⚡ Service Worker).</span>` +
      `<a class="blk-notice-mute" role="button" tabindex="0">mute for session</a>`
    : `<span class="blk-notice-icon" aria-hidden="true">⚠</span>` +
      `<span class="blk-notice-text">Service worker active (first-party tag delivery) — hits may be dispatched from the worker and stay invisible to DevTools / this panel.</span>` +
      `<a class="blk-notice-act" role="button" tabindex="0">enable Deep Capture</a>` +
      `<a class="blk-notice-mute" role="button" tabindex="0">mute for session</a>`;
  bindNoticeAction(el.querySelector('.blk-notice-mute'), () => { state.swNoticeMuted = true; removeAllSwNotices(); });
  if (!deep) bindNoticeAction(el.querySelector('.blk-notice-act'), requestDeepCapture);
}

function bindNoticeAction(a, fn) {
  if (!a) return;
  a.addEventListener('click', fn);
  a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}

// Enable Deep Capture. The <all_urls> host permission is optional and requested here,
// at the user gesture that turns the feature on (the settings toggle or the notice
// link — both count as a gesture). We only switch on if it's granted; a denial reverts
// the checkbox so the stored state never claims a capture we can't perform. Shared by
// the toggle and the notice link.
async function requestDeepCapture() {
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: ['<all_urls>'] }); }
  catch (e) { granted = false; }   // e.g. not treated as a user gesture in this context
  if (!granted) {
    state.deepCapture = false;
    deepCaptureCb.checked = false;
    saveSettings();
    return;
  }
  state.deepCapture = true;
  deepCaptureCb.checked = true;
  connectDeepCapture();
  saveSettings();
  for (const b of state.blocks) if (b._swNoticeEl) paintSwNotice(b._swNoticeEl);   // flip strips to the green all-clear
}

function removeAllSwNotices() {
  for (const b of state.blocks) {
    if (b._swNoticeEl) { b._swNoticeEl.remove(); b._swNoticeEl = null; }
  }
}

function onNavigated(url) {
  if (!state.recording) return;
  startBlock(url);
  renderStatus();
}

chrome.devtools.network.onRequestFinished.addListener(onRequest);
chrome.devtools.network.onNavigated.addListener(onNavigated);

// --- Deep Capture (Spike): webRequest fallback source ----------------------
// A background worker relays every webRequest of the inspected tab here (see
// background.js). Most are duplicates of what the DevTools feed already delivered;
// we only want the ones DevTools never sees — hits fired from a service worker /
// edge scope. Strategy: DevTools is authoritative. When a webRequest event arrives
// we hold it briefly; if the DevTools feed reports the same hit within the window
// we drop the webRequest copy, otherwise we ingest it as a 'worker' hit.
//
// Timing works in our favour: webRequest onBeforeRequest fires at request *start*,
// DevTools onRequestFinished at *completion* — so for a hit both sources see, the
// pending webRequest copy is still waiting when DevTools cancels it. A hit only the
// worker fires simply never gets cancelled and surfaces after the window.
const DEDUP_WINDOW_MS = 5000;
const devtoolsSeen = new Map();   // reqKey -> expiry timestamp (ms)
const pendingWr = new Map();      // reqKey -> timeout id

function reqKey(method, url) { return (method || 'GET') + ' ' + url; }

function noteDevtoolsSeen(method, url) {
  const key = reqKey(method, url);
  devtoolsSeen.set(key, Date.now() + DEDUP_WINDOW_MS);
  const pending = pendingWr.get(key);
  if (pending != null) { clearTimeout(pending); pendingWr.delete(key); }  // DevTools covers it — drop the webRequest copy
}

function onWebRequestEvent(msg) {
  if (!state.deepCapture || !state.recording) return;
  if (!msg || msg.kind !== 'wr-request' || !msg.url) return;
  const key = reqKey(msg.method, msg.url);
  const seenExpiry = devtoolsSeen.get(key);
  if (seenExpiry != null) {
    if (seenExpiry > Date.now()) return;                  // DevTools already delivered this hit
    devtoolsSeen.delete(key);                             // stale entry — let it fall through
  }
  if (pendingWr.has(key)) return;                         // already awaiting a verdict for this key
  const ts = msg.ts || Date.now();
  const timer = setTimeout(() => {
    pendingWr.delete(key);
    if (!state.deepCapture || !state.recording) return;
    // DevTools never claimed it within the window → an invisible worker/edge hit.
    ingestRequest({ url: msg.url, method: msg.method, postData: { text: msg.postData || '' } }, ts, 'worker');
    renderStatus();
  }, DEDUP_WINDOW_MS);
  pendingWr.set(key, timer);
}

// Periodically drop expired dedup markers so the map can't grow unbounded across a
// long recording session.
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of devtoolsSeen) if (expiry <= now) devtoolsSeen.delete(key);
}, DEDUP_WINDOW_MS * 4);

let wrPort = null;
function connectDeepCapture() {
  if (wrPort) return;
  const tabId = chrome.devtools.inspectedWindow.tabId;
  try {
    wrPort = chrome.runtime.connect({ name: 'auditor-panel' });
    wrPort.postMessage({ type: 'init', tabId });
    wrPort.onMessage.addListener(onWebRequestEvent);
    wrPort.onDisconnect.addListener(() => { wrPort = null; });  // background worker recycled — reconnect lazily on next enable
  } catch (e) { wrPort = null; }
}

// --- controls --------------------------------------------------------------

function setRecording(on) {
  state.recording = on;
  renderStatus();
  // Starting reloads the inspected page: the post-reload onNavigated opens the
  // first block and we capture from the very first hit — no empty initial block
  // and no manual reload needed.
  if (on) chrome.devtools.inspectedWindow.reload();
  else flushMetaSignalTimers();                            // decide any pending silent pixels now
}

recordBtn.addEventListener('click', () => setRecording(!state.recording));

clearBtn.addEventListener('click', () => {
  clearMetaSignalTimers();                                 // cancel timers before their blocks vanish
  state.blocks = [];
  state.seen.clear();
  blocksEl.innerHTML = '';
  renderFilterBar();                                       // drop pills for services that were only present via cleared cards
  renderStatus();
});

// --- export / import -------------------------------------------------------
// A capture is a self-describing JSON document: the currently *visible* events
// (filter-sensitive), grouped per page load. Re-importing replays them through
// the same render pipeline, so the extension doubles as a reader for documented
// setups. Only the DOM handle (_el) is dropped on the way out — every data field
// is kept so the round-trip is lossless.
const CAPTURE_TYPE = 'tracking-auditor-capture';

function recordForExport(r) {
  const out = {};
  for (const k in r) if (k !== '_el') out[k] = r[k];
  return out;
}

function captureDomain() {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const u = state.blocks[i].navUrl;
    if (u) { try { return new URL(u).hostname; } catch (e) { /* not a URL */ } }
  }
  return 'capture';
}

function captureTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

exportBtn.addEventListener('click', () => {
  const blocks = [];
  for (const b of state.blocks) {
    const events = b.events.filter(cardMatchesFilter).map(recordForExport);
    if (events.length) blocks.push({ navUrl: b.navUrl, navTime: b.navTime, events });
  }
  if (!blocks.length) { alert('No visible events to export.'); return; }
  const payload = { type: CAPTURE_TYPE, version: 1, exportedAt: new Date().toISOString(), blocks };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${captureDomain()}_${captureTimestamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Rebuild the view from a loaded capture. Recording is stopped (reader mode) and
// the current blocks are replaced; the active display filter still applies, so
// the imported cards honor the Show toggles just like live ones.
function loadCapture(data) {
  clearMetaSignalTimers();                                 // cancel timers before their blocks vanish
  state.recording = false;
  state.blocks = [];
  state.seen.clear();
  blocksEl.innerHTML = '';
  for (const b of data.blocks) {
    const block = { navUrl: b.navUrl, navTime: b.navTime, events: [] };
    state.blocks.push(block);
    appendBlockDom(block);
    for (const r of (b.events || [])) {
      block.events.push(r);
      appendEventDom(block, r);
    }
  }
  renderFilterBar();                                       // reflect the imported services' pills (also clears stale ones)
  renderStatus();
}

importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = '';   // reset so the same file can be re-imported
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { alert('Could not parse the file as JSON.'); return; }
    if (!data || data.type !== CAPTURE_TYPE || !Array.isArray(data.blocks)) {
      alert('Not a Tracking Auditor capture file.');
      return;
    }
    if (state.blocks.length && !confirm('Replace the current capture with the loaded file?')) return;
    loadCapture(data);
  };
  reader.onerror = () => alert('Could not read the file.');
  reader.readAsText(file);
});

// Record settings ("in"): collapsible, toggles which services are captured.
const settingsEl = document.getElementById('settings');
const settingsBtn = document.getElementById('settingsBtn');
settingsBtn.addEventListener('click', () => {
  settingsEl.hidden = !settingsEl.hidden;
  settingsBtn.classList.toggle('active', !settingsEl.hidden);
});
for (const cb of document.querySelectorAll('input[data-rec]')) {
  cb.addEventListener('change', () => { state.record[cb.dataset.rec] = cb.checked; renderFilterBar(); saveSettings(); });
}

// Display filter ("out"): independent of capture — hides cards without dropping
// the captured data, so toggling a pill off and on brings them straight back.
// The pills are built dynamically for the services that are enabled for capture
// PLUS any already recorded in the current session (so imported captures and
// since-disabled services stay filterable). A service you never record gets no
// pill at all.
const fltGroup = document.getElementById('fltGroup');
const fltPills = document.getElementById('fltPills');

// Which services deserve a filter pill right now: enabled for capture, or already
// seen in the current blocks (import / recorded-then-disabled).
function filterProviders() {
  return PROVIDER_ORDER.filter(p => state.record[p] || state.seen.has(p));
}

function renderFilterBar() {
  const providers = filterProviders();
  fltGroup.hidden = providers.length === 0;
  fltPills.innerHTML = providers.map(p => {
    const active = state.filter[p] !== false;
    return `<span class="flt-pill ${active ? 'active' : ''}" data-flt="${escapeHtml(p)}" role="button" tabindex="0" aria-pressed="${active}">${escapeHtml(PROVIDER_LABEL[p] || p)}</span>`;
  }).join('');
  for (const pill of fltPills.querySelectorAll('.flt-pill')) {
    const toggle = () => {
      const p = pill.dataset.flt;
      state.filter[p] = state.filter[p] === false;   // flip
      renderFilterBar();
      applyFilter();
      saveSettings();
    };
    pill.addEventListener('click', toggle);
    pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
}

document.getElementById('filterText').addEventListener('input', (e) => {
  state.filter.text = e.target.value;
  applyFilter();
});

// Bulk "all / none" for the Show row — one gesture instead of toggling each
// provider as the list grows. Only touches the services that currently have a pill.
function setAllFilters(on) {
  for (const p of filterProviders()) state.filter[p] = on;
  renderFilterBar();
  applyFilter();
  saveSettings();
}
function bindLink(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}
bindLink('fltAll', () => setAllFilters(true));
bindLink('fltNone', () => setAllFilters(false));

const deepCaptureCb = document.getElementById('deepCapture');
deepCaptureCb.addEventListener('change', () => {
  if (deepCaptureCb.checked) {
    requestDeepCapture();                                 // grant-gated; reverts the box if the permission is denied
  } else {
    state.deepCapture = false;
    for (const b of state.blocks) if (b._swNoticeEl) paintSwNotice(b._swNoticeEl);  // flip strips back to the warning
    saveSettings();
  }
});

// --- settings persistence --------------------------------------------------
// Record toggles and filter toggles are scoped to the extension (chrome.storage),
// not the inspected tab — so they survive closing DevTools and switching tabs.
// The free-text filter is intentionally left out: a persisted search would
// silently hide cards on the next open.
const SETTINGS_KEY = 'trackingAuditorSettings';

function saveSettings() {
  const { text, ...filterToggles } = state.filter;
  chrome.storage.local.set({ [SETTINGS_KEY]: { record: state.record, filter: filterToggles, deepCapture: state.deepCapture } });
}

// Pull persisted toggles into state, then sync the checkboxes to match.
function loadSettings() {
  chrome.storage.local.get(SETTINGS_KEY, (data) => {
    const saved = data && data[SETTINGS_KEY];
    if (saved) {
      if (saved.record) Object.assign(state.record, saved.record);
      if (saved.filter) Object.assign(state.filter, saved.filter);
      if (typeof saved.deepCapture === 'boolean') state.deepCapture = saved.deepCapture;
      for (const cb of document.querySelectorAll('input[data-rec]')) cb.checked = !!state.record[cb.dataset.rec];
      // Restore Deep Capture only if the optional host permission is still held — the
      // user may have revoked it in chrome://extensions since last session.
      if (state.deepCapture) {
        chrome.permissions.contains({ origins: ['<all_urls>'] }, (has) => {
          state.deepCapture = has;
          deepCaptureCb.checked = has;
          if (has) connectDeepCapture();
          else saveSettings();                             // persist the corrected off-state
        });
      } else {
        deepCaptureCb.checked = false;
      }
    }
    renderFilterBar();                                     // pills reflect the persisted record/filter state
    applyFilter();
  });
}

renderFilterBar();                                         // initial pills before storage resolves (default: all enabled)
loadSettings();
renderStatus();
