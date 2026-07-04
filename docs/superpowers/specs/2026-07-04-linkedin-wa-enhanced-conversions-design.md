# LinkedIn `/wa/` Enhanced-Conversions erfassen

**Datum:** 2026-07-04
**Status:** Design freigegeben, bereit für Implementierungsplanung
**Betrifft:** `lib/linkedin.js`, `panel.js`, `tests/linkedin.test.js`, neue Fixture-Datei

## Problem

Der Auditor verwirft aktuell den LinkedIn-`/wa/`-Request bewusst (`lib/linkedin.js:70`, dokumentiert im Kommentarblock `lib/linkedin.js:14-34`). Die ursprüngliche Annahme war, dass `/wa/` nichts Auditierbares enthält. Das stimmt nicht: Der `/wa/`-Body ist die **einzige** Stelle, an der LinkedIns Enhanced-Conversions-PII den Browser verlässt — der `/collect`-Beacon trägt keine User-Identifier.

An echten Captures (`linkedin.har`) verifiziert:
- Der `/wa/`-POST-Body kommt über die DevTools-HAR als `postData.text` an (ASCII, beginnt mit `H4sI`), ist also `base64(gzip(JSON))` und verlustfrei dekodierbar.
- Das dekodierte JSON trägt u.a.: `pids` (Array, Partner-ID — identisch mit dem `pid` des `/collect`), `signalType` (`PAGE_VISIT` | `CLICK` | …), `hem` (SHA-256 der lowercase-E-Mail, `null` solange keine Adresse gesetzt ist), `pageTitle`, `domain`, `url`, `time`, `scriptVersion`, `websiteSignalRequestId` (UUID pro Signal), `liFatId`/`liGiant` (LinkedIn First-Party-Ad-Tracking-IDs, oft leer), `misc`, sowie bei Interaktions-Signalen `domAttributes` (geklicktes Element: `innerText`, `tagName`, `isFormSubmission`, …), `elementCrumbsTree` (DOM-Pfad) und `href`.

**Wichtig:** `hem` ist **nicht** an `CLICK` gebunden. Jedes Signal *kann* eine Mailadresse tragen; im Fixture feuerte der PAGE_VISIT nur, bevor `lintrk('setUserData')` lief. Die PII-Zuordnung erfolgt ausschließlich über die Präsenz von `hem`, nie über `signalType`.

## Getroffene Entscheidungen

- **Scope:** Alle `/wa/`-Signale werden als Karte gezeigt (nicht nur PII-tragende). PII-Badge erscheint genau dann, wenn `hem` vorhanden ist.
- **Karten-Modell:** Eigene Karte je Signal (`eventName = signalType`). Kein Merge in die `/collect`-Karte.
- **Detailtiefe:** Voller Payload-Dump des dekodierten JSON, plus explizites Hervorheben tracking-relevanter Felder (`hem`, `liFatId`/`liGiant`).

## Nicht-Ziele (YAGNI)

- **Kein** generisches Async-Parser-Framework in der `PARSERS`-Registry. Nur LinkedIn braucht Async → schmaler Seitenpfad.
- **Keine** Hash-Validierung. Der Auditor weist Datenflüsse aus, prüft aber nicht, ob ein Hash korrekt gebildet wurde (`hem` wird schlicht als `hashed: true` markiert).
- **Kein** Merge/Cross-Request-Korrelation zwischen `/wa/` und `/collect`.

## Architektur: additiver Async-Seitenpfad

Der synchrone Parser-Kontrakt aller Provider bleibt unangetastet. `/collect` läuft weiter über `parseLinkedInRequest` (sync). `/wa/` bekommt einen separaten async Pfad, weil `DecompressionStream` zwingend async ist.

### `lib/linkedin.js` — neue Exports

- `isLinkedInWaRequest(url)` — synchroner Guard: `ads.linkedin.com`-Host **und** `/wa/`-Pfad (`/\/wa(\/|$)/`).
- `async parseLinkedInWaRequest(url, postData)` → `Promise<record|null>`.
- Interne Helper (Muster aus Schwesterprojekt `ec-data-validator/detectors.js`):
  ```js
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function gunzipToText(bytes) {
    const s = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder('utf-8').decode(await new Response(s).arrayBuffer());
  }
  ```
  `atob`, `Response`, `DecompressionStream`, `TextDecoder` sind sowohl im Panel als auch in Node 18+ (`node --test`) global verfügbar → direkt testbar.

`parseLinkedInWaRequest` dekodiert `postData.text` (bzw. `postData` als String) via `base64ToBytes` → `gunzipToText` → `JSON.parse`. Bei jedem Fehler (kein Body, kein gültiges base64/gzip/JSON, kein Objekt): `return null` (kein Absturz, Request wird still verworfen).

### `panel.js` — Refactor + Seitenpfad

Die Post-Parse-Logik in `onRequest` (Stempeln `_ts`/`_originalUrl`/`_search`, Collapse-Map, `appendEventDom`) wird in ein Helper `commitRecord(block, r)` extrahiert, das Sync- und Async-Pfad gemeinsam nutzen.

```js
function onRequest(harEntry) {
  if (!state.recording) return;
  const req = harEntry && harEntry.request;
  if (!req || !req.url) return;
  const block = /* aktueller Block, jetzt in Variable referenziert */;
  const r = parseRequest(req.url, req.postData);
  if (r) { commitRecord(block, r); return; }
  if (state.record.linkedin && isLinkedInWaRequest(req.url)) {
    parseLinkedInWaRequest(req.url, req.postData)
      .then(rec => { if (rec) commitRecord(block, rec); })
      .catch(() => {});
  }
}
```

- `block` wird bei Dispatch referenziert (Decode dauert Millisekunden → landet zuverlässig im richtigen Block, auch wenn zwischenzeitlich `onNavigated` einen neuen Block startet).
- `onRequestFinished`-Listener sind fire-and-forget → async hier unproblematisch.
- Provider-Toggle `state.record.linkedin` wird respektiert (wie im Sync-Dispatch).
- Da JS single-threaded ist und die `.then`-Callbacks seriell laufen, ist die Collapse-Map (`block._collapse`) race-frei.

## Record-Shape (`/wa/`)

Gleiche Grundform wie der `/collect`-Record, damit das generische Rendering uniform bleibt:

```js
{
  provider: 'linkedin',
  transport: 'standard',
  host, pathname,
  effectiveUrl: url, effectivePath: pathname,
  method: 'POST',
  pid,                                   // String(pids[0]) oder null
  conversionId: null,
  eventName: signalType || 'Signal',     // 'PAGE_VISIT' | 'CLICK' | …
  isConversion: false,
  signalType,
  pageUrl: json.url || null,
  pageTitle: json.pageTitle || null,
  tagManager: null,
  version: json.scriptVersion != null ? String(json.scriptVersion) : null,
  ipHash: null,
  time: json.time != null ? String(json.time) : null,
  hem,                                   // Roh-Hash oder null
  liFatId: json.liFatId || null,         // aus Payload gehoben für Meta-Tabelle
  liGiant: json.liGiant || null,
  userData: hem ? { email: { label: 'Email', hashed: true } } : null,
  identifiers: { email: hem ? 1 : 0, phone: 0, name: 0, address: 0 },
  consent: null,
  flags: {
    signal: signalType,
    hashedEmail: !!hem,
    liFat: !!(json.liFatId || json.liGiant),
  },
  waPayload: json,                       // komplettes dekodiertes JSON (Full-Dump)
  queryParams: {}, bodyParams: {},
  _endpoint: 'wa',
  _collapseKey: json.websiteSignalRequestId ? ('li-wa:' + json.websiteSignalRequestId) : null,
  _transportLabel: subdomainLabel(host),
  _transportRank: 100,
}
```

Der bestehende `/collect`-Record erhält zur sauberen Render-Unterscheidung zusätzlich `_endpoint: 'collect'`.

**Dedup:** Zwei identische Signal-Doppel-Fires (im Fixture: derselbe CLICK, einmal `charset=UTF-8`/einmal `utf-8`) teilen dieselbe `websiteSignalRequestId` → gleicher `_collapseKey` → kollabieren zu einer Karte mit `×2 transports`.

## Rendering (`panel.js`)

- **`flagPills`** (linkedin-Branch): bei `_endpoint==='wa'`
  - PII-Pill „hashed email" (Stil wie bestehendes `pill-em`) wenn `flags.hashedEmail`.
  - Signal-Pill mit `signalType`.
  - li_fat-Pill wenn `flags.liFat`.
  - `/collect` behält seine conv-id- / IP-hash-Pills unverändert.
- **`summaryPills`**: die generische Email-Identifier-Pill greift automatisch über `identifiers.email`; zusätzlich „enhanced conv."-Pill für linkedin bei `hashedEmail` (analog Ads/UET-Branches).
- **`detailHtml`** (linkedin-Branch): bei `_endpoint==='wa'`
  - Meta-kv-Tabelle: `signalType`, `pid`, `pageTitle`, `url`, `time`, `scriptVersion`; `liFatId`/`liGiant` **nur wenn non-empty** (hervorgehoben als Tracking-IDs).
  - userData-Sektion (Email · hashed) nach googleads-Muster (`panel.js:500-504`), nur wenn `hem`.
  - Aufklappbarer `<pre>`-**Full-Dump** des `waPayload` (inkl. `domAttributes`, `elementCrumbsTree`, `misc`, `href`, …), JSON hübsch formatiert und HTML-escaped.
  - `/collect` behält die bestehende Darstellung.
- Die provider-agnostischen Accessoren (`eventName`→`r.eventName`, `accountId`→`r.pid`, `docLocation`→`r.pageUrl`) funktionieren ohne Änderung.

## Tests & Fixtures (Real-Fixtures-Grundsatz)

Die 3 echten `/wa/`-Bodies aus `linkedin.har` werden als Fixture (base64-Text, verbatim) gespeichert (z.B. `tests/fixtures/linkedin-wa-bodies.js`). Die Tests **dekodieren sie wirklich** und exerzieren damit `base64ToBytes` + `gunzipToText` end-to-end — genau der Pfad, den das Schwesterprojekt nie getestet hat.

Zu ergänzende Tests in `tests/linkedin.test.js` (async):
- PAGE_VISIT-Body → `provider:'linkedin'`, `_endpoint:'wa'`, `method:'POST'`, `signalType:'PAGE_VISIT'`, `eventName:'PAGE_VISIT'`, `pid:'12345678'`, `hem:null`, `identifiers.email:0`, `flags.hashedEmail:false`, `pageTitle` gesetzt.
- CLICK-Body (mit hem) → `signalType:'CLICK'`, `hem` = erwarteter 64-hex-String, `identifiers.email:1`, `flags.hashedEmail:true`, `userData.email.hashed:true`, `waPayload.domAttributes` vorhanden (`innerText:'Absenden'`, `isFormSubmission:true`).
- Dedup: die zwei identischen CLICK-Bodies liefern denselben `_collapseKey` (`li-wa:<uuid>`).
- `liFat`-Flag: `false` bei leeren `liFatId`/`liGiant` im Fixture; ein synthetischer Body mit gesetztem `liFatId` → `flags.liFat:true`, `liFatId` am Record.
- Robustheit: `parseLinkedInWaRequest` mit leerem/ungültigem Body → `null` (kein Throw).
- `isLinkedInWaRequest`: `true` für `px.ads.linkedin.com/wa/`, `false` für `/collect` und Fremd-Hosts.

Der bestehende Test `tests/linkedin.test.js:77-79` (der `/wa/` via `parseLinkedInRequest` als `null` erwartet) **bleibt korrekt** — der Sync-Parser behandelt weiterhin nur `/collect`. Nur der Kommentar dort wird angepasst (`/wa/` wird jetzt über den Async-Seitenpfad erfasst, nicht mehr generell ignoriert).

## Doku

Der Kommentarblock `lib/linkedin.js:14-34` wird umgeschrieben: von „intentionally ignored / would break the parser" auf „wird über den async Seitenpfad `parseLinkedInWaRequest` erfasst". Ohne jeden Bezug zwischen `signalType` und PII. `README.md` erhält ggf. eine Zeile analog zum Schwesterprojekt (LinkedIn-`hem` fließt im `base64(gzip(JSON))`-`/wa/`-POST; der Auditor dekodiert async und weist die gehashte Email sowie `liFatId`/`liGiant` aus).

## Risiken / offene Punkte

- **Body-Verfügbarkeit** ist an `linkedin.har` bestätigt. Falls DevTools bei manchen Browsern/Versionen den POST-Body nicht in die HAR schreibt, fällt der `/wa/`-Pfad still aus (`return null`) — der `/collect`-Pfad bleibt unberührt. Akzeptabel (best-effort).
- **Block-Zuordnung bei Navigation:** Decode ist quasi instantan; das Referenzieren von `block` bei Dispatch deckt den Grenzfall ab.
