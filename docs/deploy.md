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
