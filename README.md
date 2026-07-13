# Tracking Auditor Extension

![The Tracking Auditor DevTools panel: a live, per-page stream of decoded GA4, Meta, Bing, TikTok, Pinterest, Google Ads, LinkedIn, Reddit and Snapchat hits — each card tinted per service with event, ID, consent and parameter pills, above a service-filter pill bar.](webstore/01-overview.png)

A lightweight Chrome **DevTools** extension that records GA4, **Meta**, **Bing**,
**TikTok**, **Pinterest**, **Google Ads**, **LinkedIn**, **Reddit** and **Snapchat**
requests of the inspected tab — including transports that common debuggers miss:

GA4:
- Standard GA4 (`google-analytics.com` / `analytics.google.com`, `/g/collect`)
- First-party sGTM / Google Tag Gateway (`/g/collect` / `/collect` with `v=2` & `tid=G-…`)
- **Stape Custom Loader** (GA4 path base64-encoded inside a query parameter)
- **Plaintext custom delivery paths** (cryptic path without `collect`, but `v=2` & `tid=G-…` & `en`)

Meta (Facebook) Pixel:
- Standard pixel (`facebook.com/tr`, GET beacon or form POST)
- First-party proxied `/tr` on the site's own domain
- Reads `ev`/`id`, custom data (`cd[…]`), advanced matching (`ud`/`udff`/`cud`/`ncud`/`aud`
  — masks kept, each field counted once), CAPI dedup (`eid`) and Limited Data Use (`dpo`)

Bing / Microsoft UET:
- Standard tag (`bat.bing.com/action` / `actionp`) and first-party proxied `/action`
- Reads `ti`/`evt`, custom event `ec`/`ea`/`el`/`ev`, `gv`/`gc` revenue, `ecomm_*` fields,
  enhanced-conversion identifiers from the `pid` querystring, and the `asc` consent
  signal (granted/denied/**unset** — a missing signal is shown, not hidden)

TikTok Pixel:
- Standard pixel (`analytics.tiktok.com/api/v2/pixel` POST JSON, `/act` batch) and the
  base64 transport (payload base64-encoded in `?analytics_message=`)
- Reads `event`/`context.pixel.code`, advanced matching (`context.user` — email/phone/
  external_id, hashed flag), e-commerce (`properties.value`/`currency`/`contents[]`),
  Events API dedup (`event_id`), and TikTok's own data-quality verdict
  (`signal_diagnostic_labels` + `_inspection.identity_params` — surfaced verbatim, e.g.
  "phone invalid · invalid_country")

Pinterest Tag:
- Standard tag (`ct.pinterest.com/v3/` GET beacon, POST for large payloads). The
  `/user` endpoint (subset only) is ignored.
- Reads `tid`/`event` (with alias→canonical mapping), enhanced match (`pd` — em/ph/…
  hashes + `pin_unauth`, `aem_eligible_list`), e-commerce (`ed.value`/`currency`/
  `order_id`/`line_items[]`), custom `ed` fields, Conversions API dedup (`ed.event_id`)
  and the `ad.is_eu` region flag

Google Ads:
- Conversion (`googleadservices.com/pagead/conversion` · `/ccm/conversion`,
  first-party `google.com/pagead/1p-conversion`), remarketing/audience
  (`doubleclick.net/pagead/viewthroughconversion` · `google.com/rmkt/collect` ·
  `/pagead/1p-user-list`), measurement (`google.com/ccm/collect`, `tid=AW-…`) and
  enhanced-conversions UPD (`/pagead/form-data` · `/ccm/form-data`)
- One user action fans out across many mirrored transports — they are folded into a
  **single card per logical hit** (`×N transports`), anchored on the `AW-<id>`
  conversion id (filter the log by `AW-…`, the bare id or a conversion label)
- Reads conversion `label`/`bttype`/`value`/`currency_code`/`oid`, the hashed `em`
  enhanced-conversions token (email/phone/name/address — hex **and** base64url),
  dynamic-remarketing product `data` (`google_business_vertical`/`id`), line items,
  and `gcs`/`gcd` consent. Pure Privacy-Sandbox / telemetry pings are filtered out.

LinkedIn Insight Tag:
- Standard beacon (`px.ads.linkedin.com/collect`), with the `px4` mirror (which adds
  the encrypted-IP `e_ipv6`) folded into a **single card** — the richer mirror wins.
- Reads the partner id (`pid`), tells a plain **PageView** from a **Conversion**
  (`conversionId` present), and surfaces the page `url`, tag manager (`tm`) and the
  `e_ipv6` IP hash. The `/attribution_trigger` endpoint (redundant) is ignored.
- The hashed email (`hem`, SHA-256) does **not** ride in the `/collect` beacon — it
  travels in a `base64(gzip(JSON))` `/wa/` POST body, decoded asynchronously (via
  `DecompressionStream`) into its own card. That card surfaces the `signalType`, the
  hashed email as a PII indicator, LinkedIn's first-party ad-tracking ids
  (`liFatId`/`liGiant`) when present, and the full decoded payload. `/wa/` is the only
  place LinkedIn's enhanced-conversions PII leaves the browser.

Reddit Pixel:
- Browser beacon (`alb.reddit.com/rp.gif`). Reads the pixel id (`id`, `a2_…`), the event
  (PageVisit / Purchase / Lead / …, custom name in `m.customEventName`) and the
  conversion data (`m.value` / `m.valueDecimal` / `m.currency` / `m.transactionId`).
- Surfaces both manually-set (`em` / `pn` / `external_id`) and auto-collected
  (`auto_em` / `auto_pn`) hashed identifiers as advanced-matching / auto-match indicators —
  this beacon is the only place the Reddit Pixel sends user data.

Snapchat Pixel:
- Event beacon (`tr.snapchat.com/p`). The `GET /p` hit is the tracking event; the
  `POST /p` telemetry (context, form-field detection, no identifiers) is ignored.
- Reads the pixel id (`pid`), the event (`PAGE_VIEW` / `PURCHASE` / …) and e-commerce
  (`e_pr` / `e_cur` / `e_tid` / `e_iids` / `e_bds` + purchase extras like
  `client_deduplication_id`, `customer_status`, `success`).
- Surfaces the full hashed identifier set — email, phone, name, **and geo (city, country,
  postal, region) and age**, which Snapchat also hashes — as advanced-matching indicators.

It adds a **"Tracking Auditor"** tab to DevTools. Hit **Start & Reload** — the
page reloads and every hit is listed in blocks per navigation, **newest first**, with
event name, parameters, a user-data summary and (where present) the consent state
decoded. New hits appear at the top, so the freshest is always in view and whatever
you are reading stays put. A collapsible
**Record** settings row switches services on/off (capture) and holds an **Advanced**
row with the optional **Deep Capture** mode, and an independent
**Show** filter row (service pills + fulltext) narrows the displayed log — the
pills cover only the services you actually record, so the bar carries no toggle
for a service you never capture — with **all / none** shortcuts to focus on a
single service quickly.

**Deep Capture (optional).** Some first-party setups deliver tags through a
**service worker** — Google Tag Gateway, a Cloudflare/edge worker, or Bing UET —
and dispatch their hits from the worker's own scope, where the page-scoped DevTools
network never sees them. Enabling **Deep Capture** (⚙ → Advanced) adds a second
observer via `chrome.webRequest` that catches those hits, de-duplicates them against
the normal feed and flags the worker-only ones with a **⚡ service worker** badge. It
is **off by default**; the broad host permission it needs is requested only when you
switch it on, so nothing is granted at install unless you actually use it.

The goal is narrow: **detect requests, read parameters.** No hash validation, no
EM decoder, no compliance checks. A focused gap-filler — not a replacement for
David Vallejo's excellent Analytics Debugger.

## Install
This extension can be installed using the Chrome Web Store: [Tracking Auditor in Chrome Web Store](https://chromewebstore.google.com/detail/tracking-auditor/cngpoecoknpgfjfaafnekjoaeohaejpb)

### From source (for development or forking)
If you want to modify the extension or run an unreleased version, load it unpacked:

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the project folder
5. Pin the extension if you want it in the toolbar

## Changelog

### Unreleased
- **HubSpot** (10th provider): detects HubSpot's tracking surfaces — the `track(-<region>).hubspot.com` beacons `/__ptq.gif` (page view), `/__ptbe.gif` (custom behavioral event, name in `n`, properties as `_<name>`) and `/__ptc.gif` (click / interaction, target described by `_hs_*`), plus the **Collected Forms** submit `POST` to `forms(-<region>).hscollectedforms.net/collected-forms/submit/form`. The account is the hub id (`a` / `portalId`). Identity data travels in **cleartext** (HubSpot does not hash) — via the doubly URL-encoded `i` param on any beacon, or as `contactFields` (email / name / phone) in the form submit — so the PII block reports it honestly as "not hashed", and the form's submitted `formValues` are shown verbatim. Loader/config/analytics scripts and form counters are not tracking hits and are ignored. Coral pill.
- **PII / user-data block**: every request detail now carries one uniform "PII / user data" section across all providers. Each user-data field is shown as raw parameter · plain-language category (e.g. `u_hem` → Email, `l_city` → City) · detected hash form (SHA-256 / SHA-1 / MD5, base64url SHA-256 recognised). A terse inline note appears only when the detected form contradicts the algorithm the provider requires (e.g. an MD5-shaped value where SHA-256 is mandated); plaintext is stated plainly, without a leak alarm. Reads only — no plaintext comparison, no normalization, no hash validation.

### 0.9.0
- **Deep Capture (service-worker / edge hits)**: an opt-in mode that adds a second capture source via `chrome.webRequest` (in a new background service worker), catching tracking hits dispatched from a service worker's own scope — first-party Google Tag Gateway, Cloudflare edge, and (as found in testing) Bing UET — which the page-scoped DevTools network feed never sees. These hits are de-duplicated against the DevTools feed (only what DevTools missed is ingested) and marked with a **⚡ service worker** badge, which the fulltext filter also matches. Off by default; the broad host permission is **optional** and requested at the moment you switch it on (from the toggle or the notice link), so nothing broad is granted at install. The service-worker notice now carries an **"enable Deep Capture"** link and flips to a green all-clear once on.
- **Newest-first ordering**: new hits and page-load blocks are inserted at the top instead of the bottom, so the freshest hit stays in view and Chrome's scroll anchoring keeps whatever you're reading in place. The **⤓ follow** auto-scroll toggle is removed as redundant.
- **Meta silent-pixel warning**: a pixel can initialise (its `signals/config` fetch fires) yet send no `/tr/` event — a silent tracking failure, typically caused by Meta's traffic-permission settings. When Meta recording is on, a 2-second timer per pixel id is armed on the config fetch; if no matching event follows, a single warning card is shown (a late event self-heals it). Network inference only, no new permissions.
- **GA4 e-commerce items**: the tilde-packed `pr1..prN` product params are decoded into readable fields (item_id, item_name, brand, category1–5, variant, price, quantity, coupon, discount, index, list, promotion, creative, location) plus item-scoped custom `k<n>/v<n>` pairs. Unknown codes are surfaced, never dropped. Rendered as one sub-table per product with an "items ×N" pill.
- **Service-worker notice**: detects the Google Tag Gateway first-party service-worker loader (`sw_iframe.html`) and shows a compact per-block strip — hits may be dispatched from the worker and stay invisible to the page-scoped DevTools network. UI-only (not a card), with a "mute for session" link.

### 0.7.2
- **Service-worker de-duplication**: when a service worker (e.g. Cloudflare Zaraz) intercepts a page's `fetch()`, DevTools surfaces the hit twice — the aborted page-side request that never reached the network, plus the worker's real outgoing request. The aborted phantom (network error and no server connection) is now dropped, so each logical hit counts once.

### 0.7.1
- **Show** filter row reworked from fixed checkboxes to compact toggle **pills**, built only for the services you actually record (or that already appear in the current/imported capture) — no toggle for a service you never capture.

### 0.7.0
- Added the **Reddit Pixel** provider (`alb.reddit.com/rp.gif`): event, conversion data (`m.*`), and both manual (`em`/`pn`/`external_id`) and auto-collected (`auto_em`/`auto_pn`) hashed identifiers.
- Added the **Snapchat Pixel** provider (`tr.snapchat.com/p`): event, e-commerce (`e_*`), and the full hashed identifier set — email, phone, name, **geo and age** — with the `POST /p` telemetry beacon ignored.
- **LinkedIn**: the `/wa/` enhanced-conversions POST (`base64(gzip(JSON))`) is now decoded asynchronously into its own card — hashed email, `signalType`, and `liFatId`/`liGiant`.

### 0.6.0
- Initial release: GA4, Meta Pixel, Bing UET, TikTok Pixel, Pinterest Tag, Google Ads and LinkedIn Insight Tag (standard `/collect`).