# Tracking Auditor Extension

A lightweight Chrome **DevTools** extension that records GA4, **Meta**, **Bing**,
**TikTok**, **Pinterest**, **Google Ads** and **LinkedIn** requests of the inspected
tab — including transports that common debuggers miss:

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
  `e_ipv6` IP hash. The `/attribution_trigger` (redundant) and `/wa/` (gzip web-analytics
  POST) endpoints are ignored — the collect beacon carries the signal worth reading.

It adds a **"Tracking Auditor"** tab to DevTools. Hit **Start & Reload** — the
page reloads and every hit is listed in blocks per navigation, in order, with event
name, parameters, a user-data summary and (where present) the consent state decoded.
A collapsible
**Record** settings row switches services on/off (capture), and an independent
**Show** filter row (service checkboxes + fulltext) narrows the displayed log —
with **all / none** shortcuts to focus on a single service quickly and a **⤓ follow**
toggle that keeps the newest hits in view while recording.

The goal is narrow: **detect requests, read parameters.** No hash validation, no
EM decoder, no compliance checks. A focused gap-filler — not a replacement for
David Vallejo's excellent Analytics Debugger.

## Install

```
# Load unpacked: chrome://extensions → Developer mode → Load unpacked → this folder
```
