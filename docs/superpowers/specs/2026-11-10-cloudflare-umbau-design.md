# Umbau auf Cloudflare (Design)

## Warum
Die App soll **kostenlos** laufen und nur vom Team genutzt werden. Das FastAPI-Backend braucht eine Festplatte und einen Dauerprozess (Fly.io, ca. 2–3 US-Dollar im Monat). Auf Cloudflare läuft alles in der kostenlosen Stufe: ein Worker liefert die Oberfläche **und** die API, die Daten liegen in D1 (SQLite), der Kalenderabgleich läuft per Cron-Trigger. Es gibt noch keine Live-Daten, deshalb entfällt jede Datenübernahme außer dem einmaligen Excel-Import.

## Ziele
- Genau dieselbe App wie heute (gleiche Seiten, gleiche Regeln, gleiche Texte), aber **ein** Cloudflare-Worker statt Pages + Fly:
  - Statische Oberfläche aus `apps/web/out` (Workers Static Assets).
  - API unter `/api/*` in TypeScript (Hono + zod), Daten in D1.
  - Kalenderabgleich alle 15 Minuten per Cron-Trigger und nach jeder Urlaubsänderung.
  - Anmeldung weiter über Cloudflare Access (JWT wird im Worker geprüft).
- Die Web-Oberfläche bleibt unverändert; die API-Typen (`schema.d.ts`) stimmen nach dem Umbau mit der bisherigen API überein.
- Die vorhandene Python-API und ihre 148 Tests sind die **ausführbare Spezifikation**: Jede Regel und jeder Test wird in TypeScript nachgebaut.
- Einmal `wrangler deploy` genügt, danach laufen Updates mit demselben Befehl. Die Doku (`docs/deploy.md`) beschreibt den kompletten Weg.

## Nicht-Ziele / Anti-Ziele
- Keine neuen Funktionen, keine Änderung an Regeln oder Oberfläche, keine Datenbank-Migration von Altdaten.
- Kein Python Worker, keine Container, keine bezahlten Dienste.
- Die Python-API wird erst gelöscht, wenn der Worker alle Tests und den Typ-Vergleich besteht.
- Der Worker darf **nie** ohne gültige Access-Anmeldung Daten ausliefern (auch nicht über eine `workers.dev`-Adresse).

## Entscheidungen
- **Plattform:** ein Cloudflare Worker mit Static Assets, D1, Cron-Trigger, Domain `base.zpjj.de`. (Entscheidung des Auftraggebers: alles bei Cloudflare, kostenlos.)
- **Sprache und Bausteine (meine Wahl):** TypeScript, Hono mit `@hono/zod-openapi` (liefert Validierung und die OpenAPI-Beschreibung, aus der die Web-Typen erzeugt werden), vitest mit `@cloudflare/vitest-pool-workers` (echtes D1 in den Tests).
- **Datenbank:** D1 mit einer zusammengefassten Start-Migration (Stand heute, `alembic`-Historie entfällt). Datumswerte als Text `YYYY-MM-DD`, Zeitstempel als ISO-Text in UTC. D1 hat keine offenen Transaktionen: Schreibvorgänge laufen als atomarer `batch`.
- **Fehlerformat:** wie bisher `{"detail": "<deutscher Satz>"}`; auch Validierungsfehler liefern künftig einen String statt einer Liste.
- **Excel-Import, Seed, Export:** ein Node-Skript erzeugt SQL (`INSERT OR IGNORE`), das per `wrangler d1 execute` eingespielt wird. Export per `wrangler d1 export`.
- **Entwicklung:** `apps/dev.sh` startet `wrangler dev` (lokales D1, `ENV=dev`, Dev-Login), ohne Python.

## Constraints
- Kostenlose Stufe: 10 ms CPU pro Aufruf, 100.000 Anfragen pro Tag für den Worker (statische Dateien zählen nicht). Handler bleiben schlank, keine schweren Schleifen über viele Zeilen.
- Alle Geheimnisse (Access-Daten, Trello, Google-Dienstkonto) als Worker-Secrets, nie im Repo.
- `workers_dev` aus, Zugriff nur über die Access-geschützte Domain.
- Zeitzone für "heute" ist Europe/Berlin.

## Dem Builder überlassen
Ordnerstruktur im Worker, Aufteilung in Module, Test-Hilfsfunktionen, genaue Form des SQL, Tuning der Abfragen, Skript-Namen.

## Noch offen (nur der Auftraggeber kann antworten)
- Ob `zpjj.de` bei Cloudflare im DNS liegt (für die Custom Domain nötig). Der Plan geht davon aus; sonst läuft der Worker bis dahin unter einer Test-Adresse.
