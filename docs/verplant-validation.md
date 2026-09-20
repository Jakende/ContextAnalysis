# verplant: ausgeführte Validierung

Stand: 20.09.2026. Basis: `e41294919f166ed729bd125d71fb799776191c49` auf `URSB-optimization`. Die genaue gebaute Quellrevision steht nach dem Build in `dist-verplant/integration-manifest.json`.

## Erfolgreich ausgeführt

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` | bestanden |
| `npm run build` | UCA-Produktionsbuild bestanden |
| `npm run build:verplant` | Unterpfad-Build bestanden; keine kanonischen Geodaten, lokalen absoluten Pfade, localhost-Ziele oder erkannten Schlüssel |
| `npm run validate:ui` | bestehende UCA-CSS-Vertragsprüfung bestanden |
| `npm run test:data-sources` | bestanden; technische Quellenprüfung ist keine Zusage vollständiger geografischer Abdeckung |
| `npm run test:benchmark` | bestanden |
| `npm run test:benchmark-ingestion` | bestanden |
| `npm run test:kpi` | bestanden |
| `npm run test:project-area` | bestanden |
| `npm run test:spatial-area` | bestanden |
| `npm run test:scenario` | bestanden |
| `npm run validate:contracts` | alle bestehenden 15 Stufen einschließlich isoliertem Slim-Build sowie zusätzlich die neuen verplant-Vertragstests bestanden |
| `npm run test:verplant` | 19 gezielte Prüfgruppen bestanden |
| `git diff --check` | bestanden |

Die neuen Prüfgruppen decken Varianten, Kontextserialisierung, sensible Eingabehinweise, sechs Aussageklassen, Zustandsübergänge und Fehlerzustände, zentrale Invalidierung, getrennte Geometrien, unveränderte alte Ergebnisse, Workspace-Übernahme, Standortprofil/Datenlücken, Quellenkonflikte, Evidenzverweise, kontrolliertes Kontextpaket, abgewiesene KI-Ausgaben/Offline-Fallback, Profilversionen und Export-/HTML-/ZIP-Konsistenz ab. Testkennwerte sind ausdrücklich Fixtures, keine realen Standortbelege.

## Desktop-Browser

Ego-Browser gegen den **statischen Produktions-Build** unter `http://127.0.0.1:4186/ausprobieren/app/`, ohne Vite-API-Middleware. Geprüft: direkter Einstieg und Reload, sichtbare deutsche App, Wer/Wo/Was, Punkt und getrenntes Kontextpolygon, Analyse, Phasenwahl, Kommentar/Relevanz/Ausblendung, JSON-Download, geänderte Leitfrage und zweiter Durchlauf mit übernommenem Kommentar und Prüfmarkierung, Fokuswechsel vom Raumobjekt zur Karte sowie deterministischer Fallback ohne Ollama-Proxy. Ein neuer Browserlauf belegte im Datenlückenmodus null externe Ressourcenabrufe und null LocalStorage-Einträge.

Der globale UCA-Scroll-Lock wurde bei dieser Prüfung gefunden und durch getrennt geladene Variantensyles behoben. Die Desktop-Screenshotkontrolle ersetzt keine vollständige Accessibility-Abnahme. Automatische Quellen-/Methodenlabels aus der bestehenden Analyse bleiben zum Teil Englisch.

## Ausgenommen / noch offen

- Playwright und Mobilprüfung wurden am 19.09.2026 vom Auftraggeber ausdrücklich abgewählt. Der vor dieser Änderung begonnene Playwright-Aufruf konnte wegen fehlendem passendem Browserbinary nicht starten und zählt **nicht** als Testlauf. Der Browserdownload wurde beendet; kein Bestehen behauptet. Bestehende Tests wurden nicht gelöscht.
- Keine positive Ollama-Modellintegration, keine öffentliche Proxybereitstellung.
- Kein öffentlich bereitgestellter Geodatenhost und keine vollständige City-Coverage-Abnahme. Ohne Host funktioniert der bewusst eingeschränkte Reflexions-/Datenlückenpfad.
- Vollständige bidirektionale Karten-Auswahl, Polygon-Upload und sämtliche Exporte sind implementiert und teilweise vertraglich geprüft, aber nicht als vollständige Browser-Akzeptanzmatrix abgenommen. Der Reimport gespeicherter Fälle ist zurückgestellt.
- Kein Zugriff oder Schreibvorgang im fremden Repository `hompage_mockup`.

Die Prüfungen begründen eine überprüfbare erste Implementierung, keine allgemeine fachliche oder öffentliche Deployment-Freigabe. Folgepakete stehen in `verplant-architecture.md`.
