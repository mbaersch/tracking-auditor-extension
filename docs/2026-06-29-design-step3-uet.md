# Tracking Auditor — Design (Step 3: Bing / Microsoft UET)

Status: implemented 2026-06-29. Adds Bing UET detection alongside GA4 and Meta in
the same panel. Logic lives in `lib/uet.js` (pure functions, unit-tested).

## What a UET hit looks like

Endpoint `https://bat.bing.com/action/0` (or `/actionp/0`), a GET beacon.
`evt` distinguishes the event type: `pageLoad` vs. `custom` (conversions,
e-commerce).

Key params:
- `ti` — UET tag id · the analogue of GA4 `tid` / Meta `id`
- `evt` — event type (`pageLoad`, `custom`, …)
- `tm` — tag manager source (e.g. `gtm002`), `mid` — message id, `Ver` — version
- `ec` / `ea` / `el` / `ev` — event category / action / label / value
- `gv` / `gc` — goal value (revenue) / currency
- `prodid` / `pagetype` / `ecomm_totalvalue` / `ecomm_category` — e-commerce
- `p` — page url (UET uses `p`, **not** `dl`), `r` — referrer
- `pid` — **enhanced-conversion user data** as a nested querystring:
  `em=<sha256>&ph=<sha256>` (hashed; no masks, unlike Meta)
- `asc` — **Microsoft Consent Mode** ad_storage signal: `G` = granted, `D` = denied.
  Its **absence** is meaningful, so we always report a state and show `unset`.
- `cdb` — consent debug string (surfaced raw in the detail)

## Detection (`parseUetRequest`)

1. **standard** — host is `bat.bing.com` / `commerce.bing.com` (or `*.bing.com`)
   and path is `/action`, `/actionp` or `/cst` (with a `ti`). `commerce.bing.com/cst`
   is the CST/Flex-tag endpoint (learned from the official helper).
2. **first-party** — any host, path `/action…` / `/cst`, numeric `ti` + `evt`
   (proxied on the site's own domain)

## Friendly event name

- `pageLoad` → `pageLoad`
- `evt=consent` → **`consent default` / `consent update`** (from `src`) — these are
  consent signals (Microsoft Consent Mode), fire repeatedly and carry no ec/ea, so
  they must NOT be shown as custom events.
- custom → **`category – action`** (`ec – ea`; label stays in the detail)
- no `evt` → `beacon`

## UI

UET hits render in the shared per-navigation stream with a teal **Bing** provider
pill and tint.
- Pills: provider, `first-party` (if proxied), `custom event`, `ecommerce`,
  `revenue: <value> <currency>`, and an always-visible consent pill
  (`ad: granted` / `ad: denied` / `consent: unset`).
- Summary: `1× email · 1× phone …` + an `enhanced conv.` marker.
- Detail: event type/tag id, transport, tag manager, message id, the event
  ec/ea/el/ev, revenue, e-commerce fields, consent (asc/cdb), and the hashed
  enhanced-conversion identifiers.

## vs. the official UET Tag Helper (0.6.15, source reviewed 2026-06-29)

What we took from it: the second endpoint `commerce.bing.com/cst`; the evt model
(missing = beacon, pageLoad, else custom); `asc` = G/D; the short→new-syntax param
aliases (`ecomm_prodid`/`ecomm_pagetype`, `currency`); the `ifm` (iframe) / `spa`
markers.

Where we are already ahead: the helper does **not** decode `cdb`, has **no**
concept of `pid` enhanced-conversion user data, and doesn't surface `bo`/`vid`/
`vids`/`uach`/`tpp`. Its large validation/warning engine (revenue/currency/hotel/
travel rules, multi-tag checks) is deliberately **out of scope** — we read and
display, we don't validate. Travel/hotel/flight/`items[]` params still appear in
the raw Query-parameters table, just without friendly labels.

## Open question

`asc` = G/D/absent(unset) is confirmed; `cdb` (e.g. `AQAS`) is surfaced raw — the
official helper doesn't decode it either, so its meaning stays open. A denied-
consent example would confirm the `asc=D` path end to end.

## Verification

10 unit tests in `tests/uet.test.js` against real captured hits (pageLoad with
enhanced conversions, custom conversion with revenue, e-commerce, a consent
signal) plus CST-endpoint, beacon and ecomm-alias cases.
