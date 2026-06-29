# Tracking Auditor — Design (Step 2: Meta/Facebook)

Status: implemented 2026-06-29. Adds Meta Pixel detection alongside GA4 in the
same panel. Built on the Step-1 shell; logic lives in `lib/meta.js` (pure
functions, unit-tested), param extraction shared via `lib/params.js`.

## What a Meta browser hit looks like

Endpoint `https://www.facebook.com/tr/` — a GET beacon, or a **form POST**
(`rqm=formPOST`) carrying the params in the body. The loader
`connect.facebook.net/.../fbevents.js` is **not** an event and is ignored.

Key params:
- `id` — pixel id (numeric) · the analogue of GA4 `tid`
- `ev` — event name · analogue of GA4 `en`. Standard events (PageView, ViewContent,
  AddToCart, Purchase, Lead, CompleteRegistration, …) vs. custom events.
- `dl` / `rl` / `ts` / `v` — page url, referrer, timestamp, pixel version
- `eid` — event id for **CAPI deduplication** (a useful marker)
- `cd[...]` — custom data (`cd[value]`, `cd[currency]`, `cd[content_ids]`, …)
- `ud[...]` (and `udff[...]`) — **advanced matching**, SHA-256 hashed: `em`, `ph`,
  `fn`, `ln`, `ct`, `st` (state, **not** street), `zp`, `country`, `db`, `ge`, `external_id`
- `a` — sending library, e.g. `stape-gtm-1.2.0-pb`
- `dpo` / `dpoco` / `dpost` — Limited Data Use (Meta's consent signal; no gcs/gcd)

### user_data arrives in four parallel representations

For each field, e.g. email, a real hit (captured on the playground) carries:
- `ud[em]` = SHA-256 hash (the actual advanced-matching payload)
- `aud[em]` = SHA-256 hash (automatic / additional advanced matching)
- `cud[em]` = **masked** raw value, e.g. `****@****.**` (`#` = digit, `*` = letter)
- `ncud[em]` = masked normalized value

We key by the inner field, so a field counts **once** regardless of
representation. The mask is kept for an honest, PII-free detail view
(`Email — ****@****.** · hashed`).

## Detection (`parseMetaRequest`)

1. **standard** — host ends in `facebook.com` and path is `/tr` (with an `id`)
2. **first-party** — any host, path `/tr`, numeric `id` + `ev` (proxied /tr on the
   site's own domain to dodge ad blockers)

No Stape-base64 case: Meta's disguised transport runs **server-side** via CAPI and
is invisible in the browser (unlike GA4/Stape).

## UI

Meta hits render in the same per-navigation block stream as GA4, distinguished by
a blue **Meta** provider pill and a cool-blue card tint (GA4 = warm tint).
- Pills: provider, `first-party` (if proxied), `custom event`, `dedup` (eid),
  `cd ×N`, `LDU`.
- Summary: `1× email · 1× phone · …` + an `adv. matching` marker.
- Detail: event/pixel id, transport, source lib (`a`), event id, LDU consent,
  advanced-matching table (mask + hashed marker), custom data, query/body params.

## Capture vs. display (this step also added these, provider-generic)

- **Record settings** (collapsible, the "in" side): per-service capture switches
  (GA4 / Meta), default all on.
- **Show filter** (the "out" side, independent): per-service checkboxes + a
  fulltext filter. Hides cards without dropping captured data.

## Verification

11 unit tests in `tests/meta.test.js`, incl. a real captured Lead with all four
user_data representations. UI acceptance is manual (DevTools panels).
