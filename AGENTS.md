# Tracking Auditor — Agent Guide

Chrome **DevTools** extension. Adds a "Tracking Auditor" panel that records the
inspected tab's outbound analytics/advertising requests, grouped in blocks per
page navigation. A focused gap-filler for transports that common debuggers miss —
not a replacement for David Vallejo's Analytics Debugger.

## Scope (important)

**Detect requests, read parameters.** NO hash validation, NO enhanced-match
decoder, NO compliance checks. Surfacing a provider's *own* payload diagnostics
verbatim (e.g. TikTok's `signal_diagnostic_labels`) is *reading*, not validating —
that is in scope. Recomputing or verifying hashes is out of scope.

## Architecture

- Capture via `chrome.devtools.network.onRequestFinished` (HAR) → **no
  host_permissions**; the manifest is essentially just `devtools_page`.
- All logic runs in the panel. Detection/parsing per provider lives in
  `lib/<provider>.js` as **pure functions** (no DOM, no chrome APIs) so they run
  both in the panel and under `node --test`.
- Shared HTTP-param extraction in `lib/params.js`
  (`extractParams(url, postData)` → `{ queryParams, bodyParams, bodyJson }`).
- Each parser returns a normalized record or `null`. Common fields the panel
  relies on: `provider`, `transport`, `host`, `pathname`, `effectiveUrl`,
  `method`, an event-name field, an account id, `identifiers`
  `{ email, phone, name, address }`, `flags`, `userData`, `consent`,
  `queryParams`, `bodyParams`. The panel reads these via provider-agnostic
  accessors plus per-provider render branches.

## Adding a provider (the recipe)

1. `lib/<x>.js`: pure detect + parse; export the parser **and** the testable
   helpers.
2. `tests/<x>.test.js`: build against **real captured requests**. Helper
   extensions / vendor docs are a guide, **not ground truth** — the TikTok helper
   mis-stated both the path (`/act` only) and the identifier location; real hits
   go to `/api/v2/pixel` with identifiers under `context.user`.
3. `panel.js`: import it, add to `PARSERS`, add to `state.record` / `state.filter`,
   add branches in `eventName` / `accountId` / `accountTitle` / `docLocation` /
   `providerPills` / `flagPills` / `consentPills` / `summaryPills` / `detailHtml`.
4. `panel.html`: a Record + a Show checkbox, a `.pill-<x>` colour, a `.ev.p-<x>`
   card tint.

## Providers (status)

GA4 · Meta Pixel · Bing UET · **TikTok Pixel** · **Pinterest Tag** ·
**Google Ads** — 65 unit tests green. Detection/decode for GA4 (Stape base64,
custom path) was ported from the sibling EC-Validator. All providers complete.
See `README.md` and `docs/2026-06-29-reference-tiktok-pinterest.md`.

Google Ads (`lib/googleads.js`) is the one provider that **collapses** transport
fan-out: one user action fans out across many mirrored endpoints
(`pagead/conversion` + `ccm/conversion` + server `viewthroughconversion` →
`1p-conversion` ×.com/.de; remarketing across `viewthroughconversion` +
`rmkt/collect` + `1p-user-list`). The parser tags each record with a
`_collapseKey` (rooted on the `AW-<convId>` anchor) + `_transportRank`; the panel
folds every mirror of one logical signal into a single card (`×N transports`),
keeping the richest mirror's payload. Built against a real 40-hit HAR capture.

## Commands

- `npm test` — `node --test` over `tests/*.test.js`.
- `npm run build` — packs the runtime files into `dist/tracking-auditor-<ver>.zip`
  (dependency-free, see `scripts/package-extension.js`). Manual load:
  `chrome://extensions` → Developer mode → Load unpacked → this folder.
- `npm run screenshots` — regenerates the Chrome Web Store assets into `webstore/`
  (git-ignored): a static server hosts `panel.html`, Playwright stubs the `chrome`
  API and replays the synthetic demo capture (`scripts/fixtures-demo.js`) through
  the real `onRequest` pipeline, then shoots store screenshots (1280×800, light +
  dark) and promo tiles (440×280, 1400×560). Needs `npm install` +
  `npx playwright install chromium` once.

## Conventions

- Match the existing code style: English comments, with dense rationale comments
  explaining *why* a branch exists (see `lib/meta.js`, `lib/tiktok.js`).
- Keep `lib/` pure — never import DOM or chrome APIs there.
- Commit granularly (per provider/phase). Working autonomously (user away):
  commit **without** GPG via `--no-gpg-sign` (this repo has `commit.gpgsign`
  locally false). User present: normal signed commits. Commit/push only when asked.
- Well-scoped, clearly-bounded changes: implement directly, no heavy spec/plan
  ceremony.

## Known issues / next TODOs

- **Google Ads first-party / sGTM** detection is wired (path on a non-Google host
  → `transport: first-party`) but **untested** — no real fixture yet. Verify
  against a captured sGTM Ads hit.
- `*.har` / `tag-assistant-*.json` are git-ignored: capture sources, never
  committed. The relevant hits live baked into `tests/googleads.test.js`.
- The Pinterest double-logging seen earlier was **not** a 307 redirect — it was
  the Pinterest Tag Helper extension appending a `dbgppce=true` debug hit. No code
  fix needed; resolved by disabling the helper.

## Sibling project

This repo grew inside the `ec-data-validator` working directory but is a
**separate** project with its own git repo and its own memory. Don't conflate the
two — keep notes, status and history attributed to the right one.
