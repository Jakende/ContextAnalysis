# verplant in die statische Website einbinden

## Reproduzierbarer Build

Im Checkout **ContextAnalysis**, nicht im Zielrepository:

```sh
npm ci
npm run build:verplant
```

Ausgabe: `dist-verplant/`. Der Build setzt `VITE_PRODUCT_VARIANT=verplant`, `VITE_REPORT_LANGUAGE=de`, `UCA_INCLUDE_GEODATA=false`, `UCA_OUT_DIR=dist-verplant` und als Standard `VITE_PUBLIC_BASE=/ausprobieren/app/`. `tsc -b`, Vite-Build, Asset-Basispfad, Abwesenheit kanonischer Geodaten, dynamisch referenzierte Laufzeitdateien sowie Schlüssel-/lokale-Pfadprüfung laufen im Build-Skript. MapLibre lädt seinen Modul-Worker relativ zum erzeugten MapLibre-Chunk; deshalb kopiert und prüft der Build `assets/maplibre-gl-worker.mjs`. Direkte `new URL("./…", import.meta.url)`-Referenzen in erzeugten Chunks werden ebenfalls auf vorhandene Zieldateien geprüft. `integration-manifest.json` enthält Quellcommit, Branch, Dirty-Status, Zeit, Variante, Basispfad, Geodatenmodus, Analyse-/Export-/Erweiterungsversion, die geprüften Laufzeitdateien und ausschließlich die tatsächlich vom Build ausgeführten Prüfungen. Keine Schlüssel oder lokalen absoluten Pfade.

Ohne explizites `VITE_GEODATA_BASE_URL` läuft der Build im Modus `none`: keine Geodatenabrufe, sichtbare Datenlücken und allgemeine Reflexionsfragen. Das ist ein funktionsfähiger Demo-/Fallbackpfad, **keine Aussage über tatsächliche Standortversorgung oder bundesweite Abdeckung**. Die Anbindung des vorhandenen kanonischen Releases ist noch eine Deployment-Aufgabe.

## Drei unabhängige Basen

| Variable | Bedeutung | Standard für verplant |
|---|---|---|
| `VITE_PUBLIC_BASE` | Vite-Assets / UI-Unterpfad | `/ausprobieren/app/` (abschließender Slash); `./` alternativ |
| `VITE_GEODATA_BASE_URL` | Unveränderlicher HTTPS-Datenrelease | leer → explizit keine Geodaten; bei Konfiguration muss die URL mit `uca-data-<16 hex>` enden |
| `VITE_API_BASE_URL` | Separater same-origin Proxy-Pfad, ohne Slash am Ende | leer → lokale KI nicht angebunden; z. B. `/ausprobieren/api` |
| `VITE_LOCAL_OLLAMA_MODEL` | explizit lokal verfügbares Modell | `llama3.1`; Cloud-Modellnamen werden abgewiesen |

Umgebungswerte können im aufrufenden Prozess gesetzt werden. Der Build priorisiert sie vor `.env`-Dateien und ignoriert für die Daten-/API-Zielwahl absichtlich lokale alte `.env`-Vorgaben, wenn keine Prozesswerte übergeben wurden. Damit werden keine bestehenden Entwicklerdienste unbemerkt in das Artefakt übernommen. `VITE_*` ist öffentlich: niemals Geheimnisse hier ablegen. `OPENROUTESERVICE_API_KEY` bleibt ausschließlich auf einem separat betriebenen Proxyserver.

Ein gepinnter Datenhost muss das bestehende Releaseformat bedienen: `processed/...` unter seiner Release-URL. Hostname und Release-ID müssen tatsächlich bereitgestellt und geprüft werden; keine Beispiel-URL wird als reale Versorgung eingebaut.

## Zielstruktur und späterer Kopierschritt

```text
Web/hompage_mockup/
  ausprobieren/
    app/
      index.html
      assets/
      integration-manifest.json
      data/                 # nur kleine öffentliche Begleitdateien, keine processed-Geodaten
      data-release-pin.json # nur bei konfiguriertem Datenrelease
```

Später **den Inhalt** von `dist-verplant/` vollständig nach `Web/hompage_mockup/ausprobieren/app/` kopieren, einschließlich Assets und Manifest. Danach `/ausprobieren/app/` direkt öffnen und neu laden; bei relativer Basis den abschließenden Slash beibehalten. Die App verwendet keine History-Routen und benötigt keine SPA-Rewrite-Regel für Unterseiten. Hash-Anker bleiben unter demselben Pfad. Nicht nur die HTML-Datei oder einzelne JS-Chunks kopieren.

In dieser Aufgabe wurde das fremde Repository weder verändert noch beschrieben. Die Anwendung enthält nur ihren Werkzeugtitel und ihre fünf Phasen; keine gemeinsame Website-Navigation und keinen Footer. Ein Link ist sofort möglich. Eine spätere iframe-Einbettung braucht eine bewusste Entscheidung zu Höhe, Fokus, `frame-ancestors`, Sandbox/Downloads und Titel im Zielrepository; keine automatische Kommunikation mit dem Parent.

## Fonts und Gestaltung

Grün `#00FF6A` mit Text `#111111`, Grund `#FDFDFC`. Urbanist für Überschriften, Navigation und Labels; Quicksand für Text und Eingaben. Die Konfiguration benennt die Schriftfamilien, liefert aber **keine erfundenen Font-Dateien** und lädt keine externen Fonts. Bis zur Integration werden System-Fallbacks verwendet. Im Zielrepository vorhandene lokale Schriften später mit verifizierten Dateipfaden und Lizenzen über `@font-face` einbinden. Bei iframe-Nutzung erbt die App keine Fonts vom Parent: die Font-Regeln müssen auch im App-Dokument erreichbar sein.

## Dienste, CORS und Produktionsgrenzen

Vites `configureServer`/`configurePreviewServer` sind Entwicklungswerkzeuge, **kein mitkopierbares Produktions-Backend**. Der reine statische QA-Server `scripts/validate/serve-verplant.mjs` bietet absichtlich keine API-Routen.

| Dienst | Browser / Proxy | Verhalten im ersten verplant-Pfad |
|---|---|---|
| OpenFreeMap | Direkte öffentliche Kacheln, CORS nach Anbieter | Grundkarte erst nach „Grundkarte laden“; sichtbarer Hinweis auf übertragenen Kartenausschnitt. Kartenfehler lassen Text/Geometrien nutzbar. |
| Nominatim | Direkter Browserzugriff grundsätzlich nur nach Policy/CORS; gültiger Referer, submit-only, Cache und Rate-Limit nötig; vorhandener Suchproxy nur Entwicklung | Ausgeschaltet; Koordinaten und Kartenpunkt funktionieren ohne Adresse. Kein stiller Adressupload. |
| Overpass | Direkt grundsätzlich möglich mit CORS und Limits; vorhandener Failover/Proxy ist nicht statisch bereitgestellt | Ausgeschaltet; vorhandene lokale Analyse und explizite Datenlücken bleiben nutzbar. |
| OpenRouteService | Eigener serverseitiger Proxy hält den geheimen Schlüssel | Ausgeschaltet; vorhandene geometrische Näherungen werden nicht als geroutete Evidenz in Perspektiven promoted. |
| Zensus WMS | Öffentlicher WMS, aktuelle CORS-/Lastgrenzen separat prüfen | Live-Enrichment ausgeschaltet; kein verdeckter Request beim Start. |
| Ollama | Lokaler Dienst oder geschützter same-origin Proxy → **lokale** Instanz. Kein HTTP-localhost aus einer öffentlichen HTTPS-Seite | Nur ausdrückliche Aktion. Ohne konfigurierten Proxy deterministischer Fallback. Kein positiver Test mit installiertem Modell erfolgt. |

Ein späterer Ollama-Proxy braucht begrenzte Anfragegröße, Timeout, Modellauswahl auf dem Server, Origin-/Zugriffskontrolle und darf kein offener Relay werden. Client-Konfiguration beweist keine Lokalität des Proxyziels. Öffentliches Hosting ohne Backend hat keine KI-Verbindung; das ist ein erwarteter Zustand.

## Cache und Datenhaltung

- Hashbenannte `assets/*`: langfristig/immutable cachen.
- `index.html` und `integration-manifest.json`: revalidieren bzw. kurz cachen, keine alte HTML-Datei mit gelöschten Chunks kombinieren.
- Versionierte Geodaten: immutable Cache, CORS für die UI-Origin, korrekte MIME-Typen; Range-Requests erst bei entsprechendem Format/Host benötigt.
- Keine Nutzer:innen-Texte oder koordinatenbezogenen API-Ergebnisse automatisch in LocalStorage in der verplant-Variante. Sitzung im RAM, Export nur auf Aktion.
- Neue Datenstände → neuer Run und geleerte räumliche Request-Caches. Keine Mutation alter Ergebnisse.

## Vor einer öffentlichen Integration offen

Echter Datenhost und vollständige Quellenabdeckung, CORS-/Cache-/MIME-Abnahme, lokaler KI-Proxy falls gewünscht, Fonts und Einbettungsentscheidung. Fachliche Profilprüfung und vollständige Datenlabel-Übersetzung bleiben offen. JSON-Reimport, Linien und zusätzliche Modi sind testbare Folgepakete in `verplant-architecture.md`.

Die vom Auftraggeber nachträglich abgewählte Playwright-/Mobilprüfung wird nicht als bestanden ausgewiesen. Desktop-Prüfung und ausgeführte Vertragstests sind in `verplant-validation.md` dokumentiert. Die vorhandene UCA-Playwright-Suite bleibt unverändert.
