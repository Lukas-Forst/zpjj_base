# ZPJJ Hub: Implementierungs-Prompt für M0 (Fundament) und M1 (Gym-Timer)

Dieser Prompt ist für Claude Code gedacht. Prosa ist deutsch, Code, Identifier, Kommentare und Commit-Messages sind englisch, **alle UI-Texte sind deutsch**.

---

## 0. Arbeitsweise

1. Lege das Repo an, skizziere kurz den Dateibaum, dann arbeite in kleinen, thematisch getrennten Commits.
2. **M0 muss vollständig grün sein** (Lint, Typecheck, Tests, Build), bevor du mit M1 beginnst.
3. Erfinde keine Fakten. Alles Unklare wird ein `TODO` im Code plus ein Eintrag in `docs/open-questions.md`.
4. Die Entscheidungen in Abschnitt 2 sind gesetzt. Weiche nur mit schriftlicher Begründung ab. Besonders wichtig: Der Hub ist **ein kleiner eigenständiger Service**, kein Monolith.
5. Keine Secrets, echten E-Mail-Adressen oder Tokens im Repo. Verwende `.env.example` und gitignorierte `*.local.*`-Dateien.
6. Am Ende lieferst du einen Kurzbericht: was gebaut ist, welche **manuellen Schritte** (Cloudflare, Fly) noch offen sind, welche Fragen offen sind.

---

## 1. Kontext

**ZPJJ** (Zero Pressure Jiu Jitsu, Offenbach am Main) ist ein BJJ-Gym. Der **ZPJJ Hub** ist eine interne PWA für das Team (Gesellschafter und Trainer, ca. 6 bis 10 Personen). Er ersetzt Excel-Pflege, WhatsApp-Zahlen und verteilte Tools durch eine gemeinsame Oberfläche.

Leitprinzipien:

- **Kleine Services, lose gekoppelt.** Der Hub liest aus bestehenden Quellen und ist nur dort Datenquelle, wo es heute weh tut (Anwesenheit).
- **Das CRM wird getrennt entwickelt** und vom Hub nur **verlinkt** (gleicher Login).
- **Google Calendar** (Urlaub) und **Trello** (Trainingsthemen) bleiben Quellen (M3/M2). Nicht Teil dieses Prompts.
- Der **Produktionsplaner** (`zpjj-produktionsplaner`, Cloudflare Pages, Access-OTP) wird später integriert (M6). Jetzt nur als externe Kachel.

Roadmap (nur zur Orientierung):

| M | Inhalt |
|---|---|
| **M0** | Fundament: Auth, Rollen, Stundenplan, App-Shell (**dieser Prompt**) |
| **M1** | Gym-Timer (**dieser Prompt**) |
| M2 | Trello-Pull und "Heute"-Ansicht |
| M3 | Urlaub über Google Calendar |
| M4 | Erfassung pro Slot (Anwesenheit, Tagebuch), Excel-Import, Auslastungs-Dashboard |
| M5 | Probetraining-Wiedererkennung und Trichter |
| M6 | Produktionsplaner-Integration |

---

## 2. Architektur (gesetzt)

**Repo `zpjj-hub`** (neu, getrennt vom Website-Repo `zpjj.de`), Monorepo:

```
apps/web   Next.js (App Router, TypeScript), HeroUI, Tailwind
apps/api   FastAPI (Python 3.12), SQLAlchemy 2, Alembic, Pydantic v2, pytest, ruff
docs/      deploy.md, data-model.md, open-questions.md
```

**Hosting und Routing**

- `apps/web` als **statischer Export** (`output: 'export'`, alle Seiten client-seitig mit Datenabruf) auf **Cloudflare Pages** unter `hub.zpjj.de`.
- `apps/api` auf **Fly.io** als eigene App (`zpjj-hub-api`), ein Volume `/data`.
- Der Browser spricht nur mit **`hub.zpjj.de/api/*`** (same origin). Eine **Pages Function** (`functions/api/[[path]].ts`) leitet an die Fly-API weiter und reicht dabei **alle Header, insbesondere `Cf-Access-Jwt-Assertion`**, durch.
- Falls der statische Export an Grenzen stößt: erst melden, bevor du auf `@cloudflare/next-on-pages` o. ä. wechselst.

**Authentifizierung (Cloudflare Access, One-Time-PIN)**

- `hub.zpjj.de` liegt hinter einer Cloudflare-Access-Application (gleiches Muster wie beim Produktionsplaner).
- Die API **validiert jeden Request** gegen `Cf-Access-Jwt-Assertion`: Signatur über JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), `aud` = Application-AUD-Tag, `iss`, `exp`. JWKS cachen (TTL 1 h, Refresh bei unbekannter `kid`).
- **Nie** nur dem E-Mail-Header vertrauen. Die E-Mail kommt aus den validierten Claims.
- Konfiguration per Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.
- Dev-Bypass nur über `AUTH_DEV_EMAIL`, und nur wenn `ENV=dev`. Ist die Variable gesetzt und `ENV` nicht `dev`, **bricht der Start ab**.
- Optional härten: Die Pages Function setzt `X-Hub-Proxy-Secret`, die API lehnt Requests ohne passendes Secret ab (Defense in Depth, da die Fly-URL öffentlich erreichbar ist).

**Autorisierung**

- Tabelle `users`: `email` (lowercase, unique), `display_name`, `role` (`gesellschafter` | `trainer`), `is_trainer` (Gesellschafter können auch Trainer sein), `active`.
- Unbekannte oder inaktive E-Mail führt zu **403** mit deutscher Meldung ("Dein Zugang ist noch nicht freigeschaltet. Bitte melde dich bei den Gesellschaftern.").
- Bootstrap: Env `BOOTSTRAP_ADMIN_EMAILS` (kommagetrennt) legt beim Start fehlende Admins als `gesellschafter` an.
- Jede Route außer `GET /healthz` verlangt gültiges JWT und bekannten Nutzer. Rollenprüfung als FastAPI-Dependency, nie nur im Frontend.

**Datenbank**

- **SQLite** (WAL, `foreign_keys=ON`) auf dem Fly-Volume, über SQLAlchemy 2 + Alembic. Keine SQLite-Spezialitäten, die einen Wechsel auf Postgres verbauen.
- Genau **eine** Maschine (`min_machines_running = 1`, kein Autoscaling über 1).
- Backups: tägliche Volume-Snapshots plus CLI `python -m app.cli export` (JSON-Dump). Beides in `docs/deploy.md` dokumentieren.
- Zeiten: Slot-Zeiten als lokale Gym-Zeit (`Europe/Berlin`), Zeitstempel (`created_at`, `updated_at`) in UTC.

**Sicherheit und Datenschutz**

- HSTS-Middleware **explizit** in FastAPI (Fly mit Custom Domain braucht das), dazu `X-Content-Type-Options`, `Referrer-Policy`, sinnvolle CSP für die Pages-Auslieferung (`_headers`).
- CORS: kein Wildcard, same-origin only.
- Keine Tracker oder Analytics. Logs enthalten User-IDs statt E-Mail-Adressen.
- Personendaten in M0/M1: nur Name und E-Mail des Teams.

---

## 3. Domänenmodell

### In M0 anlegen (Alembic-Migration)

**`users`**: siehe oben. Plus `created_at`, `updated_at`.

**`slots`**

| Feld | Typ | Hinweis |
|---|---|---|
| `id` | int PK | |
| `weekday` | int | 1 = Montag … 7 = Sonntag |
| `start_time`, `end_time` | time | lokale Zeit |
| `kind` | enum | `no_gi` \| `gi` \| `open_mat` |
| `active` | bool | Slots werden nur deaktiviert, nie hart gelöscht |
| `sort_order` | int | |

Unique auf `(weekday, start_time, kind)`.

**`slot_trainers`** (`slot_id`, `user_id`): M:N. Die Trainerliste darf leer sein (Open Mat).

### Nur dokumentieren (`docs/data-model.md`), **nicht** in M0/M1 migrieren

Damit spätere Meilensteine kompatibel bleiben:

- **`sessions`** (Einheit): `date`, `slot_id` (nullable, null bei importierter Tages-Historie), `granularity` (`slot` | `day`), `status` (`erfasst` | `nicht_erfasst` | `ausgefallen`), `count_total`, `count_guests`, Trainer über `session_trainers` mit optionalem `substitute_for_user_id`, `topic_planned_ref` (Trello-Karte), `topic_actual` (Freitext), `note`.
- **`trials`** (Probetraining-Person): `uid`, `name`, `person_kind` (`trial` | `drop_in`), `first_date`, `converted`, `member_since`, `source`, `origin`, …
- **`trial_attendance`** (`trial_id`, `session_id`).
- **Regeln:** Mitglieder = Gesamt − Probetraining − Gäste. "Nicht erfasst" ist **nicht** 0. **Mitgliedschaft fällig** = `person_kind = trial`, mindestens 2 Besuche und nicht konvertiert (1 kostenloses Probetraining).
- **Drop-ins** (`person_kind = drop_in`) zahlen pro Besuch. Sie lösen das Banner **nie** aus, zählen **nicht** im Probetraining-Trichter (sonst drücken sie die Conversion) und gehören in der Auslastung zu den **Gästen**, nicht zu den Probetrainings. Die Einstufung setzen die Gesellschafter an der Person (auch nachträglich änderbar, z. B. wenn ein Drop-in doch Mitglied wird).
- Die Importdateien (`sessions.csv`, `trials.csv`, `trial_attendance.csv`) kommen aus `import_excel.py` und haben genau diese Felder. Der Import markiert **Justus, Liam und Michael** als `drop_in` (Parameter `--drop-in`).

### Seed Stundenplan (idempotent, CLI `python -m app.cli seed-schedule`)

Quelle ist die Homepage `https://zpjj.de/schedule`. Montag ist trainingsfrei.

| Tag | Zeit | Art | Trainer |
|---|---|---|---|
| Di | 18:00–20:00 | No-Gi | Nico, Can |
| Mi | 20:00–22:00 | No-Gi | Tim, Chris |
| Do | 18:00–20:00 | No-Gi | Nico, Lukas |
| Fr | 19:00–20:30 | No-Gi | Tim, Can |
| Fr | 20:30–22:00 | Gi | Tim, Can |
| Sa | 16:00–17:30 | No-Gi | Nico, Chris |
| Sa | 17:30–19:00 | Gi | Nico, Chris |
| So | 10:00–10:45 | No-Gi | Tim, Lukas |
| So | 10:45–11:30 | Gi | Tim, Lukas |
| So | 11:30–13:00 | Open Mat | (keiner) |

Trainer werden über `apps/api/seed/users.local.yaml` (gitignored) als Nutzer angelegt (`display_name`, `email`, `role`, `is_trainer`). Committe nur `users.example.yaml` mit Platzhaltern. Der Seed bricht mit klarer Meldung ab, wenn die lokale Datei fehlt oder ein Trainername aus dem Plan keinen Nutzer hat.

---

## 4. M0: Umfang

### API

| Route | Zugriff | Zweck |
|---|---|---|
| `GET /healthz` | offen | Healthcheck |
| `GET /api/me` | alle | `{id, display_name, role, is_trainer}` |
| `GET /api/slots` | alle | aktive Slots inkl. Trainer, sortiert |
| `POST /api/slots`, `PATCH /api/slots/{id}` | Gesellschafter | anlegen, ändern, deaktivieren |
| `PUT /api/slots/{id}/trainers` | Gesellschafter | Trainerliste setzen |
| `GET/POST/PATCH /api/users` | Gesellschafter | Nutzerverwaltung (kein Löschen, nur `active=false`) |

Regeln: Der **letzte aktive Gesellschafter** kann weder deaktiviert noch herabgestuft werden. Alle Eingaben über Pydantic validieren. Das OpenAPI-Schema ist die Wahrheit für den Web-Client.

### Web

- **App-Shell:** mobile-first, HeroUI Navbar plus Drawer, **Light Mode** (einzige Ausnahme: die Timer-Seite, siehe M1). Primärfarbe Blau `#2454E0`. Das Markenrot `#D0121A` nur im Logo und als kleiner Akzent, **nie** für Buttons oder Aktionen. Fehler und destruktive Aktionen nutzen das semantische `danger`-Token von HeroUI.
- **Startseite `/`: Kacheln** (Referenz: Mockup im Projekt "ZPJJ Hub: Startseite und Timer"). Aufbau: Kopfzeile mit Logo-Platzhalter (kleines Markenrot-Rechteck plus Wortmarke "ZPJJ Hub") und Konto-Button, darunter Begrüßung mit Rolle, dann der **Gym-Timer als breite Hero-Kachel** in Primärblau, darunter ein Kachelraster mit zwei Spalten am Handy und drei bis vier ab Tablet-Breite. Jede Kachel hat Icon, Namen und eine kurze Unterzeile und ist mindestens 112 px hoch. Reihenfolge nach Nutzungshäufigkeit, Admin ganz unten.
  - Gym-Timer (aktiv ab M1, bis dahin "bald")
  - Stundenplan (aktiv, führt zu `/stundenplan`)
  - Heute, Urlaub, Anwesenheit (alle "bald", deaktiviert mit Badge)
  - Produktionsplaner (extern, `NEXT_PUBLIC_PRODUCTION_PLANNER_URL`)
  - CRM (extern, `NEXT_PUBLIC_CRM_URL`)
  - Admin (nur Gesellschafter)
  - Externe Links öffnen in neuem Tab mit `rel="noopener noreferrer"`. Fehlt die URL-Variable, wird die Kachel deaktiviert und nicht kaputt verlinkt.
  - Kachelzustände: **aktiv** (weiß, blaues Icon), **bald** (grau, nicht klickbar, Badge "bald", `aria-disabled`), **extern** (zusätzlich ↗ mit `aria-label` "Öffnet in neuem Tab"). Alle Kontraste mindestens WCAG AA.
  - **Nicht in M0:** Ab M2 kommt über den Kacheln ein schmaler **"Heute"-Streifen** (nächste Einheit mit Zeit und Trainern, Thema aus Trello, Hinweis "Zahlen von gestern fehlen" mit Button "Eintragen"). Die Kachel "Heute" entfällt dann. Das Mockup zeigt ihn mit Beispieldaten, er wird hier **nicht** gebaut.
- **`/stundenplan`:** Wochenansicht der Slots. Gesellschafter können die Trainer je Slot ändern.
- **`/admin/nutzer`:** Nutzerverwaltung (nur Gesellschafter).
- **Fehlerzustände:** eigene Seiten für 403 ("nicht freigeschaltet") und Offline.
- **PWA:** `manifest.webmanifest` (Name "ZPJJ Hub", `short_name` "ZPJJ", `theme_color` `#2454E0`, `display: standalone`, Icons 192/512 plus maskable als **Platzhalter**, markiert mit TODO "Logo ersetzen"), iOS-Meta-Tags, Service Worker (Serwist oder minimal handgeschrieben), der die App-Shell cached.
- **API-Client:** typisiert, generiert aus dem FastAPI-OpenAPI-Schema (`npm run gen:api`).

### Infrastruktur

- `apps/api/Dockerfile`, `fly.toml` (Volume, Healthcheck, eine Maschine), `.env.example` für beide Apps.
- GitHub Actions: ruff, pytest, `tsc`, eslint, Web-Build.
- `docs/deploy.md` mit **manuellen Schritten**: Access-Application für `hub.zpjj.de` anlegen (Policy: erlaubte E-Mail-Adressen, One-Time-PIN), AUD-Tag kopieren, Fly-Secrets setzen (`fly secrets set …`), Volume anlegen, DNS, Pages-Projekt mit Function.

### Tests (M0)

- **API:** JWT gültig, abgelaufen, falsches `aud`, falsche Signatur, unbekannte `kid`. Unbekannte und inaktive E-Mail liefert 403. Rollen-Guard. Schutz des letzten Gesellschafters. Seed ist idempotent. Slot-Sortierung. Start bricht ab, wenn `AUTH_DEV_EMAIL` ohne `ENV=dev` gesetzt ist.
- **Web (vitest + Testing Library):** Kachelsichtbarkeit je Rolle, deaktivierte Kachel bei fehlender URL-Variable.

### Akzeptanzkriterien M0

- [ ] `pytest`, `ruff`, `tsc`, `eslint` und Web-Build laufen grün in CI.
- [ ] Ohne gültiges Access-JWT liefert **jede** API-Route (außer `/healthz`) 401 oder 403.
- [ ] Unbekannte E-Mail sieht die 403-Seite, kein Datenleck.
- [ ] Nach `seed-schedule` zeigt `/stundenplan` genau die 10 Slots aus Abschnitt 3 mit korrekten Trainern.
- [ ] Ein Trainer sieht weder Admin-Kachel noch kann er Slots oder Nutzer ändern (UI **und** API).
- [ ] App ist auf dem Smartphone installierbar (PWA) und der Startbildschirm lädt offline.
- [ ] `docs/deploy.md` ist so vollständig, dass die manuellen Cloudflare- und Fly-Schritte ohne Rückfragen ausführbar sind.

---

## 5. M1: Gym-Timer

Route `/timer`. **Komplett client-seitig**, läuft nach dem ersten Laden **offline**.

### Modi

1. **Runden (Intervall):** Anzahl Runden, Arbeitszeit, Pause, optional Aufwärm-/Vorbereitungs-Countdown (Standard 10 s).
2. **Countdown:** eine Dauer.
3. **Stoppuhr:** hochzählend, Start/Pause/Reset.

Grenzen: Runden 1 bis 99, Zeiten bis 99:59, Pause darf 0 sein.

### Presets

- Tabelle `timer_presets` (neue Migration in M1): `id`, `name`, `mode`, `config` (JSON), `sort_order`, `created_by`, Zeitstempel.
- **Gesellschafter** verwalten Team-Presets (anlegen, ändern, löschen), alle Nutzer können sie verwenden.
- Beispiel-Presets (per Seed, **als Beispiele kennzeichnen, das Team passt sie an**): "Rolling 5 × 5:00 / 0:30 Pause", "Drill 3 × 3:00 / 0:20", "Tabata 8 × 0:20 / 0:10", "Wettkampf 5:00".
- Presets werden lokal gecached (localStorage oder IndexedDB, immer in `try/catch`). Bei Netzfehler wird der Cache genutzt. Die zuletzt verwendete Konfiguration wird lokal gemerkt.

### Verhalten

- **Zeitquelle:** absolute Endzeitpunkte auf Basis von `performance.now()`, **nicht** aufsummierte Tick-Intervalle. Tick per `setInterval` (100 ms) oder `requestAnimationFrame`. Beim `visibilitychange` wird neu berechnet. Pause und Resume dürfen keine Drift erzeugen.
- **Wake Lock** (`navigator.wakeLock`) solange der Timer läuft, Re-Acquire bei Rückkehr in den Vordergrund. Wenn nicht unterstützt, zeigt ein dezenter Hinweis "Bildschirm bitte manuell anlassen".
- **Anzeige:** Vollbild-Button, für Tablet im Querformat optimiert, Ziffern mit `tabular-nums`, sehr groß (lesbar aus mehreren Metern). Phasenlabel (VORBEREITUNG / ARBEIT / PAUSE / FERTIG) und "Runde x/N". Layout laut Mockup: Phase und Runde über den Ziffern, darunter eine Segmentleiste für den Rundenfortschritt, Hauptbutton (Start/Pause) mindestens 88 px hoch, Fußzeile mit Farblegende und Tastaturkürzeln.
- **Dunkles Theme nur für `/timer`** (blendfrei und aus der Entfernung gut lesbar): Hintergrund `#0B1220`, Flächen `#131C33`, Rahmen `#2B3A5E`, Text `#F4F7FF`, gedämpfter Text `#9FB0D6`. Der Rest der App bleibt hell.
- **Phasenfarben** ohne Markenrot: Vorbereitung Amber `#F5B942`, Arbeit Hellblau `#7FA2FF` (Label, aktives Segment) und Primärblau `#2454E0` (erledigte Segmente, Hauptbutton), Pause Slate `#64748B`. Die letzten 10 Sekunden der Arbeitsphase pulsieren dezent in Amber (respektiert `prefers-reduced-motion`). Kontrast mindestens WCAG AA.
- **Audio:** per **WebAudio synthetisiert** (keine Audiodateien nötig): drei kurze Pieptöne bei 3-2-1, langer Ton beim Phasenwechsel, doppelter Gong zum Ende. Audio wird beim ersten Start-Tap entsperrt. Lautstärkeregler und Stumm-Schalter (persistiert). Optional Vibration.
- **Steuerung:** Start/Pause/Fortsetzen, Reset, Phase überspringen (vor/zurück), ±10 s. Touch-Ziele mindestens 56 px. Tastatur: Leertaste Start/Pause, `R` Reset, `F` Vollbild, Pfeiltasten Phase überspringen.
- **Barrierefreiheit:** `aria-live="polite"` nur bei Phasenwechseln, nicht jede Sekunde.
- **Offline:** Service Worker cached `/timer` und alle Assets. Dokumentiere den manuellen Offline-Test in `docs/deploy.md`.

### Architektur

Reine **State-Machine** in `apps/web/lib/timer/engine.ts` **ohne DOM-Zugriff**, mit injizierbarer Uhr. Die UI ist nur eine Hülle darum.

### Tests (vitest, mit Fake-Clock)

Phasengenerierung für alle Modi, Pause/Resume-Genauigkeit, Überspringen, Randfälle (1 Runde, Pause 0, 99 Runden, 99:59), Rückkehr aus dem Hintergrund mit großem Zeitsprung, Ende der letzten Runde ohne Pause danach.

### Akzeptanzkriterien M1

- [ ] Engine-Tests grün, inklusive Zeitsprung-Test.
- [ ] Ein Intervall 5 × 5:00 / 0:30 läuft ohne messbare Drift (Abweichung unter 0,5 s über 30 min im Test mit Fake-Clock).
- [ ] Nach dem ersten Laden funktioniert `/timer` im Flugmodus inklusive gecachter Presets.
- [ ] Bildschirm geht während des Laufs nicht aus (wo `wakeLock` unterstützt wird), sonst erscheint der Hinweis.
- [ ] Töne kommen nach dem ersten Start-Tap zuverlässig, Stumm-Schalter wirkt sofort.
- [ ] Gesellschafter können Team-Presets pflegen, Trainer nicht (UI **und** API).
- [ ] Lesbar auf einem Tablet im Querformat aus etwa 5 m Entfernung (Ziffernhöhe mindestens 30 % der Viewport-Höhe; im Mockup `font-size` 360 px bei 820 px Höhe).

---

## 6. Nicht-Ziele (jetzt **nicht** bauen)

Trello- und Google-Calendar-Anbindung, Anwesenheitserfassung, Probetraining-Logik, Excel-Import, Produktionsplaner-Integration, CRM-Integration (nur Link), Push-Benachrichtigungen, Personenlisten von Mitgliedern.

---

## 7. Anhang

### Env-Variablen

| Variable | App | Zweck |
|---|---|---|
| `ENV` | api | `dev` \| `prod` |
| `DATABASE_URL` | api | z. B. `sqlite:////data/hub.db` |
| `CF_ACCESS_TEAM_DOMAIN` | api | z. B. `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | api | AUD-Tag der Access-Application |
| `BOOTSTRAP_ADMIN_EMAILS` | api | kommagetrennt |
| `AUTH_DEV_EMAIL` | api | nur mit `ENV=dev` |
| `HUB_PROXY_SECRET` | api, Pages Function | optionales Shared Secret |
| `FLY_API_ORIGIN` | Pages Function | Ziel-URL der Fly-API |
| `NEXT_PUBLIC_PRODUCTION_PLANNER_URL` | web | Kachel Produktionsplaner |
| `NEXT_PUBLIC_CRM_URL` | web | Kachel CRM |

### Offene Punkte (in `docs/open-questions.md` übernehmen)

- Logo-Dateien für Icons und App-Shell.
- Echte E-Mail-Adressen der Teammitglieder (nur lokal, nie im Repo).
- Soll der Stundenplan später aus der Homepage-Quelle gespeist werden statt doppelt gepflegt zu werden?
- Anfängerkurs ist ein separater Kurs und steht nicht im Wochenplan. Gehört er ins CRM (Kohorte)? Hier nicht abgebildet.
