# Privacy Policy — Tracking Auditor

**Tracking Auditor does not collect, store, transmit, share or sell any user data.**

The developer operates no server that this extension talks to, and the extension contains 
no analytics, no telemetry, no crash reporting, no ads and no third-party SDKs. Nothing 
the extension reads ever leaves the user's computer; no backend is involved. 

The extension is a **debugging viewer**. It decodes marketing-pixel requests that the
*inspected website* is already sending, and displays them in a DevTools panel so a
developer can see what their own site is transmitting. Its entire purpose is
transparency — it is the opposite of data collection.

## What the extension does
Tracking Auditor adds a panel to Chrome DevTools. While DevTools is open on a tab and
recording is enabled, it reads the network requests of that one inspected tab, detects
requests to known marketing endpoints (like GA4, Google Ads, Floodlight, Meta, Bing UET, 
and others), decodes their parameters into human-readable form, and renders them as 
cards in the panel.

This is the same information a developer can already see in the DevTools **Network**
tab. The extension does not obtain any data the browser did not already have; it only
makes the encoded payloads readable.

## About the personal data visible in the panel
If personal data is part of a request, fields containing email addresses, phone numbers, 
names and addresses will appear in the interface if the extension knows the format. What it 
means exactly:

- Those values are **not collected by the extension**. They are parameters that the
  *inspected website* transmits to *its own* marketing vendors (for example, Meta's
  Advanced Matching or Google's Enhanced Conversions).
- The extension **displays** them — read-only, in a panel that only the person sitting
  at the keyboard can see — so that a site owner or auditor can verify what their
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
The panel has an **Export** button. Only when the user clicks it, the currently visible 
capture is serialized to a JSON file and saved to the user's own computer via the 
browser's normal download mechanism. The file goes nowhere else. No export happens 
automatically.

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
- It does not send data to the developer or any server.
- It does not use analytics, telemetry, crash reporting or tracking of its own.
- It does not sell or transfer data to third parties.
- It does not use data for advertising, personalization or credit-worthiness purposes.
- It does not use data for any purpose unrelated to its single stated function: showing
  a developer the tracking requests of the page they are inspecting.
- It does not load or execute remote code. All code ships inside the extension package
  and can be inspected in the public repository linked above.
- It does not modify, block or inject anything into the inspected page.

## Changes to this policy
Material changes will be published in this file in the public repository, with the
"Last updated" date above adjusted accordingly. The version history is visible in the
repository's commit log.

## Contact
Questions about this policy: **mbaersch@gmail.com** or via an issue at
https://github.com/mbaersch/tracking-auditor-extension/issues

*Last updated*: 2026-07-21 
