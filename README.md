# Tracking Auditor Extension

A lightweight Chrome **DevTools** extension that records GA4 requests of the
inspected tab — including transports that common debuggers miss:

- Standard GA4 (`google-analytics.com` / `analytics.google.com`, `/g/collect`)
- First-party sGTM / Google Tag Gateway (`/g/collect` / `/collect` with `v=2` & `tid=G-…`)
- **Stape Custom Loader** (GA4 path base64-encoded inside a query parameter)
- **Plaintext custom delivery paths** (cryptic path without `collect`, but `v=2` & `tid=G-…` & `en`)

It adds a **"Tracking Auditor"** tab to DevTools. Hit **Record** and reload the
page: every GA4 hit is listed in blocks per navigation, in order, with event
name, parameters, a `user_data` summary and the consent state decoded.

The goal is narrow: **detect requests, read parameters.** No hash validation, no
EM decoder, no compliance checks. A focused gap-filler — not a replacement for
David Vallejo's excellent Analytics Debugger.

Step 2 (planned): Meta/Facebook detection.

## Architecture

Captures via `chrome.devtools.network.onRequestFinished` (HAR), so it needs **no**
host permissions — the manifest is essentially just `devtools_page`. All logic
runs in the panel; detection/parsing lives in `lib/ga4.js` (unit-tested).

See [docs/2026-06-29-design-step1.md](docs/2026-06-29-design-step1.md) for the full design.

## Develop

```
# Load unpacked: chrome://extensions → Developer mode → Load unpacked → this folder
npm test     # unit tests for lib/ga4.js
npm run build  # → tracking-auditor-extension-v<version>.zip
```
