# Tracking Auditor Extension — Design (Step 1)

Status: approved 2026-06-29. Reduziert auf Step 1 (GA4).

Roadmap: **Step 1 (umgesetzt)** GA4 aller Transporte · **Step 2 (als Nächstes,
vom User priorisiert)** Meta/Facebook — Metas eigene Extension ist login-gebunden,
diese Lücke füllen wir · **Step 3** Bing / Microsoft UET (UET Helper ist schwach).
Jeder Schritt erweitert `lib/ga4.js`-Analog um eigene Erkennung; die DevTools-Schale
und UI-Struktur (Blöcke pro Seitenaufruf, Karten, Pills) bleiben.

## Zweck

Eine **DevTools-Tab-Extension** ("Tracking Auditor"-Reiter), die beim Aufzeichnen
**jeden** GA4-Request des inspizierten Tabs erfasst — egal über welchen Transport:

- Standard (`google-analytics.com` / `analytics.google.com`, `/g/collect`)
- First-party sGTM / Google Tag Gateway (`/g/collect` bzw. `/collect` mit `v=2` & `tid=G-…`)
- **Stape Custom Loader** (GA4-Pfad base64-codiert in einem Query-Parameter)
- **Klartext-Custom-Pfad** (kryptischer Pfad ohne `collect`, aber `v=2` & `tid=G-…` & `en`)

Sie ist ein schlanker, fokussierter Lückenfüller für genau die Transporte, die
der "Analytics Debugger" (David Vallejo) nicht mitbekommt — **kein** Ersatz für
dessen vollen Funktionsumfang.

Kernziel: **Requests erkennen, Parameter lesen.** Keine Hash-Validierung, kein
EM-Decoder, keine Compliance-Checks.

## Architektur

Radikal schlank, weil die DevTools-Network-API keine Host-Permissions braucht.

- **manifest.json (MV3):** im Wesentlichen nur `devtools_page`. Keine
  `host_permissions`, kein `webRequest`, kein `content_script`, **kein**
  Background-Worker. (`storage` optional, nur für Theme-Präferenz.)
- **DevTools-Schale:** `devtools.html` → `devtools.js` registriert via
  `chrome.devtools.panels.create("Tracking Auditor", …)` den Reiter;
  `panel.html` + `panel.js` tragen UI und Logik.
- **Erfassung (nur im Panel-Kontext):**
  - `chrome.devtools.network.onRequestFinished` → HAR-Entry (URL + `postData`),
    nur aktiv solange "Record" an ist.
  - `chrome.devtools.network.onNavigated` → startet einen neuen Block.
- **Per-Tab:** Jede DevTools-Instanz ist an ihren Tab gebunden; "Record" muss
  pro Tab neu aktiviert werden. Das ist gewollt und praxisgerecht.

## Logik — `lib/ga4.js` (pure functions, ES-Modul, unit-getestet)

Portiert/abgeleitet aus dem EC-Validator (`background.js`):

- `tryDecodeCustomLoader(url)` → `{kind:'stape-b64'|'custom-path'|'skip'}|null`
  (inkl. `decodeBase64Utf8`, `looksLikeGa4Path`).
- `isGa4Request(url)` → erkennt Standard + first-party collect; in Verbindung mit
  `tryDecodeCustomLoader` auch die getarnten Transporte.
- `extractParams(url, postData)` → `{queryParams, bodyParams, en, tid}`.
- `summarizeUserData(params)` → z. B. `{email:2, phone:1}` (Typ + Count, **kein**
  Hash-Matching). `em` wird als normaler Parameter geführt, nur markiert.
- `parseConsent(params)` → gcs/gcd aufgeschlüsselt (aus EC-Validator übernommen).

## UI (1:1 EC-Validator-Optik: Karten, Pills, Dark Mode)

- Kopfzeile: **Record** (Start/Stop), **Clear**, Status (n Events / n Blöcke).
- **Block** = eine Navigation: Header (Ziel-URL + Zeit), darunter Event-Karten in
  Entstehungsreihenfolge.
- **Event-Karte:** Zeit · Methode · Host/Pfad · **Transport-Pill**
  (Standard / Stape b64 / Custom-Pfad) · Event-Name (`en`) prominent ·
  Identifier-Zusammenfassung ("2× email, 1× phone", `em`-Marker) ·
  **Consent-Pills** (gcs/gcd). Klick → Karte klappt **inline** auf und zeigt die
  vollständige Parametertabelle (Query + Body).

## Bewusst NICHT in Step 1

EM-Decoder/Hash-Matching · Compliance-/Structure-Checks · Response-Auswertung ·
Meta/Facebook (Step 2) · jegliche Host-Permissions.

## Persistenz

In-memory im Panel. Überlebt Seiten-Reloads (Panel lebt; `onNavigated` startet
neuen Block). Reset beim Schließen der DevTools.

## Verifikation

- **Unit-Tests** für `lib/ga4.js` gegen echte URLs (reale `europart.net`-Stape-URL,
  Standard-GA4, Negativfälle) — wie im EC-Validator bewährt.
- UI-Abnahme manuell im Browser (DevTools-Panels sind mit Playwright kaum testbar).

## Build

`package.json` mit Build-Script analog EC-Validator (Whitelist → ZIP für den
Web-Store). Version startet bei `0.1.0` (noch nicht veröffentlicht).
