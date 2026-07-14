# Tracking Auditor Extension

![The Tracking Auditor DevTools panel: a live, per-page stream of decoded GA4, Meta, Bing, TikTok, Pinterest, Google Ads, Floodlight, LinkedIn, Reddit, Snapchat, HubSpot and Criteo hits — each card tinted per service with event, ID, consent and parameter pills, above a service-filter pill bar.](webstore/01-overview.png)

A lightweight Chrome **DevTools** extension that records GA4, **Meta**, **Bing**,
**TikTok**, **Pinterest**, **Google Ads**, **Floodlight**, **LinkedIn**, **Reddit**,
**Snapchat**, **HubSpot** and **Criteo** requests of the inspected tab — including
transports that common debuggers miss:

GA4:
- Standard GA4 (`google-analytics.com` / `analytics.google.com`, `/g/collect`)
- First-party sGTM / Google Tag Gateway (`/g/collect` / `/collect` with `v=2` & `tid=G-…`)
- **Stape Custom Loader** (GA4 path base64-encoded inside a query parameter)
- **taggrs Custom Loader** (AES-256-GCM-encrypted envelope, decrypted in-session with the loader's own key)
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

Floodlight (Google Marketing Platform — CM360 / DV360):
- The same DoubleClick infrastructure as Google Ads, but a distinct endpoint with
  **matrix parameters** (`;`-delimited in the path, not a query string): the counter
  `ad.doubleclick.net/activity` and its image mirror `<src>.fls.doubleclick.net/activityi`,
  which share `(src,type,cat,ord)` and are folded into a **single card**.
- Reads the Floodlight config id (`src`), the advertiser-defined activity **group** (`type`)
  and **tag** (`cat`) verbatim, the ordinal (`ord`), tells a **counter** from a **sales**
  activity (`cost`/`qty` → revenue), the custom variables (`u1..uN` — page url, product id,
  …), the DoubleClick id (`auiddc`), the `~oref` page url, and `gcs`/`gcd`/`dma`/`npa`/`gpp`
  consent. Custom vars are opaque, so only an unmistakable **cleartext email** (`@`) in a
  `u*` is flagged as PII — hash-shaped ids are left alone to avoid false alarms.

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

HubSpot:
- Tracking-code beacons (`track(-<region>).hubspot.com`): `__ptq.gif` (page view),
  `__ptbe.gif` (custom behavioral event — name in `n`, properties as `_<name>`) and
  `__ptc.gif` (click / interaction, target described by `_hs_*`). Account = hub id (`a`).
- **Collected Forms** (`forms(-<region>).hscollectedforms.net/collected-forms/submit/form`,
  POST JSON): HubSpot scraping a filled form and shipping `contactFields` and every
  submitted `formValues` field. Account = `portalId`.
- Identity data travels in **cleartext** (HubSpot does not hash) — the `identify()`
  payload in the doubly-encoded `i` param on any beacon, or the form's `contactFields`
  (email / name / phone). The PII block reports it honestly as **"not hashed"**. Loader/
  config/analytics scripts and form counters are not tracking hits and are ignored.

Criteo:
- OneTag event beacon (`sslwidget.criteo.com/event`). The account is the Criteo id (`a`).
  Identity-sync (`gum.criteo.com`) and loader (`dynamic.criteo.com`) requests are not
  tracking hits and are ignored.
- Decodes the `p0..pN` event slots — a hit bundles several (`exd`/`dis` technical, plus the
  real event: `vh` view home, `vl` view list, `vp` view item, `vb` view basket, `ac` add to
  cart, `vc` transaction, `trackleads` lead, …). The primary event is surfaced; unknown codes
  are kept verbatim. Reads the (double-encoded) item array (`id`/`price`/`quantity`), the
  category, the transaction id, and derives a revenue total (Σ price × quantity, marked
  **computed** since Criteo sends no total) with the `c` currency.
- **`setEmail` (`ce`) ships the email address in CLEARTEXT** (not hashed) — surfaced as a
  "cleartext email" indicator and reported in the PII block as "not hashed". The shared
  cross-vendor cookies (`sc`, e.g. `fbp`) and `cs`/`gpp` consent are surfaced too.

Taboola:
- Pixel beacons to `trc.taboola.com` (loader `cdn.taboola.com/libtrc/unip/<account>/tfa.js`).
  The account is the numeric Taboola id; the loader, `pips`/`cds`/`sync-*` id-sync and
  `p3p.xml` are not tracking events and are ignored.
- Two shapes: the **page view** `GET /<account>/trc/3/json?data=<JSON>` (the event rides
  inside the URL-encoded `data` JSON as `data.mpvd.en`), and **events**
  `GET /<account>/log/3/<action>?en=<event>` (page view · view_content · add_to_cart ·
  start_checkout · make_purchase · lead · complete_registration · …, custom names kept
  verbatim). A conversion adds flat `revenue` / `currency` / `orderid` / `quantity`.
- Surfaces the user id (`ui`), page (`item-url`) / referrer and consent verbatim (the TCF
  `tcs` string — shown, not decoded — plus US-privacy `ccpaPs` and the CMP name `cbp`).
  Taboola tracks by cookie/id, and carries a hashed-email identity when configured:
  AudienceMatch's `unified_id` (SHA-256 of the lower-cased email) rides as a flat
  `unified_id` query param on the request — surfaced as a hashed **Email** identifier
  in the PII block. The `pre_d_eng_tb` engagement ping (time-on-site / scroll) is
  flagged as telemetry, not a real event.

Outbrain:
- The conversion pixel (`obApi`) fires a `GET` to `tr.outbrain.com/unifiedPixel`
  (loader `amplify.outbrain.com/cp/obtp.js`). The account is the `marketerId`; the
  loader, `wave`/`my`/`sync` hosts are not tracking events and are ignored.
- Reads the event `name` — `PAGE_VIEW` (automatic) plus other events, classified as a
  documented **standard** name (Purchase / AddToCart / Lead / ViewContent / …) or an
  advertiser **custom** name, kept verbatim (a "conversion" is a mapping in Outbrain's
  UI, not a property of the pixel fire) — the page (`dl`) /
  referrer / previous page (`pRef`), the channel it fired through (`cht`, e.g. `gtm`),
  the region (`zone`) and the API / pixel build (`obApiVersion` / `obtpVersion`). A
  client-side conversion carries `orderValue` / `currency` / `orderId`.
- No hashed PII or consent signal rode the captured hits (Outbrain offers hashed
  matching in some setups; if it appears it is surfaced, never guessed).

Awin (affiliate):
- The MasterTag (`www.dwin1.com/<MID>.js`, MID = advertiser/merchant id) fires to
  `www.awin1.com`. The **sale** (`sread.img` / `sread.php` / `sread.js`) fans out across
  transports + whitelabel mirror domains, all sharing `(merchant, orderRef)` — folded
  into a **single card**. Two parameter namings are handled: long (`merchant` / `amount`
  / `ref` / `parts` / `testmode`) and short (`a` / `b` / `c` / `d` / `t`).
- Reads the amount / currency, order reference, channel (`ch`), voucher, test flag, and
  the commission split `parts` (`group:amount`, `|`-separated, e.g. `01:22|02:12,50`).
- **Product-level tracking** (`basket.php`, `product_line`) is decoded into a product
  table (id / name / price / qty / sku / commission group / category), with a derived
  basket total. The affiliate landing tag (`alt.php`) and empty template beacons are
  handled too. No hashed PII rides these requests. The MasterTag loader is ignored.

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

**PII / user data.** Every card's detail carries one uniform **PII / user data**
block across all services: each user-data field is shown as its raw parameter, a
plain-language category (e.g. `u_hem` → Email), and the detected hash form (SHA-256 /
SHA-1 / MD5). A terse note appears only when the form contradicts the algorithm the
service requires; cleartext (e.g. HubSpot) is stated plainly as "not hashed". Reading
only — no hash validation.

**One hit, one card.** Many services fan a single user action out across several
mirrored requests — Google Ads across its conversion / remarketing / measurement
endpoints, Floodlight's `activity` + `activityi`, LinkedIn's `/collect` + `px4` mirror,
Awin's sale across `sread.img`/`php`/`js` plus whitelabel domains. Rather than list each
as its own row, the panel **folds every mirror of one logical hit into a single card**
(marked `×N transports`), anchored on a stable key (the conversion id, order reference,
`src`/`type`/`cat`/`ord`, …). The stream shows *what happened*, not how many times the
browser phoned home for it — this consolidation is a core idea of the extension.

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

### 1.0.0
First public release. Fifteen providers covered — GA4, Google Ads, Floodlight, Meta, Bing UET, TikTok, Pinterest, LinkedIn, Reddit, Snapchat, HubSpot, Criteo, Taboola, Outbrain and Awin — with custom-loader / base64 / first-party transport decoding, service-worker Deep Capture, the cross-provider PII / user-data block, and transport fan-out folded into one card per logical hit.
- **Color-code cards toggle** (Advanced, on by default): the per-provider card tints are a quick scan aid, but at full build a mixed stream turns busy. Turn the toggle off to give every card the neutral background — the provider pills still carry the color — which reads steadier when you compare more than a few services. Persisted per install.
- **Robustness hardening**: each parser now runs isolated, so a malformed / adversarial payload can no longer throw and drop the hit (or abort a capture import); Bing UET names a hit by its `evt` (e.g. `pageHide`) instead of a generic "custom event"; Deep Capture no longer leaks a service-worker hit from one inspected tab into another's capture.
- **Awin** (affiliate): detects the Awin MasterTag's tracking (`www.awin1.com`; loader `www.dwin1.com/<MID>.js` = advertiser id). The **sale** (`sread.img`/`sread.php`/`sread.js`) fans out across transports and whitelabel mirror domains sharing `(merchant, orderRef)` → folded into one card; both the long (`merchant`/`amount`/`ref`/`parts`/`testmode`) and short (`a`/`b`/`c`/`d`/`t`) parameter namings are handled. Reads amount / currency / order reference / channel / voucher / test flag and the commission split `parts` (`group:amount`, `|`-separated). **Product-level tracking** (`basket.php` `product_line`) is decoded into a product table (id/name/price/qty/sku/commission group/category) with a derived basket total; the `alt.php` landing tag and empty template beacons are handled. No hashed PII. Off by default. Violet pill.
- **Outbrain** (native ads): detects the `obApi` conversion pixel `GET tr.outbrain.com/unifiedPixel` (loader `amplify.outbrain.com/cp/obtp.js`; the `wave`/`my`/`sync` hosts are ignored). Account = `marketerId`. Reads the event `name` — `PAGE_VIEW` (automatic) plus other events classified as standard (Purchase / AddToCart / Lead / ViewContent / …) or custom advertiser names, verbatim — page (`dl`) / referrer / previous page (`pRef`), channel (`cht`), region (`zone`) and API / pixel build; an event fired client-side with a value carries `orderValue` / `currency` / `orderId`. No hashed PII / consent on the captured hits. Built against real posterlounge captures (PAGE_VIEW native, conversions fired via `obApi('track', …)`). Sits next to Taboola as the native-ads pair. Rose pill.
- **Taboola** (native ads): detects the `trc.taboola.com` pixel — the page view `GET /<account>/trc/3/json?data=<JSON>` (event inside the URL-encoded `data` JSON at `data.mpvd.en`) and the events `GET /<account>/log/3/<action>?en=<event>` (view_content / add_to_cart / start_checkout / make_purchase / lead / complete_registration / …, custom names verbatim), with a conversion's flat `revenue` / `currency` / `orderid` / `quantity`. Surfaces the user id (`ui`), page / referrer and consent verbatim (TCF `tcs` shown-not-decoded, US-privacy `ccpaPs`, CMP `cbp`). Cookie/id based; Taboola's hashed-email identity (AudienceMatch `unified_id`, SHA-256 of the email) rides as a flat `unified_id` query param and is surfaced as a hashed Email in the PII block; the `pre_d_eng_tb` engagement ping is flagged as telemetry. The loader / id-sync / p3p are ignored. Deep-cyan pill.
- **Floodlight** (Google Marketing Platform — CM360 / DV360): detects Floodlight activity fires — the counter `ad.doubleclick.net/activity` and its image mirror `<src>.fls.doubleclick.net/activityi`, which carry **matrix parameters** (`;`-delimited in the path, not a query string) and share `(src,type,cat,ord)`, so the two are folded into a **single card**. Reads the Floodlight config id (`src`), the advertiser-defined activity group (`type`) and tag (`cat`) verbatim, the ordinal (`ord`), tells a **counter** from a **sales** activity (`cost`/`qty` → revenue), the custom variables (`u1..uN`), the `~oref` page url, the DoubleClick id (`auiddc`) and `gcs`/`gcd`/`dma`/`npa`/`gpp` consent. Custom vars are opaque, so only an unmistakable cleartext email in a `u*` is flagged as PII (hash-shaped ids are left alone). Positioned right after Google Ads (same DoubleClick infrastructure). Mint-green pill.
- **Criteo** (OneTag): detects the `sslwidget.criteo.com/event` beacon (account = `a`; the `gum.`/`dynamic.` identity-sync & loader requests are ignored). Decodes the `p0..pN` event slots (technical `exd`/`dis` plus the real event — `vh`/`vl`/`vp`/`vb`/`ac`/`vc`/`trackleads`/…, unknown codes kept verbatim), the double-encoded item array (`id`/`price`/`quantity`), the category, the transaction id, and a **computed** revenue total (Σ price × quantity — Criteo sends no total) with the `c` currency. **`setEmail` (`ce`) ships the email in CLEARTEXT** — surfaced as a "cleartext email" indicator and reported in the PII block as "not hashed"; the shared cross-vendor cookies (`sc`, e.g. `fbp`) and `cs`/`gpp` consent are surfaced too. Criteo-blue card tint.
- **taggrs Custom Loader decryption**: taggrs (a Stape alternative) proxies GTM/gtag through a first-party sGTM host and encrypts the real request, so the network tab shows only an opaque envelope (a `{"m","u"}` POST, or `?p=<iv>:<ct>`). The cipher is AES-256-GCM with the key hardcoded in the loader JS, so the panel sniffs that key once per host from the loader body (read via the DevTools response body — no new permission), decrypts the envelope in-session, and runs the plaintext through the normal parser registry. The hidden hit then shows up as an ordinary GA4/… card marked with a **taggrs** transport pill (the same slot as Stape b64); its detail shows the decrypted request alongside the encrypted original (proxy endpoint + the `iv:ct` cipher blobs). Hits that race ahead of the loader key are buffered and flushed once it lands. POST envelopes only — the `?p=` GET transport carries proxied scripts, not hits.
- **First-party is positively confirmed, never inferred**: previously any hit whose host wasn't on a provider's vendor allowlist was labelled "first-party" by elimination — which mislabelled `pagead2.googlesyndication.com` (a Google host that was missing from the Ads list) and any GA4 / Meta / UET hit routed through a foreign sGTM vendor domain. A hit is now first-party only when its host shares the **inspected page's** registrable domain (eTLD+1, compared against the real page URL — not the hit's own `dl`, which it can set to anything). Otherwise the transport is "unknown" and wears no pill, because an unconfirmed transport shouldn't claim one — tracking behaves differently tomorrow than today. `googlesyndication.com` is now recognised as a Google Ads host.

### 0.9.0
- **HubSpot** (10th provider): detects HubSpot's tracking surfaces — the `track(-<region>).hubspot.com` beacons `/__ptq.gif` (page view), `/__ptbe.gif` (custom behavioral event, name in `n`, properties as `_<name>`) and `/__ptc.gif` (click / interaction, target described by `_hs_*`), plus the **Collected Forms** submit `POST` to `forms(-<region>).hscollectedforms.net/collected-forms/submit/form`. The account is the hub id (`a` / `portalId`). Identity data travels in **cleartext** (HubSpot does not hash) — via the doubly URL-encoded `i` param on any beacon, or as `contactFields` (email / name / phone) in the form submit — so the PII block reports it honestly as "not hashed", and the form's submitted `formValues` are shown verbatim. Loader/config/analytics scripts and form counters are not tracking hits and are ignored. Coral pill.
- **PII / user-data block**: every request detail now carries one uniform "PII / user data" section across all providers. Each user-data field is shown as raw parameter · plain-language category (e.g. `u_hem` → Email, `l_city` → City) · detected hash form (SHA-256 / SHA-1 / MD5, base64url SHA-256 recognised). A terse inline note appears only when the detected form contradicts the algorithm the provider requires (e.g. an MD5-shaped value where SHA-256 is mandated); plaintext is stated plainly, without a leak alarm. Reads only — no plaintext comparison, no normalization, no hash validation.
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