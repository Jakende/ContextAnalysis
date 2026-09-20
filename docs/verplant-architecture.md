# verplant: Architektur, Verträge und Grenzen

Implementierter erster vertikaler Pfad auf `verplant`, Basis `e41294919f166ed729bd125d71fb799776191c49` (frisch abgeglichener `origin/URSB-optimization` am 19.09.2026). Gegenüber der Voranalyse `17ecc8439146535b1395964281e0ff3087234a97` enthält die Basis zusätzlich `2bd0281`, `3b4b0b9` und `e412949`.

## Verantwortungen

| Ebene | Bestehend / neu | Grenze |
|---|---|---|
| E1 Eingabe und Interaktion | `VerplantApp.tsx`, `SpatialMap.tsx`; bestehende Geometrieparser | Deutsch, direkt bearbeitbar, kein Wizard. Phasenwechsel setzt nichts zurück. |
| E2 räumlicher Kontext | `runAnalysis.ts`, `analysis/xl`, `l`, `m`, `localSpatial.ts`, `sourceAdapters.ts`; `siteProfile` | Bestehende deterministische Kennwerte; L-Kontextpolygon wird dem bisherigen `projectArea`-Parameter als ausdrücklich beschriftete Adaptergeometrie übergeben. |
| E3 fachlicher/gesellschaftlicher Kontext | `verplant/profiles.ts` | Zehn versionierte redaktionelle Profile; getrennte Dimensionen für Fachwissen, Institution, Betroffenheit, Macht, Anerkennung und Beteiligung. Keine Gruppenvertretung. |
| E4 Voranalyse | `verplant/engine.ts` | Zustand, Ursache, Ziel, Intervention, Frage getrennt klassifiziert; begründete Beziehungen zwischen konkreten Objekt-IDs, keine unbelegten Kausalitäten. |
| E5 Orchestrierung | `model.ts`, `engine.ts`, `localRefinement.ts` | Explizite Zustandsübergänge und zentrale Invalidierung. Optionale lokale KI wählt nur vorhandene Frage-IDs. |
| E6 Reflexion | `VerplantApp.tsx`, `SpatialMap.tsx` | Textliche Aussageklassen, Caveats, Auswahl in beide Richtungen, Kommentar/Markierung/Ausblendung. Keine dekorative Konfliktgrafik. |
| E7 Weiterverwendung | `verplant/export.ts`, bestehender ZIP- und Download-Code | JSON/Markdown/HTML/ZIP auf ausdrückliche Aktion; keine Veröffentlichung oder Hintergrundspeicherung. |
| Q Querschnitt | `types.ts`, Validierung, Source Registry, Tests | Evidenzverweise, Versionen, Geometrieprüfung, HTML-Escaping, lokale Datenhaltung, Fokus und Textalternative. |

Kein zusätzlicher Server und keine Python-/R-/Modell-/AGPL-Abhängigkeit. `adapters.ts` hält die Grenze für einen späteren, separat geprüften Vorverarbeitungsadapter fest. `referenceRegistry.json` ist eine Entwicklungs-Entscheidungsmatrix, keine fachliche Evidenzquelle.

## Versioniertes Fallmodell

`verplant-case/1.0.0` ergänzt die UCA-Verträge, ohne deren App-Literal, Analyseversion oder Exportversion zu ändern. JSON enthält `manifest`, `case`, `runs`, `results`, `workspaces`. Jeder Durchlauf enthält einen eigenen Eingabesnapshot, Softwarecommit, Profil-/Schemaversion und Quellenstände. Die beobachtete UCA-Analyse liegt unverändert unter `results[].analysis`; Projektgeometrie und Kontextgeometrie stehen getrennt in `case.spatial` und jedem Run-Snapshot. Der alte UCA-Name `analysis.projectArea` bezeichnet **in diesem Adapter** den L-Analysekontext, nicht den verplant-Projektgegenstand.

`result` wird nach Erzeugung nicht bearbeitet. Kommentare, Ausblendungen, Relevanz und eigene textliche Ergänzungen erzeugen neue `workspace`-Versionen. Neue Durchläufe hängen an, übernehmen Bearbeitungen unter stabilen Objekt-IDs und kennzeichnen sie als erneut zu prüfen. Auch Bearbeitungen zu später entfallenen Objekten bleiben im Export. Neue Fälle erhalten eine neue UUID; ein Fallwechsel im selben Verlauf wird abgewiesen. Die Versionshistorie ist im Arbeitsspeicher, nicht automatisch in LocalStorage. Ein Reload beendet diese Sitzung; der bewusste JSON-/ZIP-Export sichert alle Snapshots. Ein geprüfter Reimport ist ein Folgepaket.

## Zentrale Invalidierung

Implementiert in `model.ts: INVALIDATION` und `changes`, von der Oberfläche verwendet und separat getestet.

| Änderung | Neu ausführen | Vorhandene Ergebnisse / Bearbeitungen |
|---|---|---|
| Projekt-/Kontextgeometrie oder Analysemaßstab | E2–E6 | Neuer Run; alte Ergebnisse behalten; Workspace übernehmen und als prüfbedürftig markieren |
| Quelle / Datenstand | E2–E6, lokale Request-Caches leeren | Neuer Run; kein stilles Überschreiben |
| Rolle, Ausgangsrahmen, Problem, Ziel, Konflikt, Modus | E3–E6 | Vorhandenen E2-Snapshot wiederverwenden; neuen Run erzeugen |
| Perspektivenauswahl | E3–E6 | Neue Auswahl im Eingabesnapshot; alte Runs unverändert |
| Kommentar, Relevanz, Ausblendung, eigene Ergänzung | nur E7 | Nur neue Workspace-Version; keine fachliche Neuberechnung |
| Lokale KI-Frageauswahl | E5/E6 als expliziter neuer Run | Alte deterministische Ausgabe behalten; bei Fehler neuer Run mit `fallback` |

Die Eingabe „Datenstand / Quellenversion“ ist eine **Nutzer:innen-Deklaration und ein Neuberechnungsauslöser**, keine Änderung der gepinnten Host-URL. Ein tatsächlicher Releasewechsel erfordert einen Build mit neuem `VITE_GEODATA_BASE_URL`. Quellenbelege und Indikatorversionen bleiben zusätzlich im unveränderten Analysesnapshot erhalten.

## Raum, Evidenz und Aussagegrenzen

- Punkt-/Koordinateneingabe und WGS84 Polygon/MultiPolygon per GeoJSON-Upload funktionieren. Adresseingabe, neue Zeichenwerkzeuge und Linien sind in der verplant-Oberfläche zurückgestellt. Die bestehende UCA-Variante behält ihre Werkzeuge.
- Projektgegenstand und Kontext sind verschiedene Geometrien. Identische Polygone werden abgewiesen. Ein Anker muss in beiden polygonalen Bezugsräumen liegen; das Projekt muss nicht vollständig im Kontext liegen. Dies ist eine bewusste Untersuchungsentscheidung, keine automatische Gleichsetzung.
- Der Kontextradius ist 100–1700 m einstellbar, Startwert 500 m. Die bestehende Polygon-Diagonalgrenze von 5 km bleibt eine technische Browsergrenze und wird nicht als fachliche Regel interpretiert.
- XL behält administrative Räume; L verwendet den getrennten Kontext; M den nächstgelegenen Straßenabschnitt. Ein einheitlicher Nenner über alle Maßstäbe wäre falsch. Der Standortprofil-Schritt zur Beschneidung weist diese Grenze aus.
- Kennwerte werden nur mit vorhandenen registrierten Quellen und mindestens einem verfügbaren Quellenbeleg in das Standortprofil übernommen. Fehlende oder leere Daten werden nicht als Nullbefunde beworben. Die vollständige rohe Analyse einschließlich ihrer Caveats bleibt separat exportiert.
- Gleich benannte, gleichskalige Befunde mit verschiedenen Quellen und verschiedenen Werten werden nebeneinander als Quellenkonflikt gezeigt. Dies ist eine konservative Erkennung, kein vollständiger semantischer Quellenabgleich.
- `source_fact` markiert direkt gelesene ausgewählte XL-Quellenwerte; `computed_indicator` abgeleitete Kennwerte. `interpretation`, `open_question`, `user_statement` und `participation_perspective` bleiben getrennt und textlich beschriftet.
- Die zehn Faktoren bleiben auch bei fehlenden Indikatoren als offene Kategorien sichtbar. Markt-, Rechts-, Beteiligungs- und Umweltprüfungen werden nicht simuliert.
- Quellenbefunde behalten Originalbezeichnungen/Methoden aus UCA, teilweise Englisch. Die neue Bedienoberfläche und der deterministische Bericht sind Deutsch; eine vollständige redaktionelle Übersetzung der bestehenden Datenlabels ist offen.

## Optionale lokale KI

`verplant-context/1.0.0` hat ausschließlich die neun vereinbarten Top-Level-Felder. Freitexte stehen als Daten in `user_hypotheses`; feste Regeln und erlaubte Frage-IDs unter `instructions`. Schema `questionIds` erlaubt nur vorhandene offene Fragen; unbekannte Felder, IDs, neue Zahlen-/Rechts-/Tatsachentexte und Doppelungen werden verworfen. Temperatur 0, begrenzte Ausgabe und Timeout. Kein Remote-/Cloud-Modell im ersten Pfad. Die Bereitstellung muss garantieren, dass der konfigurierte same-origin Proxy ausschließlich eine lokale Ollama-Instanz erreicht.

Die KI erzeugt im MVP **keine freie Verfeinerung**. Einmalige, ausdrückliche Aktion wählt Prüffragen; bei nicht konfiguriertem/offline Dienst bleibt das deterministische Ergebnis erhalten. Keine externe KI, Telemetrie, Kontaktaufnahme oder automatische Veröffentlichung. Sensitivitätshinweise sind heuristisch, keine vollständige Datenschutzklassifikation.

## Exporte und Migration

| Format | Behandlung |
|---|---|
| JSON und Manifest | Versionierter Fall mit allen Runs/Resultaten/Workspaces; Erweiterung `verplant-case/1.0.0`; UCA-Analyse verschachtelt kompatibel |
| Markdown/HTML | Deutscher deterministischer Reflexionsstand mit Eingaben, Tatsachen-/Frageklassen, Quellen, Unsicherheiten und Bearbeitungen; HTML escaped |
| ZIP | `case.json`, `manifest.json`, `report.md`, `report.html`; keine stillen Fremduploads |
| CSV | Bestehende UCA-Kennwerttabelle unverändert; Kommentare/Graphbeziehungen sind keine skalaren Indikatoren |
| GeoJSON/GPKG/SVG | Bestehende räumliche UCA-Verträge unverändert; keine unvalidierten Perspektivmarker oder Kommentare in Geodatenspalten |
| Szenarien | Bestehende UCA-Szenarioschicht bleibt separat. In diesem verplant-Pfad keine Szenariogeometrie erzeugt |

Keine automatische Migration bestehender UCA-Exporte. Keine vorgetäuschten „Erfahren“-Inhalte, Kontakte, Kollaboration oder Veröffentlichung; nur typisierte spätere Übergabegrenzen.

## Testbare Folgepakete

1. **Dateneinbindung:** echten unveränderlichen Geodatenhost wählen; Munich-Abdeckung und Caveats im Produktions-Build mit echten Daten prüfen. Frankfurt/Rosenheim bleiben nach bestehendem Stand offen.
2. **Fachredaktion:** zehn Profile und Fragen mit Fachleuten und Betroffenen überprüfen; konkrete Wissensreferenzen und kuratierte interne Inhalte lizenzieren/versionieren. Rollenabhängige Vertiefung und alternative Problemdefinitionen fallbezogener ausarbeiten.
3. **Speichern/Reimport:** JSON-Schema für untrusted vollständige Archive, Größenlimits, Migrations- und Restoretests; danach bewusstes Laden älterer Arbeitsstände.
4. **Erweiterte Rauminteraktion:** adressbasierte Suche mit ausdrücklicher Übertragung, unabhängige Zeichenwerkzeuge und Linien nur mit validierter Methodik.
5. **KI:** generative Deutungen erst nach belastbarer Evidenz-/Werte-/Rechtsaussagenprüfung; optionalen lokalen Proxy separat betreiben und positiv mit installiertem Modell testen.
6. **Modi/Anschluss:** eigene Logik und Abnahmekriterien für Perspektivenvergleich, Beteiligungsvorbereitung und Zusammenarbeit. Kein Modus wird bis dahin als verfügbar angeboten.
