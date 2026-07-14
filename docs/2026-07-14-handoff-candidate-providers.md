# Handoff: remaining candidate providers (post-Criteo/Floodlight)

Compiled 2026-07-14, at the end of the session that shipped **Criteo** (11th) and
**Floodlight** (12th) into v0.10.0. This consolidates everything gathered for the
*next* providers so a fresh session can build them without re-discovery: the pixel
helper extension IDs (authoritative code source), the GTM containers to capture
against, the fixture pages, and the priority order.

> **Captured HAR files are gitignored on purpose** (`*.har` — large, may carry PII).
> They live only in the working copy. The relevant hits are always baked into
> `tests/*.test.js` as fixtures. This doc records *what each capture covers* and
> *where to re-capture*, not the raw traffic.

## Priority (see memory `candidate-providers-roadmap`)
- **Tier 1 — done:** Criteo ✅ (`lib/criteo.js`), Floodlight ✅ (`lib/floodlight.js`).
- **Tier 2 — next:** **Awin** (broadest reach, simplest pixel → good quick win), then
  **Taboola + Outbrain** (native ads, similar shape → build together).
- **Tier 3 — later:** **Adtraction** (Nordic affiliate, few tags), **Adcell** (DE
  affiliate — **no helper, no public doc** → purely empirical from captures).
- Build order: Criteo → Floodlight → **Awin** → Taboola/Outbrain → Adtraction → Adcell.

## Pixel helper extensions (authoritative code source)
Installed locally for reverse-engineering the request shape. Path pattern:
`C:\Users\mbaer\AppData\Local\Google\Chrome\User Data\Default\Extensions\<id>\<version>\`
(see memory `reference-pixel-helpers`).

| Service | Extension ID | Where the parsing logic sits |
|---|---|---|
| Awin | `ddfnphknakdknhcolehloanbkeppaomo` | `background.js` / `popup.js` |
| Taboola | `aefiepimkogajhddmhcekceihikjcabd` | `background.js` |
| Outbrain | `gnpngjohbaimcdienppekjdldhonelmm` | (bundle) |
| Adtraction | `inbfddpmobpdpkanhpmjhdjnmfjeeceh` (v3.2.5) | `js/*.js` (webpack chunks) |

- **Criteo has no dedicated helper.** Reference doc instead:
  <https://help.criteo.com/kb/guide/en/all-criteo-onetag-events-and-parameters-vZbzbEeY86/Steps/775825>
  (already used to build `lib/criteo.js`).
- **Adcell** has neither helper nor public doc → build strictly from real captures.
- As always (memory `feedback-real-fixtures`): the helper code is a **guide**, not
  ground truth — verify every module against **real captured requests**.

## Fixture GTM containers (see memory `reference-fixture-gtms`)
Live containers under our control that carry the candidate services, for capturing.

- **`delife.de` (container `187869219` / `GTM-W3RRHMWJ`) — the one-stop.** Carries
  **Awin, Criteo, Floodlight, Taboola, Adtraction, Adcell** together → a single funnel
  capture (product → cart → checkout) yields all of them. Hard-to-trigger events can be
  fired from the console via the vendor API (as done for Criteo `window.criteo_q`).
- **`sunrise.ch` (`GTM-TZ48GTT`, `99061434`) — the heavy case.** The dense
  **Criteo (14 tags) + Floodlight (16 tags)** container; use it to stress-test those two.

Per-service container spread (selection):
- **Awin** — ~15 containers: delife.de/nl/fr/eu, watt24.com, Krüger Dirndl,
  heizungsdiscount24.de, gvv-direkt.de, …
- **Criteo** — sunrise.ch (14 tags), delife.de/fr/eu (6 each), Krüger Dirndl (6), watt24 (1).
- **Floodlight** — sunrise.ch (16 tags), delife.de (2), plus a QA container (`GTM-N9QTZFN`).
- **Taboola** — `GTM-K584CV3` (`56104048`, "GTM | GFN PRODUKTIV", 8 tags), delife.de (2).
- **Outbrain** — container `138989299` (no edit access, 7 tags).
- **Adtraction** — `GTM-PBN6RNS` (`8596432`, www.delife.eu, 3 tags), `GTM-K3MF8K4N`
  (`179837826`, delife.nl, 1), `GTM-M89KT6ZF` (delife.fr, 1).
- **Adcell** — delife.de (2), delife.eu (2). Nowhere else; no helper/doc.

> **Capture note:** the valuable events (transaction/conversion) fire only on
> product / cart / purchase pages. Run the funnel, or console-fire via the vendor API.
> "I can't just buy new furniture" (user) → treat a purchase like any other action
> (add-to-cart etc.); the request shape is what matters, not a real order.

## Local HAR captures (gitignored — reference only)
What each working-copy capture covers, in case a re-read is needed before re-capturing:

- `taggrs.har` — taggrs custom-loader envelope (shipped: `lib/taggrs.js`).
- `delife.de.har`, `delife.de-criteitest.har` — Criteo + Floodlight + the delife stack.
- `snapchat.har`, `linkedin.har` — shipped providers.
- `hs1.har`, `hs2.har` — HubSpot (shipped).
- `cloudflare-sw.har` — service-worker / Deep Capture case.
- `www.europart.net.har` — misc first-party / sGTM sample.

## Shape notes for the Tier-2/3 builds
High-level, to be confirmed against captures:
- **Awin** — simple affiliate **conversion** pixel: order ref / amount / currency /
  voucher / commission group. `dwin1.com` host. Broadest reach but the least to decode.
- **Taboola / Outbrain** — native-ads pixels: **page view + conversion** events, similar
  form (hence build together). Helpers available (IDs above).
- **Adtraction** — Nordic affiliate; few tags per container; helper `inbfddpmobpdpkanhpmjhdjnmfjeeceh`.
- **Adcell** — DE affiliate; **empirical only**. Capture on delife.de/eu.

## Cross-project note
Cleartext-PII services (HubSpot, Criteo `setEmail`) also feed the sister project's
roadmap — surface cleartext **neutrally** ("cleartext"), never framed as a "PII leak"
(see memory `ecvalidator-cleartext-services-idea`).
