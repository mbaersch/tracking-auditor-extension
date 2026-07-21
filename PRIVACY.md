# Privacy Policy — Tracking Auditor

**Last updated:** 2026-07-21
**Extension:** Tracking Auditor (Chrome DevTools extension)
**Developer:** Markus Baersch
**Contact:** mbaersch@gmail.com
**Source code:** https://github.com/mbaersch/tracking-auditor-extension

## Summary

**Tracking Auditor does not collect, store, transmit, share or sell any user data.**

There is no backend. The developer operates no server that this extension talks to,
and the extension contains no analytics, no telemetry, no crash reporting, no ads and
no third-party SDKs. Nothing the extension reads ever leaves the user's computer.

The extension is a **debugging viewer**. It decodes marketing-pixel requests that the
*inspected website* is already sending, and displays them in a DevTools panel so a
developer can see what their own site is transmitting. Its entire purpose is
transparency — it is the opposite of data collection.

## What the extension does

Tracking Auditor adds a panel to Chrome DevTools. While DevTools is open on a tab and
recording is enabled, it reads the network requests of that one inspected tab, detects
requests to known marketing endpoints (GA4, Google Ads, Floodlight, Meta, Bing UET,
TikTok, Pinterest, LinkedIn, Reddit, Snapchat, HubSpot, Criteo, Taboola, Outbrain,
Awin), decodes their parameters into human-readable form, and renders them as cards in
the panel.

This is the same information a developer can already see in the DevTools **Network**
tab. The extension does not obtain any data the browser did not already have; it only
makes the encoded payloads readable.

## About the personal data visible in the panel

A review of this extension noted that email addresses, phone numbers, names and
addresses can appear in the interface. That observation is correct, and it is important
to explain exactly what it means:

- Those values are **not collected by the extension**. They are parameters that the
  *inspected website* transmits to *its own* marketing vendors (for example, Meta's
  Advanced Matching or Google's Enhanced Conversions).
- The extension **displays** them — read-only, in a panel that only the person sitting
  at the keyboard can see — so that a site owner or consultant can verify what their
  own tracking setup is sending. Detecting unintended personal-data leakage is one of
  the main reasons to use this tool.
- The extension **does not** store these values persistently, upload them, forward them,
  aggregate them, or make them available to the developer or to any third party.
- The values live only in the memory of the open DevTools panel and are discarded when
  the panel is closed.

In other words: the extension is the *observer* of a data flow that exists with or
without it, not a participant in it.

## Data storage

### In memory (transient)

Captured requests, their decoded parameters, and any decryption keys read from a
website's own loader script (for example the taggrs custom loader, whose AES key is
hardcoded in the JavaScript the site itself serves) are held **only in the memory of the
open DevTools panel**. They are never written to disk by the extension and are gone as
soon as the panel is closed.

### Persistent storage (`chrome.storage.local`)

The extension persists exactly one thing: the user's own UI preferences.

```
{ record, filter, deepCapture, colorCards }
```

That is: whether recording is on, which service filters are active, whether Deep Capture
is enabled, and whether card color-coding is on. **No captured request, no parameter and
no personal data is ever written to storage.** This data stays on the user's device and
is not synced to any account.

### Export (user-initiated only)

The panel has an **Export** button. When — and only when — the user clicks it, the
currently visible capture is serialized to a JSON file and saved to the user's own
computer via the browser's normal download mechanism. The file goes nowhere else. No
export happens automatically.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `devtools_page` | Adds the panel to DevTools and reads the network log of the inspected tab. This is the core function. |
| `storage` | Persists the UI preferences listed above. Nothing else. |
| `webRequest` | Powers the optional **Deep Capture** mode (see below). |
| `optional_host_permissions: <all_urls>` | **Optional and opt-in.** Requested only when the user explicitly enables Deep Capture. Not granted at install time. |

### About Deep Capture

Some tracking hits are dispatched from a website's *service worker* (for example
first-party server-side GTM / Google Tag Gateway, Cloudflare edge workers, or Bing UET).
Requests made in a service worker's own scope are invisible to the tab-scoped DevTools
network log, so they cannot be debugged with the standard mechanism.

Deep Capture is an **opt-in** mode that adds `chrome.webRequest` as a second, read-only
observation source to catch those hits. It is off by default, the user must enable it
deliberately, and it grants no additional data flow: the observed requests are decoded
and rendered in the same local panel, and are subject to the same rules as everything
else in this policy — memory only, never transmitted.

## What the extension never does

- It does not send data to the developer or to any server.
- It does not use analytics, telemetry, crash reporting or tracking of its own.
- It does not sell or transfer data to third parties.
- It does not use data for advertising, personalization or credit-worthiness purposes.
- It does not use data for any purpose unrelated to its single stated function: showing
  a developer the tracking requests of the page they are inspecting.
- It does not load or execute remote code. All code ships inside the extension package
  and can be inspected in the public repository linked above.
- It does not modify, block or inject anything into the inspected page.

## Chrome Web Store data-usage disclosures

The extension's handling of the data it displays complies with the Chrome Web Store
Developer Program Policies, including the Limited Use requirements. Because no data is
transmitted off the device, there is no collection, no sharing and no secondary use to
disclose.

## Users and jurisdiction

The extension has no user accounts, no identifiers and no server-side records. There is
therefore no personal data held by the developer about any user, and nothing to request,
correct or delete. Uninstalling the extension removes the locally stored preferences.

Because the extension processes data only locally in the user's browser and the
developer never receives it, the developer is not a controller or processor of that data
in the sense of the GDPR. Site owners using the tool on their own properties remain
responsible for the data their websites transmit to their marketing vendors.

## Changes to this policy

Material changes will be published in this file in the public repository, with the
"Last updated" date above adjusted accordingly. The version history is visible in the
repository's commit log.

## Contact

Questions about this policy: **mbaersch@gmail.com** or via an issue at
https://github.com/mbaersch/tracking-auditor-extension/issues
