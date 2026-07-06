// Panel UI controller: captures tracking requests of the inspected tab via the
// DevTools network API and renders them in blocks per navigation. Each request is
// offered to every provider parser (GA4, Meta); the first that claims it wins.
import { parseGa4Request } from './lib/ga4.js';
import { parseMetaRequest } from './lib/meta.js';
import { parseUetRequest } from './lib/uet.js';
import { parseTiktokRequest } from './lib/tiktok.js';
import { parsePinterestRequest } from './lib/pinterest.js';
import { parseGoogleAdsRequest } from './lib/googleads.js';
import { parseLinkedInRequest, isLinkedInWaRequest, parseLinkedInWaRequest } from './lib/linkedin.js';
import { parseRedditRequest } from './lib/reddit.js';
import { parseSnapchatRequest } from './lib/snapchat.js';
import { isServiceWorkerPhantom } from './lib/har.js';

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
  { id: 'linkedin', parse: parseLinkedInRequest },
  { id: 'reddit', parse: parseRedditRequest },
  { id: 'snapchat', parse: parseSnapchatRequest },
];

const state = {
  recording: false,
  blocks: [],                                             // [{ navUrl, navTime, events:[], _el, _eventsEl }]
  record: { ga4: true, meta: true, uet: true, tiktok: true, pinterest: true, googleads: true, linkedin: true, reddit: true, snapchat: true },           // capture switches (the "in" side)
  filter: { ga4: true, meta: true, uet: true, tiktok: true, pinterest: true, googleads: true, linkedin: true, reddit: true, snapchat: true, text: '' }, // display filter (the "out" side)
  seen: new Set(),                                         // providers that actually appeared in the current capture (drives filter pills for since-disabled/imported services)
  autoScroll: true,                                       // "follow": keep the newest events in view while recording
};

// Filter pills are built from this order; only enabled or already-seen services
// get a pill, so the bar carries nothing for a service you never record.
const PROVIDER_ORDER = ['ga4', 'googleads', 'meta', 'uet', 'tiktok', 'pinterest', 'linkedin', 'reddit', 'snapchat'];
const PROVIDER_LABEL = { ga4: 'GA4', googleads: 'Google Ads', meta: 'Meta', uet: 'Bing', tiktok: 'TikTok', pinterest: 'Pinterest', linkedin: 'LinkedIn', reddit: 'Reddit', snapchat: 'Snapchat' };

// --- helpers ---------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function totalEvents() {
  return state.blocks.reduce((n, b) => n + b.events.length, 0);
}

// "Follow" the stream: keep the panel pinned to the bottom so new hits scroll
// into view on their own. Only used on the live-capture path (import doesn't
// jump). The DevTools panel scrolls the document itself.
function maybeAutoScroll() {
  if (!state.autoScroll) return;
  const el = document.scrollingElement || document.documentElement;
  el.scrollTop = el.scrollHeight;
}

function formatTime(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// Provider-agnostic accessors.
function eventName(r) {
  if (r.provider === 'meta')   return r.ev;
  if (r.provider === 'uet')    return r.eventName;
  if (r.provider === 'tiktok') return r.event;
  if (r.provider === 'pinterest') return r.event;
  if (r.provider === 'googleads') return r.event || (r.signalType === 'upd' ? 'user data' : null); // UPD form-data carries no en
  if (r.provider === 'linkedin') return r.eventName;
  if (r.provider === 'reddit')   return r.event;
  if (r.provider === 'snapchat') return r.event;

  return r.en;
}
function accountId(r) {
  if (r.provider === 'meta')   return r.id;
  if (r.provider === 'uet')    return r.ti;
  if (r.provider === 'tiktok') return r.code;
  if (r.provider === 'pinterest') return r.tid;
  if (r.provider === 'googleads') return r.accountId;   // AW-<convId>
  if (r.provider === 'linkedin') return r.pid;
  if (r.provider === 'reddit')   return r.pixelId;
  if (r.provider === 'snapchat') return r.pixelId;
  return r.tid;
}
function accountTitle(r) {
  if (r.provider === 'meta')   return 'Pixel ID (id)';
  if (r.provider === 'uet')    return 'UET Tag ID (ti)';
  if (r.provider === 'tiktok') return 'Pixel Code';
  if (r.provider === 'pinterest') return 'Tag ID (tid)';
  if (r.provider === 'googleads') return 'Conversion ID (AW)';
  if (r.provider === 'linkedin') return 'Partner ID (pid)';
  if (r.provider === 'reddit')   return 'Pixel ID (id)';
  if (r.provider === 'snapchat') return 'Pixel ID (pid)';
  return 'Measurement ID (tid)';
}
function docLocation(r) {
  if (r.provider === 'tiktok' || r.provider === 'pinterest' || r.provider === 'googleads' || r.provider === 'linkedin' || r.provider === 'reddit' || r.provider === 'snapchat') return r.pageUrl || null; // page url lives in the payload
  const key = r.provider === 'uet' ? 'p' : 'dl';   // UET carries the page url in p
  return (r.queryParams && r.queryParams[key]) || (r.bodyParams && r.bodyParams[key]) || null;
}

// --- pill / summary rendering ---------------------------------------------

// GA4 transport sub-pills shown next to the GA4 provider pill (standard needs none).
const GA4_TRANSPORT_SUB = {
  'first-party': { cls: 'pill-custom', label: 'first-party', tip: 'First-party sGTM / Tag Gateway on a standard collect path' },
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
      pills.push('<span class="pill pill-custom" title="First-party / sGTM-proxied Ads endpoint on the site&#39;s own domain (untested)">first-party</span>');
    }
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
  const pills = ['<span class="pill pill-ga4" title="Google Analytics 4">GA4</span>'];
  const sub = GA4_TRANSPORT_SUB[r.transport];
  if (sub) pills.push(`<span class="pill ${sub.cls}" title="${escapeHtml(sub.tip)}">${escapeHtml(sub.label)}</span>`);
  return pills.join('');
}

function flagPills(r) {
  const out = [];
  if (r.provider === 'meta') {
    const f = r.flags || {};
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
  const f = r.flags;
  if (!f) return '';
  if (f.conversion)    out.push('<span class="pill pill-conversion" title="_c=1 — conversion / key event">conversion</span>');
  if (f.externalEvent) out.push('<span class="pill pill-ee" title="_ee=1 — external event (created via GA4 configuration)">external</span>');
  if (f.sessionStart)  out.push('<span class="pill pill-event" title="_ss=1 — session start">session start</span>');
  if (f.firstVisit)    out.push('<span class="pill pill-event" title="_fv=1 — first visit">first visit</span>');
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

function metaUserDataSection(userData) {
  if (!userData) return '';
  // Show the masked shape (PII-free) plus whether a hash was actually sent.
  const rows = Object.values(userData).map((f) => {
    const shape = f.mask || f.normalizedMask || (f.hashed ? '(hashed only)' : '');
    const note = f.hashed ? ' · hashed' : '';
    return `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(shape)}${escapeHtml(note)}</td></tr>`;
  });
  return section('user data (advanced matching)', `<table class="det-table">${rows.join('')}</table>`);
}

function detailHtml(r) {
  let meta, extras = '';

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
    extras += metaUserDataSection(r.userData);
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

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw)'}</td></tr>`);
      extras += section('user data (enhanced conversions)', `<table class="det-table">${rows.join('')}</table>`);
    }
  } else if (r.provider === 'tiktok') {
    meta = [
      ['event', r.event], ['pixel code', r.code],
      ['transport', r.transport], ['method', r.method],
      ['event id (dedup)', r.eventId], ['message id', r.messageId],
      ['library', r.library],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / not hashed)'}</td></tr>`);
      extras += section('user data (context.user)', `<table class="det-table">${rows.join('')}</table>`);
    }

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

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / not hashed)'}</td></tr>`);
      extras += section('enhanced match (pd)', `<table class="det-table">${rows.join('')}</table>`);
    }
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
    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / plain)'}</td></tr>`);
      extras += section('enhanced conversions (em)', `<table class="det-table">${rows.join('')}</table>`);
    }
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
  } else if (r.provider === 'linkedin' && r._endpoint === 'wa') {
    meta = [
      ['signal type', r.signalType], ['partner id (pid)', r.pid],
      ['page title', r.pageTitle], ['page url', r.pageUrl],
      ['transport', r.transport], ['method', r.method],
      ['version (scriptVersion)', r.version], ['time', r.time],
      ['request url', r.effectiveUrl],
    ].filter(([, v]) => v != null && v !== '');

    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / plain)'}</td></tr>`);
      extras += section('enhanced conversions (hem)', `<table class="det-table">${rows.join('')}</table>`);
    }
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
    if (r.userData) {
      const rows = Object.values(r.userData).map((f) => {
        const note = f.hashed ? 'hashed' : '(raw / plain)';
        const extra = f.list ? ` · ${f.list.length} value(s)` : '';
        return `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(note)}${escapeHtml(extra)}</td></tr>`;
      });
      extras += section('user data (advanced + auto matching)', `<table class="det-table">${rows.join('')}</table>`);
    }
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
    if (r.userData) {
      const rows = Object.values(r.userData).map((f) =>
        `<tr><td>${escapeHtml(f.label)}</td><td>${f.hashed ? 'hashed' : '(raw / plain)'}</td></tr>`);
      extras += section('user data (advanced matching — incl. geo/age)', `<table class="det-table">${rows.join('')}</table>`);
    }
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
  } else {
    meta = [
      ['event (en)', r.en], ['measurement id (tid)', r.tid],
      ['transport', r.transport], ['method', r.method],
      ['request url', r.effectiveUrl],
      ['original (masked) url', r._originalUrl && r._originalUrl !== r.effectiveUrl ? r._originalUrl : null],
    ].filter(([, v]) => v != null && v !== '');

    if (r.consent) {
      const rows = [];
      if (r.consent.gcs) rows.push(['gcs', r.consent.gcs]);
      if (r.consent.gcd) rows.push(['gcd', r.consent.gcd]);
      if (Array.isArray(r.consent.gcdDecoded)) {
        for (const p of r.consent.gcdDecoded) rows.push([p.purpose, p.text]);
      }
      extras += section('Consent', kvTable(rows));
    }
    if (r.userData) {
      extras += section('user_data', kvTable([['parsed', JSON.stringify(r.userData)]]));
    }
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
  blocksEl.appendChild(el);
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
      <span class="ev-caret" title="Show all parameters">▼</span>
    </div>
    <div class="ev-name">${escapeHtml(eventName(r) || '(no event name)')}</div>
    ${dl ? `<div class="ev-dl" title="document location (dl)">${escapeHtml(dl)}</div>` : ''}
    <div class="ev-pills">${providerPills(r)}${flagPills(r)}${consentPills(r)}</div>
    ${summaryPills(r) ? `<div class="ev-summary">${summaryPills(r)}</div>` : ''}
    ${detailHtml(r)}`;
}

function appendEventDom(block, r) {
  const card = document.createElement('div');
  card.className = `ev p-${r.provider} t-${r.transport}`;
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
  block._eventsEl.appendChild(card);
  r._el = card;
  if (r.provider && !state.seen.has(r.provider)) { state.seen.add(r.provider); renderFilterBar(); }   // ensure a pill exists for this service
  applyCardVisibility(r);
}

// Re-render a card in place after a collapse merge (transport list grew, or a
// richer transport mirror replaced the displayed payload). The element and its
// click listener are kept; only the inner markup is rebuilt.
function rerenderCard(r) {
  if (!r._el) return;
  r._el.className = `ev p-${r.provider} t-${r.transport}`;
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

function parseRequest(url, postData) {
  for (const p of PARSERS) {
    if (!state.record[p.id]) continue;          // service capture switched off
    const r = p.parse(url, postData);
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
  const ts = harEntry.startedDateTime ? new Date(harEntry.startedDateTime).getTime() : Date.now();
  const r = parseRequest(req.url, req.postData);
  if (r) { commitRecord(currentBlock(), r, req, ts); return; }
  // Async side-path: the LinkedIn /wa/ POST is base64(gzip(JSON)) and needs an
  // async DecompressionStream, so it can't ride the synchronous parser registry.
  // onRequestFinished listeners are fire-and-forget, so awaiting here is safe; the
  // block is resolved when the decode settles (it takes ~ms).
  if (state.record.linkedin && isLinkedInWaRequest(req.url)) {
    parseLinkedInWaRequest(req.url, req.postData)
      .then(rec => { if (rec) commitRecord(currentBlock(), rec, req, ts); })
      .catch(() => {});
  }
}

// Stamp, transport-collapse and append a parsed record. Shared by the synchronous
// registry path and the async LinkedIn /wa/ path.
function commitRecord(block, r, req, ts) {
  r.method = req.method || r.method;
  r._originalUrl = req.url;
  r._ts = ts;
  r._search = buildSearchText(r);
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
  maybeAutoScroll();
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

function onNavigated(url) {
  if (!state.recording) return;
  startBlock(url);
  renderStatus();
  maybeAutoScroll();
}

chrome.devtools.network.onRequestFinished.addListener(onRequest);
chrome.devtools.network.onNavigated.addListener(onNavigated);

// --- controls --------------------------------------------------------------

function setRecording(on) {
  state.recording = on;
  renderStatus();
  // Starting reloads the inspected page: the post-reload onNavigated opens the
  // first block and we capture from the very first hit — no empty initial block
  // and no manual reload needed.
  if (on) chrome.devtools.inspectedWindow.reload();
}

recordBtn.addEventListener('click', () => setRecording(!state.recording));

clearBtn.addEventListener('click', () => {
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

// "Follow" toggle: auto-scroll to the newest events while recording.
const autoScrollCb = document.getElementById('autoScroll');
autoScrollCb.addEventListener('change', () => {
  state.autoScroll = autoScrollCb.checked;
  saveSettings();
  maybeAutoScroll();                                     // jump to the bottom the moment it's re-enabled
});

// --- settings persistence --------------------------------------------------
// Record toggles and filter toggles are scoped to the extension (chrome.storage),
// not the inspected tab — so they survive closing DevTools and switching tabs.
// The free-text filter is intentionally left out: a persisted search would
// silently hide cards on the next open.
const SETTINGS_KEY = 'trackingAuditorSettings';

function saveSettings() {
  const { text, ...filterToggles } = state.filter;
  chrome.storage.local.set({ [SETTINGS_KEY]: { record: state.record, filter: filterToggles, autoScroll: state.autoScroll } });
}

// Pull persisted toggles into state, then sync the checkboxes to match.
function loadSettings() {
  chrome.storage.local.get(SETTINGS_KEY, (data) => {
    const saved = data && data[SETTINGS_KEY];
    if (saved) {
      if (saved.record) Object.assign(state.record, saved.record);
      if (saved.filter) Object.assign(state.filter, saved.filter);
      if (typeof saved.autoScroll === 'boolean') state.autoScroll = saved.autoScroll;
      for (const cb of document.querySelectorAll('input[data-rec]')) cb.checked = !!state.record[cb.dataset.rec];
      autoScrollCb.checked = state.autoScroll;
    }
    renderFilterBar();                                     // pills reflect the persisted record/filter state
    applyFilter();
  });
}

renderFilterBar();                                         // initial pills before storage resolves (default: all enabled)
loadSettings();
renderStatus();
