# Deployment

Browser → `base.zpjj.de` (Cloudflare Access) → ein Cloudflare Worker `zpjj-base` (liefert `/api/*` und die statische Oberfläche aus `apps/web/out`) → D1-Datenbank `zpjj-base`. Alles in `apps/worker`, Befehle laufen dort (`cd apps/worker`).

**Wichtige Warnungen**
- `ENV` darf auf dem Produktiv-Worker **nie** auf `test` oder `dev` stehen. `ENV=test` ließe jeden per Header einloggen, `dev` beachtet `AUTH_DEV_EMAIL`. Erlaubt ist nur der Wert `prod` aus `wrangler.jsonc`. Kein `wrangler secret put ENV`, keine Variable im Dashboard, kein `--var` beim Deploy.
- Der Worker darf nicht über `workers.dev` erreichbar sein (`"workers_dev": false` in `wrangler.jsonc` lassen). Die Access-Application muss die Custom Domain `base.zpjj.de` abdecken, sonst ist die API ohne Login-Schutz der Domain nur durch die JWT-Prüfung gesichert.
- Zwischen dem ersten `wrangler deploy` und dem Setzen der Secrets antwortet der Worker mit 500 (fail closed): Die Einstellungsprüfung läuft nicht ohne `CF_ACCESS_*`. Sichere Reihenfolge: erst Secrets mit `wrangler secret put` setzen (das legt den Worker bei Bedarf an), dann deployen. Wer zuerst deployt, nimmt die 500er bis zum Setzen der Secrets in Kauf.

## 0. Voraussetzungen
1. Cloudflare-Account, Domain `zpjj.de` liegt in Cloudflare DNS.
2. Node 22, dann `cd apps/worker && npm ci && npx wrangler login`.

## 1. Cloudflare Access (VOR dem ersten Deploy)
1. Zero Trust → Access → Applications → *Self-hosted* → Domain `base.zpjj.de`.
2. Policy *Allow*: Include → Emails (die Team-Adressen). Login-Methode: **One-time PIN**.
3. Nach dem Speichern den **Application Audience (AUD) Tag** kopieren (Overview).
4. Team-Domain notieren: `<team>.cloudflareaccess.com`.

## 2. Datenbank (D1)
```bash
cd apps/worker
npx wrangler d1 create zpjj-base          # gibt database_id aus
```
1. `database_id` in `apps/worker/wrangler.jsonc` statt `<set at deploy>` eintragen und committen (die ID ist kein Geheimnis).
2. Migrationen anwenden: `npx wrangler d1 migrations apply zpjj-base --remote`. Neue Migrationen (SQL-Dateien in `apps/worker/migrations`) nach jeder Änderung am Schema mit demselben Befehl einspielen, vor dem Deploy.

## 3. Secrets
```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN    # <team>.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD            # AUD-Tag aus Schritt 1
npx wrangler secret put BOOTSTRAP_ADMIN_EMAILS   # admin1@…,admin2@…
```
Jeder Befehl fragt den Wert interaktiv ab (nie ins Repo). Trello und Google Calendar siehe unten. `AUTH_DEV_EMAIL` und `ENV` nie setzen.

## 4. Deployen
```bash
cd apps/web && npm ci && npm run build      # erzeugt apps/web/out
cd ../worker && npx wrangler deploy
```
Der Deploy legt den Cron-Trigger (alle 15 Minuten, Kalender-Abgleich) und die Custom Domain `base.zpjj.de` an (DNS-Eintrag macht Cloudflare). Optional beim Web-Build: `NEXT_PUBLIC_PRODUCTION_PLANNER_URL`, `NEXT_PUBLIC_CRM_URL` (fehlen sie, sind die Kacheln deaktiviert). Danach `https://base.zpjj.de/healthz` prüfen (nach dem Access-Login).

## 5. Stundenplan seeden (einmalig, idempotent)
`apps/worker/seed/users.local.yaml` aus `users.example.yaml` anlegen (echte Adressen, nicht committen), dann
```bash
cd apps/worker
npm run seed > seed.sql        # nimmt users.local.yaml, sonst users.example.yaml
npx wrangler d1 execute zpjj-base --remote --file seed.sql
rm seed.sql
```
Der Seed legt auch die zwei Rheinheim-Einheiten an (Mo und Mi, 19:30–21:30 No-Gi, Ort "Rheinheim"). Bestehende Einheiten fasst er nicht an: Auf einem schon befüllten System danach auf der Seite **Stundenplan** beim Mittwoch 20:00 (Hauptstandort) Tim als Trainer entfernen, sodass nur Chris übrig bleibt.

## 6. Anwesenheit: Excel-Import (einmalig)
Die Datei liegt lokal, es wird nichts hochgeladen. Vorhandene Tage bleiben unberührt, mehrfaches Ausführen ist unschädlich:
```bash
cd apps/worker
npm run import-excel -- ../../ZeroPressure_Retention.xlsm > import.sql   # Zähler auf stderr
npx wrangler d1 execute zpjj-base --remote --file import.sql
rm import.sql
```
Nach dem Import haben die Probetrainierenden den Status `offen` (im Excel als Mitglied markierte: `mitglied`). Wer pro Besuch zahlt, markierst du danach in der App (Tab Probetrainings), damit diese Personen keinen Mitgliedschafts-Hinweis auslösen. Die Excel-Datei und die SQL-Dateien enthalten echte Namen und gehören nie ins Repo.

## 7. Trello ("Heute"-Streifen)
Nur lesend. Secrets setzen (nie ins Repo):
```bash
npx wrangler secret put TRELLO_KEY
npx wrangler secret put TRELLO_TOKEN
npx wrangler secret put TRELLO_BOARD     # Board-ID oder Shortlink
```
Token mit `read`-Scope: `https://trello.com/1/authorize?key=<KEY>&scope=read&expiration=never&response_type=token&name=ZPJJ%20Base`.
Erwartet: Liste "Technik", Karte "Woche NN" (ISO-Kalenderwoche), Beschreibung mit Zeilen "Montag" … "Sonntag" und optional "Folgewoche: …". Ohne die drei Secrets bleibt der Streifen unsichtbar. Cache 10 Minuten im Speicher des Workers.

## 8. Google Calendar (Urlaub)
Die Base gleicht Urlaub in beide Richtungen mit einem gemeinsamen Kalender ab (Termine "Vorname Urlaub", ganztägig). Ohne die zwei Secrets unten ist der Abgleich aus und die App läuft normal.

1. In der Google Cloud Console ein Projekt anlegen und die **Google Calendar API** aktivieren.
2. Unter "IAM & Verwaltung → Dienstkonten" ein **Service-Account** anlegen, dann "Schlüssel → Neuen Schlüssel erstellen → JSON". Die Datei nie ins Repo legen.
3. Den Kalender in Google Calendar öffnen: Einstellungen und Freigabe → "Für bestimmte Personen freigeben" → die E-Mail des Service-Accounts (`…@….iam.gserviceaccount.com`) mit **"Änderungen an Terminen vornehmen"** hinzufügen. Die Kalender-ID steht unter "Kalender integrieren".
4. Secrets setzen:
   ```bash
   npx wrangler secret put GCAL_CALENDAR_ID
   npx wrangler secret put GCAL_SERVICE_ACCOUNT_JSON < schluessel.json
   ```
5. Prüfen: Auf der Seite `/urlaub/` Urlaub eintragen, der Termin erscheint im Kalender. Bei Problemen zeigt die Base "Kalender-Sync fehlgeschlagen seit …" (Abgleich alle 15 Minuten per Cron und nach jeder Änderung).

Verhalten: Von der Base angelegte Termine werden bei Löschung oder Änderung von Hand im Kalender wiederhergestellt. Von Hand angelegte "Vorname Urlaub"-Termine werden eingelesen. Nicht zuordenbare Titel erscheinen unter "Nicht zugeordnete Kalendereinträge".

## 9. Backups
- Export: `npx wrangler d1 export zpjj-base --remote --output backup.sql` (enthält echte Daten, nicht committen). Regelmäßig ablegen, z. B. vor jeder Migration.
- D1 Time Travel: Wiederherstellung auf einen Zeitpunkt der letzten 30 Tage (Free-Plan: 7 Tage). Stand abfragen: `npx wrangler d1 time-travel info zpjj-base`, zurückspielen: `npx wrangler d1 time-travel restore zpjj-base --timestamp=<ISO-Zeit>`.

## 10. Lokal testen
`apps/dev.sh` baut die Oberfläche, legt eine lokale D1 in `apps/worker/.wrangler` an (Migrationen, Seed mit den Platzhalter-Nutzern aus `users.example.yaml`, falls `users.local.yaml` fehlt) und startet `wrangler dev --local` auf `http://localhost:3000`, eingeloggt als `lukas@example.invalid` (änderbar mit `AUTH_DEV_EMAIL=…`, Port mit `PORT=…`). Trello-Werte liest das Skript aus `api_key.md` (`TRELLO_KEY=`, `TRELLO_TOKEN=`). Nach Frontend-Änderungen das Skript neu starten.

## 11. Manueller Offline-Test (PWA und Timer)
1. `base.zpjj.de` am Handy/Tablet öffnen, einmal komplett laden (Startseite, danach `/timer/`).
2. Chrome: Menü → *App installieren* (iOS: Teilen → *Zum Home-Bildschirm*).
3. Flugmodus an, App neu starten: Startseite lädt, `/timer/` läuft inkl. gecachter Presets.
4. Kontrolle in DevTools → Application → Service Workers / Cache Storage `base-v1`.
Hinweis: Ist die Access-Session abgelaufen, braucht der erste Aufruf wieder Netz (One-Time-PIN).

## 12. Free-Plan-Grenzen
- Worker: 100.000 Anfragen pro Tag, 10 ms CPU pro Aufruf (statische Dateien zählen nicht dazu). Für das Team reicht das deutlich.
- D1: 5 GB Speicher, 5 Mio. gelesene und 100.000 geschriebene Zeilen pro Tag.
- Cron: 15-Minuten-Takt belegt einen Cron-Trigger (Free-Plan erlaubt 5).
Aktuelle Werte in der Cloudflare-Doku prüfen; bei Überschreitung antwortet der Worker mit Fehlern bis zum nächsten Tag.

## 13. Fehlersuche
- **403 von Access** (Cloudflare-Seite statt der App): E-Mail steht nicht in der Policy, oder die Application deckt `base.zpjj.de` nicht ab.
- **403 "…" der App**: Die E-Mail ist angemeldet, aber kein aktiver Nutzer. Über `BOOTSTRAP_ADMIN_EMAILS` oder die Seite Nutzer anlegen.
- **401 "Nicht angemeldet."**: Kein oder ungültiges Access-JWT. `CF_ACCESS_AUD` und `CF_ACCESS_TEAM_DOMAIN` mit der Application vergleichen (`npx wrangler secret list`).
- **500 auf allen Seiten unter `/api`**: Secrets fehlen (`CF_ACCESS_*`) oder `AUTH_DEV_EMAIL`/`ENV` sind falsch gesetzt. Logs: `npx wrangler tail`.
- **Weiße Seite / 404 auf Unterseiten**: `apps/web` nicht vor `wrangler deploy` gebaut (`apps/web/out` leer oder alt).
- **Cron läuft nicht**: Im Dashboard unter Worker → Settings → Triggers den Cron `*/15 * * * *` prüfen, `npx wrangler tail` bei der vollen Viertelstunde beobachten. Ohne `GCAL_*`-Secrets tut der Lauf bewusst nichts.
- **"Kalender-Sync fehlgeschlagen"**: Kalender-Freigabe für den Service-Account und `GCAL_*`-Secrets prüfen.
