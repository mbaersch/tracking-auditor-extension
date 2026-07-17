# Tracking Auditor Extension

![The Tracking Auditor DevTools panel: a live, per-page stream of decoded GA4, Meta, Bing, TikTok, Pinterest, Google Ads, Floodlight, LinkedIn, Reddit, Snapchat, HubSpot and Criteo hits — each card tinted per service with event, ID, consent and parameter pills, above a service-filter pill bar.](webstore/01-overview.png)

A lightweight Chrome **DevTools** extension that records GA4, **Meta**, **Bing**,
**TikTok**, **Pinterest**, **Google Ads**, **Floodlight**, **LinkedIn**, **Reddit**,
**Snapchat**, **HubSpot** and **Criteo** requests of the inspected tab — including
transports that common debuggers miss:

GA4:
- Standard GA4 
- First-party sGTM / Google Tag Gateway 
- Stape Custom Loader 
- taggrs Custom Loader
- Plaintext custom delivery paths 

Google Ads:
- Conversion 
- remarketing/audience
- enhanced-conversions UPD
-  Shows dynamic-remarketing product data / line items, consent 
- Multiple Requests are folded into a single card 

Floodlight (Google Marketing Platform — CM360 / DV360):
- counter / activity
- sales 
- Multiple Requests are folded into a single card 

Bing / Microsoft UET:
- Standard tag and first-party proxied `action`
- Reads `asc` consent signal ("granted/denied" or "unset" to mark a missing asc signal)

Meta (Facebook) Pixel:
- Standard pixel GET or form POST)
- All events 

LinkedIn Insight Tag:
- Standard beacon folded into a single card, 
- page views 
- conversions
- Enhanced-conversions POST with hashed email, click ids

TikTok Pixel:
- Standard pixel 
- All events
- Advanced matching, data quality 

Pinterest Tag:
- Standard tag 
- All events
- Enhanced match 

Reddit Pixel: 
- All events 
- Conversion data 
- Both manual and auto-collected hashed identifiers

Snapchat Pixel:
- All events 
- full hashed identifier set — email, phone, name, geo and age 

HubSpot:
- Pageview 
- Custom events
- Automatic collection 
- Collected forms
- Identity data (email / name / phone). 

Criteo:
- OneTag event beacon 
- All events 
- Reads (double-encoded) item array and derives a revenue total (Σ price × quantity, marked
  "computed" 
- Email
- Shared cross-vendor cookies 
- Consent 

Taboola:
- Pixel beacons / page view
- All events
- Consent 
- Hashed email

Outbrain:
- Page View
- All events
- Conversion pixel

Awin:
- MasterTag 
- Sale
- Product-level tracking


It adds a **"Tracking Auditor"** tab to DevTools. Hit **Start & Reload** — the
page reloads and every hit is listed in blocks per navigation, **newest first**, with
event name, parameters, a user-data summary and (where present) the consent state
decoded. New hits appear at the top, so the freshest is always in view and whatever
you are reading stays put. A collapsible
**Record** settings row switches services on/off (capture) and holds an **Advanced**
row with the optional **Deep Capture** mode, and an independent
**Show** filter row (service pills + fulltext) narrows the displayed log — the
pills cover only the services you actually record, so the bar carries no toggle
for a service you never capture — with **all / none** shortcuts to focus on a
single service quickly.

**Deep Capture (optional).** Some first-party setups deliver tags through a
**service worker** — Google Tag Gateway, a Cloudflare/edge worker, or Bing UET —
and dispatch their hits from the worker's own scope, where the page-scoped DevTools
network never sees them. Enabling **Deep Capture** (⚙ → Advanced) adds a second
observer via `chrome.webRequest` that catches those hits, de-duplicates them against
the normal feed and flags the worker-only ones with a **⚡ service worker** badge. It
is **off by default**; the broad host permission it needs is requested only when you
switch it on, so nothing is granted at install unless you actually use it.

**PII / user data.** Every card's detail carries one uniform **PII / user data**
block across all services: each user-data field is shown as its raw parameter, a
plain-language category (e.g. `u_hem` → Email), and the detected hash form (SHA-256 /
SHA-1 / MD5). A terse note appears only when the form contradicts the algorithm the
service requires; cleartext (e.g. HubSpot) is stated plainly as "not hashed". Reading
only — no hash validation.

**One hit, one card.** Many services fan a single user action out across several
mirrored requests — Google Ads across its conversion / remarketing / measurement
endpoints, Floodlight's `activity` + `activityi`, LinkedIn's `/collect` + `px4` mirror,
Awin's sale across `sread.img`/`php`/`js` plus whitelabel domains. Rather than list each
as its own row, the panel **folds every mirror of one logical hit into a single card**
(marked `×N transports`), anchored on a stable key (the conversion id, order reference,
`src`/`type`/`cat`/`ord`, …). The stream shows *what happened*, not how many times the
browser phoned home for it — this consolidation is a core idea of the extension.

The goal is narrow: **detect requests, read parameters.** No hash validation, no
EM decoder, no compliance checks. A focused gap-filler — not a replacement for
David Vallejo's excellent Analytics Debugger.

## Install
This extension can be installed using the Chrome Web Store: [Tracking Auditor in Chrome Web Store](https://chromewebstore.google.com/detail/tracking-auditor/cngpoecoknpgfjfaafnekjoaeohaejpb)

### From source (for development or forking)
If you want to modify the extension or run an unreleased version, load it unpacked:

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the project folder
5. Pin the extension if you want it in the toolbar

## Changelog

v1.0.0
- first "complete" release also includes Floodlight (to fill the gap in the Google stack; default "on"), Criteo, Taboola, and Outbrain (default "off") and also Awin (probably the only affiliate network in this tool; default "off") as new services. If you want to debug any of them (except Floodlght), switch recording on first once.
- taggrs Custom Loader detection and decryption
- Optimized handling for first-party detection
- new option to switch off background color-coding for different vendors
 
v.0.9.0
- added Hubspot tracking 
- PII / user-data block in request details
- Service-worker notice: detects the Google Tag Gateway first-party service-worker loader and shows a compact per-block strip — hits may be dispatched from the worker and stay invisible to the page-scoped DevTools network. UI-only (not a card), with a "mute for session" link.
- Deep Capture (service-worker / edge hits): an opt-in mode that adds a second capture source via `chrome.webRequest` (in a new background service worker), catching tracking hits dispatched from a service worker's own scope — first-party Google Tag Gateway, Cloudflare edge, and Bing UET
- Newest-first ordering: new hits and page-load blocks are inserted at the top instead of the bottom, so the freshest hit stays in view and Chrome's scroll anchoring keeps whatever you're reading in place. The **⤓ follow** auto-scroll toggle is removed as redundant. 
- Meta silent-pixel warning: a pixel can initialise yet send no  tracking events occur — a silent tracking failure, typically caused by Meta's traffic-permission settings. 
- GA4 e-commerce items: product params are decoded into readable fields 

v0.7.2
- Service-worker de-duplication: when a service worker (e.g. Cloudflare Zaraz) intercepts a page's `fetch()`, DevTools surfaces the hit twice — the aborted page-side request that never reached the network, plus the worker's real outgoing request. The aborted phantom (network error and no server connection) is now dropped, so each logical hit counts once.

v0.7.1
- Added Reddit Pixel and Snapchat Pixel
- The `/wa/` enhanced-conversions POST from LinkedIn is now decoded asynchronously into its own card with hashed email, Signal Type and collected IDs.
- UI improvements

v0.7.0
- Added Reddit Pixel provider 
- LinkedIn: enhanced-conversions POST now decoded asynchronously into its own card 

v0.6.0
- Initial release: GA4, Meta Pixel, Bing UET, TikTok Pixel, Pinterest Tag, Google Ads and LinkedIn Insight Tag.