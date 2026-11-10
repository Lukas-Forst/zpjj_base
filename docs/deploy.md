# Deployment

Browser → `base.zpjj.de` (Cloudflare Pages, statisch, hinter Cloudflare Access) → Pages Function `/api/*` → Fly-App `zpjj-base-api` (SQLite auf Volume `/data`).

## 1. Cloudflare Access (manuell)
1. Zero Trust → Access → Applications → *Self-hosted* → Domain `base.zpjj.de`.
2. Policy *Allow*: Include → Emails (die Team-Adressen). Login-Methode: **One-time PIN**.
3. Nach dem Speichern den **Application Audience (AUD) Tag** kopieren (Overview).
4. Team-Domain notieren: `<team>.cloudflareaccess.com`.

## 2. Fly.io (manuell)
```bash
cd apps/api
fly apps create zpjj-base-api
fly volumes create base_data --region fra --size 1     # genau ein Volume, eine Maschine
fly secrets set \
  CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com \
  CF_ACCESS_AUD=<AUD-Tag> \
  BOOTSTRAP_ADMIN_EMAILS=<admin1@…,admin2@…> \
  BASE_PROXY_SECRET=$(openssl rand -hex 32)
fly deploy
fly scale count 1
```
`ENV=prod` und `DATABASE_URL=sqlite:////data/base.db` setzt das Dockerfile. Migrationen laufen beim Start (`alembic upgrade head`).
Die API bricht beim Start ab, wenn `AUTH_DEV_EMAIL` gesetzt und `ENV` nicht `dev` ist, oder wenn `CF_ACCESS_*` fehlt.

**Stundenplan seeden** (einmalig, idempotent): `apps/api/seed/users.local.yaml` aus `users.example.yaml` anlegen (echte Adressen, nicht committen), dann
```bash
fly ssh sftp shell      # put seed/users.local.yaml /srv/seed/users.local.yaml
fly ssh console -C "python -m app.cli seed-schedule"
fly ssh console -C "python -m app.cli seed-presets"   # 4 Beispiel-Presets ("(Beispiel)"), das Team passt sie im Timer an
```

## 3. Cloudflare Pages (manuell)
1. Pages-Projekt anlegen (Direct Upload oder Git). Build in `apps/web`: `npm ci && npm run build`, Output `out`.
2. Die Function liegt in `apps/web/functions/api/[[path]].ts` (Wurzel = `apps/web`). Deploy per CLI: `cd apps/web && npx wrangler pages deploy out --project-name zpjj-base` (wrangler nimmt `./functions` aus dem aktuellen Verzeichnis).
3. Environment Variables (Pages → Settings): `FLY_API_ORIGIN=https://zpjj-base-api.fly.dev`, `BASE_PROXY_SECRET=<gleicher Wert wie in Fly>`. Build-Variablen: `NEXT_PUBLIC_PRODUCTION_PLANNER_URL`, `NEXT_PUBLIC_CRM_URL` (fehlen sie, sind die Kacheln deaktiviert).
4. Custom Domain `base.zpjj.de` am Pages-Projekt, DNS (CNAME) legt Cloudflare an. Die Access-Application aus Schritt 1 schützt diese Domain.

## 4. Backups
- Fly legt tägliche Volume-Snapshots an (`snapshot_retention = 14` in `fly.toml`). Wiederherstellen: `fly volumes snapshots list`, `fly volumes create base_data --snapshot-id …`.
- JSON-Dump: `fly ssh console -C "python -m app.cli export" > base-export.json`.

## 5. Manueller Offline-Test (PWA und Timer)
1. `base.zpjj.de` am Handy/Tablet öffnen, einmal komplett laden (Startseite, danach `/timer/`).
2. Chrome: Menü → *App installieren* (iOS: Teilen → *Zum Home-Bildschirm*).
3. Flugmodus an, App neu starten: Startseite lädt, `/timer/` läuft inkl. gecachter Presets.
4. Kontrolle in DevTools → Application → Service Workers / Cache Storage `base-v1`.
Hinweis: Ist die Access-Session abgelaufen, braucht der erste Aufruf wieder Netz (One-Time-PIN).

## Trello ("Heute"-Streifen, M2)

Nur lesend. Fly-Secrets setzen (nie ins Repo):
`fly secrets set TRELLO_KEY=… TRELLO_TOKEN=… TRELLO_BOARD=<Board-ID oder Shortlink> -a zpjj-base-api`
Token mit `read`-Scope: `https://trello.com/1/authorize?key=<KEY>&scope=read&expiration=never&response_type=token&name=ZPJJ%20Base`.
Erwartet: Liste "Technik", Karte "Woche NN" (ISO-Kalenderwoche), Beschreibung mit Zeilen "Montag" … "Sonntag" und optional "Folgewoche: …". Ohne die drei Variablen bleibt der Streifen unsichtbar. Cache 10 Minuten im Speicher.

## Google Calendar (Urlaub, M3)

Die Base gleicht Urlaub in beide Richtungen mit einem gemeinsamen Kalender ab (Termine "Vorname Urlaub", ganztägig). Ohne die zwei Variablen unten ist der Abgleich aus und die App läuft normal.

1. In der Google Cloud Console ein Projekt anlegen und die **Google Calendar API** aktivieren.
2. Unter "IAM & Verwaltung → Dienstkonten" ein **Service-Account** anlegen, dann "Schlüssel → Neuen Schlüssel erstellen → JSON". Die Datei nie ins Repo legen.
3. Den Kalender in Google Calendar öffnen: Einstellungen und Freigabe → "Für bestimmte Personen freigeben" → die E-Mail des Service-Accounts (`…@….iam.gserviceaccount.com`) mit **"Änderungen an Terminen vornehmen"** hinzufügen. Die Kalender-ID steht unter "Kalender integrieren".
4. Secrets setzen:
   `fly secrets set GCAL_CALENDAR_ID=<Kalender-ID> GCAL_SERVICE_ACCOUNT_JSON="$(cat schluessel.json)" -a zpjj-base-api`
5. Prüfen: Auf der Seite `/urlaub/` Urlaub eintragen, der Termin erscheint im Kalender. Bei Problemen zeigt die Base "Kalender-Sync fehlgeschlagen seit …" (Abgleich alle 15 Minuten und nach jeder Änderung).

Verhalten: Von der Base angelegte Termine werden bei Löschung oder Änderung von Hand im Kalender wiederhergestellt. Von Hand angelegte "Vorname Urlaub"-Termine werden eingelesen. Nicht zuordenbare Titel erscheinen unter "Nicht zugeordnete Kalendereinträge".

## Lokal testen

`apps/dev.sh` baut die Oberfläche, legt `apps/api/dev.db` an, seedet den Stundenplan (mit den Platzhalter-Nutzern aus `users.example.yaml`, falls `users.local.yaml` fehlt) und startet API (:8000) und Oberfläche (:3000), eingeloggt als `lukas@example.invalid` (änderbar mit `AUTH_DEV_EMAIL=…`). Trello-Werte liest das Skript aus `api_key.md` (`TRELLO_KEY=`, `TRELLO_TOKEN=`). Nach Frontend-Änderungen das Skript neu starten.

## Anwesenheit: Excel-Import (einmalig)

Die alte Excel-Historie wird einmal importiert (vorhandene Tage bleiben unberührt, mehrfaches Ausführen ist unschädlich):

1. Datei hochladen: `fly ssh sftp shell -a zpjj-base-api`, dort `put ZeroPressure_Retention.xlsm /tmp/ZeroPressure_Retention.xlsm`.
2. Import starten: `fly ssh console -a zpjj-base-api -C "python -m app.cli import-excel /tmp/ZeroPressure_Retention.xlsm"` (gibt Zähler `days`, `skipped`, `trials` aus).
3. Datei danach löschen: `fly ssh console -a zpjj-base-api -C "rm /tmp/ZeroPressure_Retention.xlsm"`.

Die Excel-Datei enthält echte Namen und gehört nie ins Repo.
