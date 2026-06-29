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

1. **standard** — host is `bat.bing.com` (or `*.bing.com`) and path is `/action`
   or `/actionp` (with a `ti`)
2. **first-party** — any host, path `/action…`, numeric `ti` + `evt` (proxied on
   the site's own domain)

## Friendly event name

`pageLoad` stays as-is; a custom event takes its **action** (`ea`), falling back
to category (`ec`) — e.g. `conversions`, `purchase`.

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

## Open question

`asc` = G/D is confirmed by the user; the exact meaning of `cdb` is surfaced raw
but not yet decoded. A denied-consent example would confirm the `asc=D` path end
to end.

## Verification

7 unit tests in `tests/uet.test.js` against three real captured hits (pageLoad
with enhanced conversions, a custom conversion with revenue, an e-commerce event).
