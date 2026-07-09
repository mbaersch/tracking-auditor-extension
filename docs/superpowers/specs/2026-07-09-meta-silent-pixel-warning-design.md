# Meta „Silent Pixel" Warning — Design

**Date:** 2026-07-09
**Status:** Approved (ready for implementation plan)
**Area:** `lib/meta.js`, `panel.js`, `tests/meta.test.js`

## Problem

A Meta pixel can be present and initialised on a page yet emit **no tracking
event** (no `PageView`, no conversion). Meta calls this a "traffic permission"
restriction: `fbevents.js` loads, the pixel boots, but `facebook.com/tr/` never
fires. The pixel logs a console warning:

> `[Meta pixel] <id> is unavailable on this website due to it's traffic
> permission settings.`

Today the auditor only recognises `/tr/` event beacons. When no event fires it
shows **nothing for Meta** — the failure is silent. Anyone who checks only "is
something going out on the network" or trusts a firing GTM tag will wrongly
conclude Meta tracking works.

The reliable network anchor for "a pixel exists here" is the pixel's config
fetch:

```
connect.facebook.net/signals/config/549591473162841
  ?v=2.9.349&r=stable&domain=erp.heizungsdiscount24.de
  &optin_meta_enabled_capi=true&hme=…&ex_m=…
```

This request fires on every pixel init, healthy or not. If we see the config but
**no `/tr/` event with the same pixel id**, the pixel is very likely silently
failing.

## Goal

When Meta recording is on, detect pixels that initialise (`signals/config`) but
send no event, and surface **one warning card** per affected pixel.

## Deliberate deviation from the per-request model

Every card in the extension today mirrors exactly one captured request. This is
the first **absence diagnosis**: the warning card is synthetic — it represents
the *lack* of an expected request, not a request that happened. This deviation
is intentional and scoped to Meta, because the silent-failure case is common
enough to justify covering it with the means this extension already has
(network observation, no new permissions).

## Approach: network inference only

Chosen over console capture. Reading `console.warn` would require a content
script with host permissions (monkey-patching `console`) or `chrome.debugger`,
lifting the extension out of its current `storage`-only permission profile and
triggering a fresh Web Store review plus a user permission prompt. Network
inference stays lean and needs no new permissions. Trade-off: the inference is
slightly less precise than the exact console string (see Limitations), so the
card names the likely cause without asserting it.

## Behaviour

### Detection

- Only active when `state.record.meta === true` (user requirement — this is a
  Meta-scoped special case).
- Recognise `connect.facebook.net/signals/config/{id}` as a **pixel-init
  signal**. It is *not* rendered as a card on its own — it is an internal
  anchor. Extract: `id` (path segment), `domain`, CAPI opt-in
  (`optin_meta_enabled_capi === 'true'`), version (`v`).
- Each committed Meta `/tr/` event marks its `id` as "fired" for the current
  block.

### Timing — 2-second timer

The full Meta init→PageView sequence normally completes in well under ~200 ms,
so a short fixed wait is a safe absence test without waiting for the user to
navigate or stop.

- When a config signal for pixel `{id}` is seen in a block, start a 2 s timer
  bound to that block + id.
- If a matching `/tr/` event fires before the timer elapses → cancel the timer,
  no card.
- If the timer elapses and the id has still not fired → synthesise **one**
  warning card into that block.
- Self-heal: if a matching `/tr/` arrives *after* the warning card was shown
  (late event), remove the warning card.
- On **Stop**: flush all pending timers immediately (evaluate now) so nothing is
  lost. On **Clear**: cancel all pending timers and drop the bookkeeping.
- Multiple pixel ids on one page are tracked and warned independently.

### The warning card (English UI, consistent with the rest)

- `provider: 'meta'` synthetic record, marked (e.g. `signalType:
  'config-no-event'`) so existing accessors and export/import work unchanged.
- Leads with the **Meta** pill plus a prominent warning pill styled like the
  `consent-denied` pills, e.g. **"no event sent"**.
- Title line: `Meta pixel 549… initialised — no event on the network`.
- Detail section: pixel id, domain, CAPI opt-in, and an honest note:
  most common cause = the pixel's traffic-permission settings (with the Meta
  help link `https://www.facebook.com/business/help/572690630080597`); other
  possible causes = event never triggered / consent not granted. Likely cause
  first, stated as an inference, never as certainty — matching the extension's
  "read params, don't over-claim" ethos.

### Visibility / consistency

- Because it is a `provider: 'meta'` card, the Meta display-filter pill hides and
  shows it like any other Meta card, and export/import carry it losslessly.
- It counts as a card in the event counter (it is a real finding).

## Code split (keep the testable parts pure)

- **`lib/meta.js`** (pure, unit-tested like the other parsers):
  - `parseMetaSignal(url)` → `{ id, domain, capiOptin, version }` or `null`.
    Recognises `connect.facebook.net/signals/config/{id}`.
  - A trivial pure helper for the set difference "config ids without a fired id".
- **`panel.js`** (orchestration, not unit-tested):
  - Per-block bookkeeping: config ids seen, fired ids, pending timers, and any
    rendered warning card element per id.
  - Hook config detection into `onRequest` (gated on `record.meta`).
  - Mark fired ids when a Meta `/tr/` event is committed; cancel timer / self-heal.
  - Synthesise, append and (if needed) remove the warning card.
  - Flush on Stop, clear on Clear.

## Tests

- `tests/meta.test.js`: `parseMetaSignal` recognises the real config URL and
  extracts id / domain / capiOptin / version; returns `null` for `/tr/` events
  and unrelated URLs. Set-difference helper returns the unfired ids.
- Panel orchestration (timers, DOM) stays outside the node `--test` suite as the
  rest of `panel.js` does; the decision logic it relies on lives in the pure
  helpers above.

## Out of scope (YAGNI)

- No console capture, no new permissions.
- No card for a healthy config (config is shown only via its warning, and only
  when an event is absent).
- No timing heuristics beyond the single 2 s timer.

## Known limitations

- If a setup proxies the pixel **loader** first-party (config never hits
  `connect.facebook.net`), no anchor is seen and no warning fires — fail-safe, no
  false positive.
- "No event" can also stem from consent-denied or an untriggered event, not only
  traffic permissions; the card wording reflects this uncertainty.
