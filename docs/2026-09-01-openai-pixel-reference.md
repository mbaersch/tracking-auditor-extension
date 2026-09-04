# OpenAI ads pixel (`oaiq`) — raw material

Everything worked out while building the Tracking Auditor provider on 2026-09-01.
Raw notes, not prose: facts, wire formats, and the things that only became clear
by reading the SDK or by watching real requests.

**Provenance matters here — every claim is tagged:**

| Tag | Means |
|---|---|
| **[SDK]** | Read out of `oaiq.min.js` v0.1.32. Authoritative for behaviour, but it is minified: names are inferred from context. |
| **[LIVE]** | Observed in a real request against a real pixel id. The strongest evidence. |
| **[DOC]** | From developers.openai.com/ads/measurement-pixel only. **Not verified here** — treat as a claim, not a fact. |

Pixel used for the captures: `S6i2zvvbTXxj5gR64Szf6a`, driven from
`test-pages/openai-pixel.html` (in this repo, `npm run testpage`).

---

## 1. The single most useful fact

**The SDK is readable and states its own wire format.** [SDK]

```
curl https://bzrcdn.openai.com/sdk/oaiq.min.js     # ~79 KB, v0.1.32
```

It is minified but not obfuscated: endpoint constants, query-parameter names,
the abbreviated `user` keys, the event→shape map, the validation regexes and the
flush rules are all plain string literals. Two behaviours that shape any debugger
(see §6 and §7) are *invisible* from the outside and *obvious* in the source.

This beat both the documentation and the two community pixel helpers. Worth
generalising: for a new pixel, read the vendor's own JS before trusting anything
else.

**Community helpers, for the record** (neither is by OpenAI):
- `OpenAI Pixel Helper` v1.0.0 — hooks the `oaiq` queue in the MAIN world and
  reads the *arguments of the API calls*, not the wire. Its README names the
  wrong endpoint path (`/v1/events`). A textbook case of a helper being a guide,
  not ground truth.
- `OpenAI Ads Pixel Helper ChatGPT` v1.0.2 — reads the real payload via
  `webRequest`, path and `oppref` correct. Does not interpret the `user` block
  or the diagnostics.

---

## 2. Endpoints and loading

| Purpose | URL | Notes |
|---|---|---|
| SDK | `https://bzrcdn.openai.com/sdk/oaiq.min.js` | [LIVE] |
| Per-pixel config | `GET https://bzrcdn.openai.com/pixel-config/v1/<pixelId>.json` | [LIVE] |
| Events | `POST https://bzr.openai.com/v1/sdk/events` | [SDK][LIVE] |

**Load sequence observed** [LIVE]: SDK → config fetch → first events POST.

**The config fetch is an anchor**: "a pixel exists on this page", the same role
Meta's `signals/config` plays. It carries the pixel id in the path, so it
identifies *which* pixel. **It does not happen at all when consent is denied** —
its absence is itself a signal.

The account's Automatic Advanced Matching setting arrives with that config; the
SDK then reports the outcome back in its diagnostic (§7).

**Installation snippet shape** [SDK]: the global `oaiq` is either an array, or an
object with `.q` or `.queue` — the SDK drains whichever it finds, then replaces
the global with the real implementation carrying `.loaded`, `.version`,
`.__oaiqInitialized`, and direct methods `.init` / `.measure` / `.measureSingle`
/ `.consent`.

**CSP required** [DOC]: `script-src https://bzrcdn.openai.com`,
`connect-src https://bzr.openai.com https://bzrcdn.openai.com`,
`img-src https://bzr.openai.com`.

---

## 3. The API surface

Four commands, and that is the whole surface [SDK] — anything else is silently
ignored by the dispatcher:

```js
oaiq("init", { pixelId, debug, user })      // "initialize" is an accepted alias
oaiq("consent", true|false)                 // non-boolean is ignored, see §6
oaiq("measure", eventName, eventData, options)
oaiq("measureSingle", pixelId, eventName, eventData, options)
```

`measureSingle` is **not documented** [SDK]: it targets one specific initialised
pixel when several are running. Multiple `init` calls with different ids create
separate queues and therefore separate POSTs.

---

## 4. Events

### Ten standard events [DOC][SDK — the SDK's own map confirms all ten]

| Group | Events |
|---|---|
| Commerce | `order_created`, `items_added`, `checkout_started` |
| Engagement | `page_viewed`, `contents_viewed` |
| Lead gen | `lead_created`, `registration_completed`, `appointment_scheduled` |
| Subscription | `subscription_created`, `trial_started` |

Plus `custom`. Plus, server-side only [DOC]: `app_installed`, `app_opened`.

### Two internal event types that ride the same transport [LIVE]

- `openai::sdk_init` — `data.type: "sdk_lifecycle"`, sent once on load
- `oai::diagnostic` — the SDK's own telemetry, see §7

**These are the ones a debugger has to tell apart.** They are not marketing
events, they show up in the same batch as real ones, and one of them is the most
interesting card on the page.

### Event name → data shape [SDK]

| Shape | Events | Allowed fields |
|---|---|---|
| `contents` | page_viewed, contents_viewed, items_added, checkout_started, order_created | `type`, `amount`, `currency`, `contents` |
| `customer_action` | lead_created, registration_completed, appointment_scheduled | `type`, `amount`, `currency` — **no items** |
| `plan_enrollment` | subscription_created, trial_started | `type`, `plan_id`, `amount`, `currency`, `contents` |
| `custom` | custom | `type`, `plan_id`, `amount`, `currency`, `contents` |

Content object fields [SDK]: `id`, `name`, `content_type`, `quantity`, `amount`,
`currency`.

Options object keys [SDK]: `event_id`, `eventId` (**undocumented alias**),
`custom_event_name`, `opt_out`.

### Validation rules [SDK]

- Currency: `/^[A-Za-z]{3}$/`
- Custom event name: `/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/` — **lowercase
  only**, 1–64 chars. The documentation says "letters, numbers, underscores or
  dashes" and does not mention the case restriction.
- Rejected events are dropped *and counted* — see §7.

---

## 5. Wire format

### Request

```
POST https://bzr.openai.com/v1/sdk/events
     ?pid=<pixelId>&st=oaiq-web&sv=0.1.32&t=<epoch ms>&ec=<events in this batch>
Content-Type: text/plain          (not application/json)
```

Sent via `fetch(..., { keepalive: true })`, or `sendBeacon` on page lifecycle
events (`visibilitychange` → hidden, and on consent revocation) [SDK][LIVE].

Query keys [SDK]: `pid` PixelId · `st` SdkType (`oaiq-web`) · `sv` SdkVersion ·
`t` Timestamp · `ec` EventCount.

### Body — consent granted [LIVE]

```json
{
  "obref": "4e5e4050-f8cb-416c-9078-534b39100342",
  "oppref": "oai-test-click-0001",
  "events": [ … ],
  "user": { "in": {…}, "fm": {…}, "js": {…}, "ht": {…} }
}
```

### Body — stripped / credential-less [LIVE]

```json
{ "events": [ … ] }
```

…sent with `credentials: "omit"`, `mode: "no-cors"`, `referrerPolicy: "no-referrer"`.
**No `obref`, no `oppref`, no `user`.** See §6 for why this shape is *not* proof
of a denial.

### Per event [SDK][LIVE]

```json
{
  "type": "order_created",
  "timestamp_ms": 1788253108976,
  "id": "order-1788253108973",
  "source_url": "https://example.com/checkout",
  "referrer_url": "…",
  "opt_out": true,
  "custom_event_name": "newsletter_signup",
  "data": { "type": "contents", "amount": 12497, "currency": "EUR", "contents": [ … ] }
}
```

Three things that trip up a parser:

1. **`options.event_id` REPLACES `id`** — it does not sit beside it. [LIVE]
   A generated v4 UUID means "the site passed no dedup key"; anything else is a
   site-supplied key. (A site could pass a UUID of its own, so this is a
   heuristic, not a proof.)
2. **`amount` is an integer in the currency's smallest unit** — 12497 = 124.97
   EUR, but 12497 whole yen. Blindly dividing by 100 invents a hundredfold error
   on the ~16 zero-decimal ISO-4217 currencies (JPY, KRW, CLP, ISK, VND …).
3. **Batching is the normal case**, so one request ≠ one event.

### Two transport modes on one endpoint [SDK][LIVE]

Investigated after the question came up whether "credential-less" implies a
cookieless operating mode. **It does not — but what it does mean is more
deliberate than a stray fetch option.**

One flag, `omitCredentials` (the same `!w() || events.every(Qe)` from §6),
switches three things at once:

| | normal batch | stripped batch |
|---|---|---|
| Body | `obref`, `oppref`, `user`, `events` | `events` only |
| `credentials` | `"include"` | `"omit"` |
| `referrerPolicy` | default (referrer sent) | `"no-referrer"` |
| `sendBeacon` allowed | yes | **no — deliberately** |

The last row is the tell. In `Cs`: `let d = r && !a.omitCredentials` — a stripped
batch is never sent via `sendBeacon`, because a beacon **cannot suppress
cookies**. It is forced down the `fetch` path instead. Nobody writes that by
accident; the suppression is intended.

Also in `Cs`, on every flush: `V() === false && X()` — the persisted consent is
re-read and the identity wiped if it says no.

**Confirmed [LIVE]:** the normal path sends `Referer: http://localhost:8787/`.
No `Cookie` header appeared on either path in my captures — there simply were no
openai.com cookies to send. `credentials: "include"` means "send them where the
browser allows", which in a modern third-party context is mostly nowhere.

### Identity is first-party, and it is actively destroyed [SDK][LIVE]

The identity does **not** live in a cookie on openai.com. `__obref` / `__oppref`
are first-party cookies on the **publisher's** registrable domain, and they reach
OpenAI **in the request body**, not as cookies.

How the SDK finds that domain [SDK]: `Bo()` walks the hostname from the right,
setting a throwaway `__oaiq_domain_probe=1` cookie (Max-Age 60) at each level
until one sticks, then deletes it. **That probe cookie is an observable artifact
on any page running the pixel** — worth recognising in a debugger.

On denial, `X()` does more than stop sending:

```js
g.consent = false; Ne(false);
g.browserRef = undefined; Mn();   // qn(__obref) — delete, incl. every parent-domain variant
g.clickId = undefined;   Xt();    // delete __oppref
```

and `ft()` (browser-ref creation) is guarded by `if (!w()) return`, so nothing is
re-created while denied.

Measured over one session [LIVE]:

| Step | Identity cookies |
|---|---|
| Fresh load, consent at its default | `__obref=89d161e0-…` |
| After an `order_created` | unchanged |
| After `oaiq("consent", false)` | **`__obref` gone**, only `__oaiq_consent=false` |
| Event while denied | no request at all |
| After reload | still only `__oaiq_consent` |

Note the asymmetry: **denied *before* init** sends one diagnostic (§6), whereas
**revoking after a grant** sent nothing at all in this run — `X()` prunes the
pending queue first.

**So, plainly:** there is no cookieless measurement mode. There is a per-request
identity-suppressing transport, used for traffic that carries no identity anyway,
plus active deletion of the identity on refusal. When the pixel measures, it
measures with a first-party cookie on your domain.

### Cookies and storage [SDK][LIVE]

| Name | Where | Contents | Lifetime |
|---|---|---|---|
| `__obref` | cookie | v4 UUID, the browser ref (`obref` in body) | 30 days (`720*60*60` s) |
| `__oppref` | cookie | ad click id, captured from the `oppref` **URL query parameter** on the landing page | 30 days |
| `__oaiq_consent` | cookie | `"true"` / `"false"` | 30 days |
| `oaiq_consent` | localStorage | `"true"` / `"false"` | until cleared |

---

## 6. Consent — the part with the most surprises

### There is no consent mode [SDK]

`oaiq("consent", x)` accepts **a single boolean and nothing else** — a non-boolean
argument is silently ignored. Grep results across the whole SDK:

- `__tcfapi` / TCF: **0**
- GPP: **0**
- `us_privacy`: **0**
- `globalPrivacyControl` / GPC: **0**
- `doNotTrack`: **0**
- purposes / categories / partial states: **none**

So: no `ad_storage`-style granularity, no CMP integration whatsoever, no
"cookieless pings" fallback like Google Consent Mode v2. **The site has to wire
its CMP to `oaiq('consent', …)` by hand.**

### Default is granted [SDK]

`w() { return g.consent !== false }` — anything but an explicit `false` counts as
allowed. A site that never calls `consent` fires the pixel. **Opt-out semantics.**

Worse for auditing: the diagnostic reports `consent: true` in that case too, so
**"never asked" and "actively granted" are indistinguishable on the wire.**

### The denial is sticky [SDK][LIVE]

Precedence in `V()`: localStorage `oaiq_consent` first — if `false`, done. Then
the `__oaiq_consent` cookie — if `false`, done. Then `true` from either. Else
`null`.

Read **before** `init`. Consequence, and I walked straight into it while testing:
once denied, removing the `?consent=denied` from the URL and reloading changes
nothing. The pixel looks dead with no hint why. Clearing requires removing both
the localStorage key and the cookie.

Cross-tab revocation is handled via a `storage` event listener [SDK].

### What denial actually does [LIVE]

- **No config fetch at all**
- Marketing events are **dropped before the network** — `oaiq("measure",
  "order_created", …)` produces nothing
- Exactly one POST goes out: `{events:[oai::diagnostic]}` with `consent: false`,
  credential-less
- On later loads in the same session: nothing

### The trap: credential-less ≠ denied [SDK]

```js
credentialless = !w() || events.every(Qe)
// Qe(e) = e is oai::diagnostic AND (is_first_visit_in_session || is_first_consent_grant_in_session)
```

A batch consisting **only of session-marker diagnostics** is sent credential-less
**even under granted consent**. So a stripped body alone does not prove a denial.

The honest reading has three states, most reliable first:

1. The diagnostic states `consent` → authoritative
2. Full body (obref/user present) → **not denied** (a denial would have stripped it)
3. Stripped body carrying anything that is *not* a session marker → **denied**
4. Otherwise → **unknown**, and say so

---

## 7. The diagnostic event — free implementation QA

`oai::diagnostic`, `data.type: "diagnostic"` [LIVE]:

```json
{
  "type": "diagnostic", "schema_version": 1,
  "consent": true,
  "is_first_visit_in_session": true,
  "is_first_consent_grant_in_session": true,
  "config": { "automatic_advanced_matching": "enabled" },
  "dropped_event_count": 0,
  "dropped_event_reason_counts": {},
  "dropped_event_name_counts": {},
  "dropped_event_phase_counts": {},
  "dropped_event_details": [ { "reason": …, "code": …, "field": …, "count": … } ]
}
```

**The pixel reports its own broken calls.** Four drop reasons [SDK]:
`unsupported_event_name`, `missing_event_props`, `invalid_event_props`,
`invalid_event_options`.

For a debugging tool this is gold: a misspelled event name or a bad payload is
normally invisible (nothing is sent, so there is nothing to inspect) — here the
pixel tells you, with a reason and a count, in a request that *is* sent.
`schema_version` 2 adds the per-drop `dropped_event_details`.

`config.automatic_advanced_matching` also reveals whether the **account** has AAM
switched on, which is otherwise not visible from the page at all.

---

## 8. User data — the interesting bit

### Nested by ORIGIN, which no other pixel does [SDK][LIVE]

```json
"user": {
  "in": { "em": "<sha256>", "ph": "…", "fn": "…", "ln": "…", "eid": "…",
          "co": "DE", "ct": "Hamburg", "rg": "Hamburg", "pc": "20095" },
  "fm": { "em": ["<sha256>"], "ph": ["<sha256>"], "pc": "10115" },
  "js": { … },
  "ht": { … }
}
```

| Block | Origin |
|---|---|
| `in` | what the site passed to `oaiq("init", { user })` — deliberate |
| `fm` | scraped from **form fields** by automatic advanced matching |
| `js` | scraped from **JS variables** |
| `ht` | scraped from **HTML** |

Wire keys, same in every block: `em` email · `ph` phone · `fn` first name ·
`ln` last name · `eid` external id · `co` country · `ct` city · `rg` region ·
`pc` postal code.

`em`/`ph` arrive as **arrays** in the auto blocks, single values in `in`.

**Why this matters:** you can tell apart "the site chose to send this identifier"
from "the SDK collected it off the page by itself". That is a materially
different statement, both for debugging and for a privacy review, and it is
readable directly from the payload.

### Hashing [SDK][LIVE]

- SHA-256, lowercase hex, 64 chars
- Geo fields (`co`/`ct`/`rg`/`pc`) travel in **cleartext** by design
- **The SDK will hash for you**: if a value handed to `init` is not already a
  64-hex string, it is normalized and hashed in-browser. So "raw PII must never
  be sent" is enforced by the SDK, not just asked of the site.
- `zip_code` is accepted as an alias for `postal_code`
- Normalization [DOC, phone confirmed [LIVE]]: email trim+lowercase · phone strip
  `+`, whitespace, brackets, dots, hyphens, leading zeros → 8–15 digits · names
  lowercase, strip whitespace and ASCII punctuation, keep non-ASCII · external id
  trim only, case preserved

### Automatic advanced matching, observed [LIVE]

- Enabled per **account**, not per page — the config fetch decides it
- Field detection is label/name based [SDK]; the regexes include Japanese and
  Korean labels (`メールアドレス`, `이메일`, `電話番号`, `휴대폰`)
- Only `input`, `select`, `textarea` are considered [SDK]
- **A scraped value whose hash equals one already passed to `init` is dropped**
  as a duplicate [SDK, confirmed [LIVE]] — this is the single most confusing
  thing when testing, because `user.fm` then stays empty and it looks broken.
  A test page needs a *second identity* in the form.
- In my captures the form yielded `em`, `ph` and `pc` — **first and last name
  were not picked up** from a plain labelled form. Unexplained; not investigated.

---

## 9. Batching and delivery [SDK]

- Flush **1 s after the last** event, at the latest **4 s after the first**
- A diagnostics-only batch uses a 4 s idle window instead of 1 s
- `ec` in the query gives the batch size — a cheap cross-check against the parsed
  body
- Retry backoff on failure: 5 s, doubling, capped at 5 min
- Lifecycle flush on `visibilitychange` → hidden, preferring `sendBeacon`

---

## 10. Attribution and server side — [DOC], unverified

- Click-through window: configured in Ads Manager
- View-through: fixed **1 day**, only if enabled for the account, reported
  separately as a campaign metric; does **not** feed Conversions, CPA, post-click
  CVR, bidding or optimisation
- Click-through wins when a conversion qualifies for both
- Conversions API: same `event_id` for deduplication; match key is
  **pixel id + event name + event_id** (custom events use `custom_event_name` in
  place of the event name); **first event received wins**, duplicates ignored
- `app_installed` / `app_opened` are server-side only

---

## 11. Reusable test fixtures

Known plaintext → SHA-256, so the same capture serves both flow tests and hash
validation (shared with the EC Data Validator).

Identity A — passed to `init`:

| Input | SHA-256 |
|---|---|
| `test@example.com` | `973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b` |
| `491701234567` (from `+49 170 1234567`) | `8b47a52ed04d068c3a9c5632b98cec18780a9f9f4099d4f8afe233970ce116fe` |
| `max` | `9baf3a40312f39849f46dad1040f2f039f1cffa1238c41e9db675315cfad39b6` |
| `mustermann` | `e32a370b7912ad78cc6a88fda605a5b3657e9c3b164cee669364aaf3f8cdbb36` |
| `USER-TEST-0001` | `aa5a93cf07de607a273a4afa568503645adb45525e8687add86b7f4b30ea36d2` |

Identity B — put in the AAM form so it is not deduped away:

| Input | SHA-256 |
|---|---|
| `aam@example.com` | `6d91ea2f7e0eea059183972f9d6fe225ee7d4248e4281f1ce5a90e33f25448b6` |
| `491707654321` | `9f7f64353347eba16dbdf59da66e3cdd3f0bf948d5ff64f77a589026f4c0a271` |
| `erika` | `f83c31f2a4558a2223e1f58d52cd7b3c8e6cf42da50dfc455f61b02b454f7bb0` |
| `musterfrau` | `b1ab38b270be987c757b60cf6d5f5f858d231ce12159f5c3dd14dc1500b72312` |

Geo, cleartext: `DE` / `Hamburg` / `Hamburg` / `20095`.

---

## 12. What the sibling projects should take from this

**EC Data Validator** — it validates hashes, so:
- Identifiers to check: `user.in.em|ph|fn|ln|eid` and `user.fm|js|ht.em|ph|…`
  (arrays in the auto blocks)
- Expected algorithm: SHA-256 lowercase hex, no exceptions
- Normalization rules in §8 are what a hash has to be reproduced from
- Geo fields are cleartext **by design** — flag them neutrally, never as a leak
- The `in` vs `fm|js|ht` split is a real distinction worth surfacing: a mismatch
  between a site's own value and the SDK's scraped one means the two disagree
  about who the user is
- The fixtures in §11 are ready-made golden cases

**Tracking editor skill** — to recognise and read these requests:
- Detect: host `bzr.openai.com`, path `/v1/sdk/events`, POST, `text/plain` body
- Split the batch; do not treat one request as one event
- Filter out `openai::sdk_init` / `oai::diagnostic` from event counts, but read
  the diagnostic for consent and dropped-event reasons
- Convert `amount` out of minor units, honouring zero-decimal currencies
- The config fetch `bzrcdn.openai.com/pixel-config/v1/<id>.json` identifies a
  pixel without an event

---

## 13. Suggested outline for the blog post

Working title candidates: *"Das OpenAI-Pixel, von innen"* · *"Was ein Pixel über
sich selbst verrät"* · *"Consent auf einem Boolean"*

1. **Aufhänger** — the OpenAI pixel is showing up in more and more containers,
   and nobody has really looked at it. So let's look.
2. **Die Doku reicht nicht** — she names neither the path nor the payload keys.
   But the SDK is readable, and it tells you everything. The general lesson:
   read the vendor's JS. (With the helper extension as a counterexample: one of
   the two states the wrong path.)
3. **Wie es lädt** — SDK, per-pixel config, first batch. The config fetch as an
   anchor; its absence as a signal.
4. **Was gesendet wird** — the envelope, the event object, batching. The three
   parser traps: `event_id` replaces `id`, minor units, one request ≠ one event.
5. **Consent: ein Boolean, mehr nicht** — the strongest section, because it is
   the most consequential for a German/EU audience. No consent mode, no CMP
   signal, **default granted**, and the wire cannot distinguish "never asked"
   from "consented". Plus: the denial is sticky, and how that makes a pixel look
   dead.
6. **Das Pixel petzt über sich selbst** — the diagnostic event: dropped events
   with reasons, the account's AAM setting. Free implementation QA, and an
   argument for looking at the requests rather than a helper's summary.
7. **Wer hat die Daten eingesammelt?** — `in` vs `fm`/`js`/`ht`. The one genuinely
   novel idea in this pixel, and the privacy-relevant one: the SDK scrapes forms
   by itself when the account has AAM on, and you can read that off the payload.
   Plus the dedupe rule as a nice "why my test looked broken" anecdote.
8. **Fazit / Praxis** — what to check in your own setup: is consent wired at all;
   does the diagnostic report drops; is AAM on and do you know it; does anyone
   pass `user` on purpose.

Anecdotes worth keeping (they carry the piece):
- The persistent denial — the pixel looked dead, the cause was in the one card
  that had been cleared away
- The empty `fm` block, until the test page used a second identity
- The helper with the wrong path in its own README

---

## 14. Open questions / not investigated

- Why `fn`/`ln` were not scraped from a plainly labelled form
- Whether OpenAI ever sets a cookie on `bzr.openai.com` itself — `credentials:
  "include"` implies they might, but none existed in my captures and the
  responses are opaque (`no-cors`), so I could not see a `Set-Cookie`
- Whether revoking consent ever produces a request (it did not here, but the
  pruning in `X()` is conditional and a different queue state might survive)
- Whether the per-pixel config JSON carries anything else worth reading (I only
  ever looked at the AAM flag as reported by the diagnostic — **I never read the
  config response body itself**)
- The Conversions API — never tested, everything in §10 is documentation
- View-through / attribution behaviour — likewise
- `measureSingle` with several pixels on one page — never exercised
- Behaviour under a real ad click (a genuine `oppref` from an OpenAI ad), as
  opposed to a hand-set URL parameter
