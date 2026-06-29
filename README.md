# Tracking Auditor Extension

A lightweight Chrome **DevTools** extension that records GA4 **and Meta** requests
of the inspected tab — including transports that common debuggers miss:

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

It adds a **"Tracking Auditor"** tab to DevTools. Hit **Record** and reload the
page: every hit is listed in blocks per navigation, in order, with event name,
parameters, a user-data summary and the consent state decoded. A collapsible
**Record** settings row switches services on/off (capture), and an independent
**Show** filter row (service checkboxes + fulltext) narrows the displayed log.

The goal is narrow: **detect requests, read parameters.** No hash validation, no
EM decoder, no compliance checks. A focused gap-filler — not a replacement for
David Vallejo's excellent Analytics Debugger.

Roadmap:
- **Step 1 (done):** GA4 across all transports.
- **Step 2 (done):** Meta/Facebook requests. Motivation: Meta's own extension is
  now login-gated — this fills that gap.
- **Step 3 (next):** Bing / Microsoft UET (the official UET Helper is poor).

## Architecture

Captures via `chrome.devtools.network.onRequestFinished` (HAR), so it needs **no**
host permissions — the manifest is essentially just `devtools_page`. All logic
runs in the panel; detection/parsing lives in `lib/ga4.js` and `lib/meta.js`
(pure functions, unit-tested), with shared HTTP-param extraction in
`lib/params.js`.

See [docs/2026-06-29-design-step1.md](docs/2026-06-29-design-step1.md) for the full design.

## Develop

```
# Load unpacked: chrome://extensions → Developer mode → Load unpacked → this folder
npm test     # unit tests for lib/ga4.js
npm run build  # → tracking-auditor-extension-v<version>.zip
```
