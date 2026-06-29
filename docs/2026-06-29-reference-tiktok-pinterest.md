# Reference: TikTok & Pinterest request structure (for future provider modules)

Compiled 2026-06-29 from a source review of the official helper extensions
(TikTok Pixel Helper 3.0.4, Pinterest Tag Helper 0.1.19). This is the map for
building `lib/tiktok.js` / `lib/pinterest.js` later — but, as with Meta/UET, we
should still build against **real captured requests** to verify, since helper
code is a guide, not ground truth. No example requests captured yet.

## TikTok

**Endpoint:** `analytics.tiktok.com/api/v2/pixel/act` (web) and
`/api/v2/shopify_pixel/act` (Shopify). Sub-paths `/inter` and `/perf` are
heartbeat/telemetry — ignore them.

**Transport:** POST with a JSON body, OR GET with `?analytics_message=<base64 JSON>`
(decode base64 → JSON). Same payload either way. (A base64-in-querystring case,
like Stape for GA4 — our decode pattern applies.)

**Payload (JSON):**
- `event` — event name
- `message_id` — dedup / event id (CAPI dedup)
- `context.pixel.code` — pixel id (single); `context.pixel.codes` — pipe-separated
  ids in an `/act` batch (clone the event per id)
- `properties` — `value`, `currency`, `content_id` | `content_ids` | `contents[].content_id`,
  `content_type`, `query`, `is_standard_mode`
- `_inspection.identity_params` — advanced-matching status flags: `email_is_hashed`,
  `sha256_email`, `phone_is_hashed`, `sha256_phone` (TikTok hashes SHA-256
  client-side; live hashes sit under `context`)
- `partner` — set for partner integrations (Shopify)

**E-commerce events** (helper-hardcoded, trigger content_id/value/currency checks):
CompletePayment, InitiateCheckout, AddToCart, PlaceAnOrder, ViewContent, AddToWishlist.
Other standard events (Search, Contact, Subscribe, SubmitForm, AddPaymentInfo,
CompleteRegistration, ClickButton, Download) are not hardcoded — keep our own list.
Internal `EnrichAM` events are filtered out.

**Loader (not an event):** `analytics.tiktok.com/i18n/pixel/sdk.js` (pixel id in
`?sdkid=`). Consent/LDU: none surfaced by the helper in 3.0.4.

## Pinterest

**Endpoint:** `ct.pinterest.com/v3/`.

**Transport (GET, two variants):**
- JS-tag: `ad=%7B…` present; event data is a JSON string in `ed=`, enhanced match a
  URL-encoded JSON object in `pd=`.
- IMG/noscript tag: `noscript=1`; data as bracket params (`ed[value]=…`,
  `ed[line_items][0][product_id]=…`, `pd[em]=<hash>`).
- POST exists for large payloads; the official helper does NOT parse POST bodies
  (only tid/event) — we could do better.

**Fields:**
- `tid` — Pinterest tag id (13 digits, usually starts `26`)
- `event` — event name (missing → "base code page load")
- `ed` — event data: `value`, `currency`, `order_id`, `order_quantity`, `product_id`,
  `promo_code`, `search_query`, `video_title`, `lead_type`, `event_id` (dedup),
  and `line_items[i][...]` (product_id/name/price/category/variant/quantity/brand)
- `pd` — enhanced match. Helper only reads `em` (hashed email; accepts SHA-256/SHA-1/
  MD5), but the real `pd` object can carry more (phone etc.) — helper is incomplete here.

**Standard events:** pagevisit, signup, checkout, custom, addtocart, lead, search,
viewcategory, watchvideo, init, "base code page load". The helper also maps aliases
(pageview/viewcontent/purchase/buy/pay/completeregistration/…) to canonical CAPI
names (page_visit, add_to_cart, view_category, watch_video, checkout, signup,
search, lead, custom) — worth replicating.

**Consent:** `dbgppce` is the helper's own debug flag (ignore). `ppce` is a
Pinterest consent/privacy signal returned in a **response header** (not the
request) — only reachable if we read response headers, which the HAR `onRequestFinished`
entry does expose. Open question for when we build it.

## Build note

Both modules slot into the same shape: `lib/<x>.js` (pure functions, unit tests
against real fixtures) + an entry in the panel `PARSERS` array + render branches +
a provider pill/tint + record/show checkbox. Capture real requests first.
