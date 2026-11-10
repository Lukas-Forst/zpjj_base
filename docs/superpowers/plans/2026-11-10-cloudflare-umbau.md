# Cloudflare Umbau Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FastAPI backend (Fly.io) and the Pages proxy with one Cloudflare Worker (Hono + zod, D1, Cron Trigger, Static Assets) that serves the unchanged web app and the same API.

**Architecture:** New package `apps/worker`. `src/index.ts` exports `{ fetch, scheduled }`: `fetch` routes `/api/*` to an `OpenAPIHono` app and everything else to the static assets binding (`apps/web/out`); `scheduled` runs the calendar sync every 15 minutes. Business rules live in plain modules (`coverage.ts`, `attendance.ts`, `calsync.ts`, `trello.ts`), routers are thin. The Python API under `apps/api` stays untouched as the executable specification until Task 11.

**Tech Stack:** TypeScript, Hono, `@hono/zod-openapi`, zod, Cloudflare D1, wrangler, vitest with `@cloudflare/vitest-pool-workers`, exceljs (import script only), existing Next.js static export.

**Spec:** `docs/superpowers/specs/2026-11-10-cloudflare-umbau-design.md`

## Global Constraints

- **Behavior parity.** The Python code in `apps/api/app` and its tests in `apps/api/tests` are the specification. Port every rule, German message, status code, default and constraint. Every Python test case gets a vitest counterpart with the same inputs and assertions; each task's report lists `python test -> vitest test` pairs and names any case deliberately dropped with the reason.
- **Errors:** every non-2xx body is `{"detail": "<German sentence>"}` (also validation failures: first zod issue message). Status codes as in Python (401 "Nicht angemeldet.", 403, 404, 409, 422).
- **Routes and shapes:** identical paths, methods, status codes, JSON field names and types as the Python API, defined with `createRoute` from `@hono/zod-openapi` so `openapi.json` can be generated; schemas named like the Python Pydantic models (`SlotOut`, `AttendanceOut`, `PlanWeek`, …) so `apps/web/lib/api/schema.d.ts` regenerates with at most trivial differences.
- **D1:** dates are `YYYY-MM-DD` text, timestamps ISO-8601 UTC text, booleans 0/1. No interactive transactions: read first, then write as ONE `db.batch([...])` so a rejected or failing request never leaves partial rows. Foreign keys are enforced (`PRAGMA foreign_keys=ON` semantics of D1) and the CHECK constraints from `app/models.py` are kept.
- **Today** is the Berlin day: `todayBerlin()` using `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" })`; never `new Date().toISOString().slice(0,10)`.
- **Auth:** prod requires a valid `Cf-Access-Jwt-Assertion` (RS256 via WebCrypto, `iss = https://<team>.cloudflareaccess.com`, `aud` contains `CF_ACCESS_AUD`, `exp` required, JWKS cached 1 h with a 30 s refetch floor for unknown `kid`). `AUTH_DEV_EMAIL` is honoured only when `ENV === "dev"`; startup/first request fails closed if `AUTH_DEV_EMAIL` is set outside dev, or if `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are missing outside dev.
- **Secrets** (`wrangler secret put`): `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `BOOTSTRAP_ADMIN_EMAILS`, `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD`, `GCAL_CALENDAR_ID`, `GCAL_SERVICE_ACCOUNT_JSON`. Never in the repo. `wrangler.jsonc` sets `workers_dev: false`.
- **Free plan:** 10 ms CPU per invocation, 100,000 requests/day. Handlers do no per-row heavy work; the calendar sync reads/writes in batches. No new paid features.
- **Security headers** from `apps/web/public/_headers` apply to static assets; API responses get `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- **Real names:** never in repo, tests, docs; never commit `ZeroPressure_Retention.xlsm*`, `api_key.md`, `start.mp3:Zone.Identifier`, or `.dev.vars`. Use explicit `git add <paths>`.
- **Core module contracts** (Task 1, used by all later tasks):
  - `export type Bindings = { DB: D1Database; ASSETS: Fetcher; ENV?: string; CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; BOOTSTRAP_ADMIN_EMAILS?: string; AUTH_DEV_EMAIL?: string; TRELLO_KEY?: string; TRELLO_TOKEN?: string; TRELLO_BOARD?: string; GCAL_CALENDAR_ID?: string; GCAL_SERVICE_ACCOUNT_JSON?: string }`
  - `export type User = { id: number; email: string; display_name: string; role: "gesellschafter" | "trainer"; is_trainer: boolean; active: boolean }`
  - `export type AppEnv = { Bindings: Bindings; Variables: { user: User } }`
  - `src/db.ts`: `all<T>(db: D1Database, sql: string, ...p: unknown[]): Promise<T[]>`, `first<T>(…): Promise<T | null>`, `run(…): Promise<D1Result>`, `stmt(db, sql, ...p): D1PreparedStatement`, `batch(db, stmts: D1PreparedStatement[]): Promise<D1Result[]>`.
  - `src/errors.ts`: `class HttpError extends Error { constructor(public status: number, public detail: string) }`; the app's `onError` renders `{detail}`; the zod default hook renders 422 `{detail: <first issue message>}`.
  - `src/dates.ts`: `todayBerlin(): string`, `addDays(iso: string, n: number): string`, `isoWeekday(iso: string): number` (1 = Monday).
  - `tests/helpers.ts`: `call(path, init?: { as?: string; method?: string; json?: unknown; headers?: Record<string,string> }): Promise<Response>` (dev auth bypass header for tests), `addUser(o: { email: string; name?: string; role?: "gesellschafter" | "trainer"; is_trainer?: boolean; active?: boolean }): Promise<number>`, `addSlot(o: {...}): Promise<number>`, `resetDb(): Promise<void>`.

## Review Focus

- A rejected attendance/vacation request leaves NO partial rows in D1 (batch atomicity), e.g. a name rejected after other names were validated.
- Prod without or with a wrong/expired/foreign-audience JWT never reaches a handler; `AUTH_DEV_EMAIL` outside dev refuses to work; `workers_dev` is off.
- The vacation-change hook and the cron both run the calendar sync, a failed Google fetch changes nothing and flags `sync_state` (never deletes vacations).
- CPU budget: no route loops over all attendance/vacation rows more than once; `stats` and `plan` stay single-pass over the queried window.
- Dates: Berlin "today" around midnight UTC, week buckets across year change, `months_ago` end-of-month clamping.
- Parity of error bodies: a validation failure returns `{detail: string}`, never zod's raw structure.

---

### Task 1: Worker scaffold, schema, test harness

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/wrangler.jsonc`, `apps/worker/vitest.config.ts`, `apps/worker/src/index.ts`, `apps/worker/src/app.ts`, `apps/worker/src/db.ts`, `apps/worker/src/errors.ts`, `apps/worker/src/dates.ts`, `apps/worker/src/types.ts`, `apps/worker/migrations/0001_init.sql`, `apps/worker/tests/helpers.ts`, `apps/worker/tests/scaffold.test.ts`
- Modify: `.gitignore` (add `apps/worker/.wrangler/`, `apps/worker/.dev.vars`, `apps/worker/node_modules/`)

**Interfaces:**
- Produces: the core module contracts listed under Global Constraints; `createApp(): OpenAPIHono<AppEnv>` in `src/app.ts` (registers `/healthz`, security-header middleware, `onError`, the zod default hook; routers are mounted by later tasks via `app.route("/api/...", router)`); `export default { fetch, scheduled }` in `src/index.ts` (fetch sends `/api/*` and `/healthz` to the app, everything else to `env.ASSETS.fetch`; `scheduled` is a stub that later tasks fill).
- `wrangler.jsonc`: name `zpjj-base`, `main: src/index.ts`, current `compatibility_date`, `workers_dev: false`, `assets: { directory: "../web/out", binding: "ASSETS", run_worker_first: ["/api/*", "/healthz"], html_handling: "auto-trailing-slash", not_found_handling: "404-page" }`, `d1_databases: [{ binding: "DB", database_name: "zpjj-base", database_id: "<set at deploy>", migrations_dir: "migrations" }]`, `triggers: { crons: ["*/15 * * * *"] }`, `routes: [{ pattern: "base.zpjj.de", custom_domain: true }]`, `vars: { ENV: "prod" }`.
- `migrations/0001_init.sql`: the schema at today's head, translated from `apps/api/app/models.py` and migrations 0001–0006: `users, slots (incl. location), slot_trainers, timer_presets, vacations, substitutes, sync_state, attendance (incl. guests), trials (status, member_since), trial_attendance`, with all CHECK/UNIQUE/FK constraints, enums as TEXT + CHECK, `created_at/updated_at` as TEXT.

- [ ] **Step 1: Write failing tests** `tests/scaffold.test.ts`: `/healthz` returns `{ok: true}` with `X-Content-Type-Options: nosniff`; a non-`/api` path is served by the assets binding stub; inserting `trials > total` into `attendance` fails; inserting two trials with the same `name_key` fails; `slots` accepts a `location`; foreign keys reject a `trial_attendance` row for an unknown trial; an unknown route returns 404 `{detail: ...}`.
- [ ] **Step 2: Run** `cd apps/worker && npm test` → FAIL.
- [ ] **Step 3: Implement** the scaffold, config, `0001_init.sql` and helpers (`applyD1Migrations` in the vitest setup file, `resetDb` truncates all tables). Dependencies: `hono`, `zod`, `@hono/zod-openapi`; dev: `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `typescript`, `@cloudflare/workers-types`. Scripts: `dev`, `test`, `typecheck` (`tsc --noEmit`), `openapi` (prints the generated OpenAPI JSON to stdout, implemented in Task 8), `deploy`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS. Also `npx wrangler dev --local --port 8787` starts (run in background, curl `/healthz`, stop it).
- [ ] **Step 5: Commit** `feat(worker): scaffold Cloudflare Worker with D1 schema and test harness`

---

### Task 2: Settings, Access auth, bootstrap admins, `/api/me`

**Files:**
- Create: `apps/worker/src/config.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/routers/me.ts`
- Modify: `apps/worker/src/app.ts` (mount `me`, install the auth middleware for `/api/*`)
- Test: `apps/worker/tests/auth.test.ts`, `tests/me.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts. Specification: `apps/api/app/config.py`, `app/auth.py`, `app/main.py` (`bootstrap_admins`), `app/routers/me.py`, tests `test_auth.py` and the `/api/me` cases in `test_api.py`.
- Produces: `loadSettings(env: Bindings): Settings` and `validateSettings(s)` (throws the same messages as Python `Settings.validate`), `verifyAccessJwt(token: string, env: Bindings, fetchJwks?: typeof fetch, now?: () => number): Promise<{ email: string }>` (throws `HttpError(401, "Nicht angemeldet.")`), middleware `auth` that sets `c.var.user` (403 with `FORBIDDEN_MSG` text from Python for unknown/inactive users), `requireGesellschafter` (403 "Nur für Gesellschafter."), `ensureBootstrapAdmins(env)` (insert-or-ignore, once per isolate), `GET /api/me`.
- In tests, requests authenticate with a header `X-Test-User: <email>` that is honoured **only when** `ENV === "test"` (set by the vitest config); the JWT path itself is tested with real RSA keys generated by WebCrypto and a stubbed JWKS fetch.

- [ ] **Step 1: Write failing tests** porting `test_auth.py` case by case (valid token; expired; wrong audience; wrong issuer; unknown `kid`; JWKS refresh floor; missing header → 401; inactive user → 403; unknown user → 403 with the German text), plus: `AUTH_DEV_EMAIL` with `ENV=prod` makes validation throw; missing `CF_ACCESS_*` outside dev throws; the test-user header is ignored when `ENV !== "test"`; bootstrap admins are created once and lowercased; `/api/me` returns `MeOut` fields.
- [ ] **Step 2: Run** `npm test -- auth me` → FAIL.
- [ ] **Step 3: Implement** with WebCrypto (`crypto.subtle.importKey("jwk", …, RSASSA-PKCS1-v1_5)`, base64url decode); no JWT library needed.
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(worker): Access JWT auth, settings validation, bootstrap admins, me`

---

### Task 3: Users, slots, timer presets

**Files:**
- Create: `apps/worker/src/routers/users.ts`, `slots.ts`, `presets.ts`, `apps/worker/src/schemas/common.ts` (shared zod pieces: `SlotKind`, role enum, time strings `HH:MM:SS`)
- Modify: `apps/worker/src/app.ts` (mount)
- Test: `apps/worker/tests/users.test.ts`, `slots.test.ts`, `presets.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2. Specification: `app/routers/{users,slots,presets}.py`, `app/schemas.py` (`UserCreate/Patch/Out`, `Slot*`, `Preset*`, `RoundsConfig/CountdownConfig/StopwatchConfig`), tests `test_api.py` (users/slots parts), `test_presets.py`.
- Produces: routes under `/api/users`, `/api/slots` (incl. `PUT /{id}/trainers`, location handling: "" or null → home gym, max 50 chars), `/api/presets`; `listSlotsWithTrainers(db, opts?: { includeInactive?: boolean }): Promise<SlotRow[]>` in `src/slots.ts` (`SlotRow = { id, weekday, start_time, end_time, kind, active, sort_order, location: string | null, trainers: { id: number; display_name: string; active: boolean; is_trainer: boolean }[] }`, trainers ordered by id) used by later tasks.

- [ ] **Step 1: Write failing tests** porting the Python cases (user lifecycle and lower-casing, duplicate email 409, slot CRUD and ordering, unique `(weekday,start_time,kind)` 409, validation 422 messages, deactivate hides slot from trainers, trainer assignment rules, location create/patch/empty, preset body contract per mode, role checks 403).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the routers (each write that touches several rows is one `batch`).
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): users, slots and timer presets`

---

### Task 4: Coverage logic, vacations, coverage routes

**Files:**
- Create: `apps/worker/src/coverage.ts`, `apps/worker/src/routers/vacations.ts`, `apps/worker/src/routers/coverage.ts`
- Modify: `apps/worker/src/app.ts` (mount; export an `onVacationChange` hook slot used in Task 7)
- Test: `apps/worker/tests/coverage.test.ts` (pure), `vacations.test.ts`, `coverage-api.test.ts`, `coverage-plan.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`listSlotsWithTrainers`). Specification: `app/coverage.py`, `app/routers/{vacations,coverage}.py`, tests `test_coverage.py`, `test_coverage_api.py`, `test_coverage_plan.py`, `test_vacations.py`, `test_vacation_models.py`.
- Produces: pure `slotStatus(slot, day: string, off: Set<number>, substitutes: {slot_id:number; date:string; user_id:number}[]): { status: "nicht_geprueft"|"besetzt"|"teilweise"|"unbesetzt"|"vertreten"; absent: number[] }`, `computeGaps(slots, vacations, substitutes, today: string, days?: number): Gap[]`; routes `/api/vacations` (GET list from today−7, POST with merge of adjacent base entries, DELETE), `/api/coverage` (gaps), `/api/coverage/plan` (3 weeks, `PlanWeek[]`), `/api/coverage/substitutes` (GET/PUT/DELETE). Vacation POST/DELETE call `ctx.executionCtx.waitUntil(onVacationChange(...))` through a hook object `hooks.onVacationChange?: (c) => Promise<void>` that defaults to a no-op until Task 7.

- [ ] **Step 1: Write failing tests** porting every case of the five Python test files (gaps, partial vs full absence, substitutes clearing gaps, substitute on vacation 409, rights, past-vacation rule, overlap merge, plan weeks/past-day hiding/status per card/Rheinheim location, `nicht_geprueft` for open mat, 401s).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Overlap merge, delete-and-insert and similar multi-row changes are one `batch`.
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): coverage rules, vacations and the three-week plan`

---

### Task 5: Attendance entry and save logic

**Files:**
- Create: `apps/worker/src/attendance.ts`, `apps/worker/src/routers/attendance.ts` (PUT `/{day}` only here)
- Modify: `apps/worker/src/app.ts` (mount)
- Test: `apps/worker/tests/attendance-save.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. Specification: `app/attendance.py`, the `_entry`/`_check_day`/PUT parts of `app/routers/attendance.py`, `AttendanceIn/Out` in `app/schemas.py`, tests `test_attendance_api.py`, `test_attendance_models.py`.
- Produces: `type DayEntry = { total: number; trial_names: string[]; guests: number; open_mat: number | null; beginner: number | null }`; `validateEntry(db, day: string, body: AttendanceIn): Promise<DayEntry | null>` (null = cancelled; throws `HttpError` 422 with the exact Python messages, including the flagged-member rule and its `member_since` exception); `saveDay(db, day, entry: DayEntry | null, userId: number): Promise<void>` (all reads first, then ONE batch: upsert day, replace links, upsert trials by `name_key` casefold, orphan cleanup that never deletes non-`offen` persons and never moves an imported `first_date` later); `toAttendanceOut(db, day): Promise<AttendanceOut>`; route `PUT /api/attendance/:day`.

- [ ] **Step 1: Write failing tests** porting all of `test_attendance_api.py` (weekday/Sunday saves, replace removes orphan, same name other day = same person, cancelled day, future/closed day, caps, empty/duplicate names, names > total, guests reduce members, flagged-member rules incl. `member_since`, open mat only Sundays, input caps, imported-trial protection) and the CHECK-constraint cases of `test_attendance_models.py`; add: a request rejected by validation leaves `attendance`, `trials` and `trial_attendance` row counts unchanged.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `Slot.location IS NULL` decides open days (home gym only).
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): attendance entry with atomic save`

---

### Task 6: Attendance overview, missing day, stats, trials

**Files:**
- Modify: `apps/worker/src/routers/attendance.ts`
- Create: `apps/worker/src/routers/trials.ts`, `apps/worker/src/stats.ts`
- Test: `apps/worker/tests/attendance-overview.test.ts`, `attendance-stats.test.ts`, `trials.test.ts`

**Interfaces:**
- Consumes: Task 5. Specification: remaining parts of `app/routers/attendance.py` (`overview`, `missing`, `stats`, `months_ago`), `app/routers/trials.py`, tests `test_attendance_overview.py`, `test_attendance_stats.py`, `test_trials_api.py`.
- Produces: `GET /api/attendance` (`AttendanceOverview`, `days` 1..400 default 60), `GET /api/attendance/missing` (`MissingOut`), `GET /api/attendance/stats?months=2|3` (`StatsOut`, 12 weeks), pure `monthsAgo(today: string, n: number): string`, `GET /api/trials`, `PATCH /api/trials/:id` (`TrialOut` with `visits, last_visit, due, recent`). Routes `/missing` and `/stats` are registered before `/:day`.

- [ ] **Step 1: Write failing tests** porting all three Python files (averages exclude open mat/cancelled/null totals, gaps are `null` never 0, 12 Monday-start weeks with the current week last, window start inclusive, `months` validation 422, `monthsAgo` clamping incl. leap day, missing-day rules incl. Monday/Rheinheim/today/cancelled, trial `due`/`recent`/ordering, `member_since` semantics, 401s).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** single-pass aggregation over the window rows.
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): attendance overview, missing day, stats and trial persons`

---

### Task 7: Trello strip, Google Calendar sync, cron

**Files:**
- Create: `apps/worker/src/trello.ts`, `apps/worker/src/routers/today.ts`, `apps/worker/src/gcal.ts`, `apps/worker/src/calsync.ts`, `apps/worker/src/routers/syncStatus.ts`
- Modify: `apps/worker/src/index.ts` (`scheduled`), `apps/worker/src/app.ts` (mount, set `hooks.onVacationChange`)
- Test: `apps/worker/tests/today.test.ts`, `calsync.test.ts`, `gcal.test.ts`, `sync-status.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. Specification: `app/trello.py`, `app/routers/today.py`, `app/gcal.py`, `app/calsync.py`, `app/routers/sync_status.py`, tests `test_today.py`, `test_calsync.py`, `test_sync_status.py`.
- Produces: `parseWeek(desc)`, `findCard`, `weekData` as in Python; `GET /api/today` (`TodayOut`, 10-minute in-memory cache per isolate); `interface CalendarClient { listEvents(min: string, max: string): Promise<CalEvent[]>; create(title: string, start: string, endInclusive: string, baseId: number): Promise<string>; update(id: string, start: string, endInclusive: string): Promise<void>; delete(id: string): Promise<void> }`; `class GoogleCalendar implements CalendarClient` (service-account JWT signed RS256 with WebCrypto from the PKCS8 key in `GCAL_SERVICE_ACCOUNT_JSON`, token cached until shortly before expiry, REST calls via `fetch`); `matchUser`, `parseEvent`, `firstWord` (pure); `syncCalendar(db, client, today: string, nowIso: string): Promise<void>` (rules and failure semantics exactly as `calsync.sync`: failed fetch changes nothing and flags `sync_state`); `scheduled` handler runs it every 15 min when Google is configured; `GET /api/sync-status` (`SyncOut`).

- [ ] **Step 1: Write failing tests** porting the three Python files (Trello parsing incl. bold weekday headers/month theme/markdown marks, card lookup only in "Technik", cache and error status values; calendar matching, ambiguous names, exclusive all-day end, base entries restored when edited by hand, calendar-origin entries removed only after a successful fetch, unmatched list, error flagging); add: JWT creation for the service account is verifiable with the public key, the sync is a no-op without configuration, a vacation POST triggers one sync via the hook.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Fake `CalendarClient` and a stubbed `fetch` in tests.
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): Trello strip, Google Calendar sync and cron trigger`

---

### Task 8: OpenAPI contract parity with the web app

**Files:**
- Create: `apps/worker/scripts/openapi.ts`
- Modify: `apps/worker/package.json` (`openapi` script), `apps/web/package.json` (`gen:api` reads the worker's OpenAPI instead of running Python), `apps/web/lib/api/openapi.json`, `apps/web/lib/api/schema.d.ts`
- Test: `apps/worker/tests/openapi.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7 (all routes registered with `createRoute`).
- Produces: `npm run openapi` in `apps/worker` prints the OpenAPI 3 document of the full app (all `/api/*` routes, no auth needed); `npm run gen:api` in `apps/web` regenerates `schema.d.ts` from it.

- [ ] **Step 1: Write failing test** `openapi.test.ts`: the generated document contains every path+method the Python app has (list them from the Python route table in the task brief: me, users, slots, presets, today, vacations, coverage incl. plan and substitutes, sync-status, attendance incl. missing and stats, trials), and every schema name the web imports (`components["schemas"][…]` names found with a grep of `apps/web` sources must all exist).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the script and `gen:api` change; regenerate the web types. Then run in `apps/web`: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`. Differences between the old and new `schema.d.ts` are fixed in the Worker schemas (preferred) or, if only cosmetic (ordering, descriptions), accepted; a diff in a field type/optionality that the web uses is a bug in the Worker. Put the diff summary in the report.
- [ ] **Step 4: Run** all of the above → PASS.
- [ ] **Step 5: Commit** `feat: generate web API types from the Worker's OpenAPI`

---

### Task 9: Seed, import and export tooling

**Files:**
- Create: `apps/worker/scripts/seed.ts`, `apps/worker/scripts/import-excel.ts`, `apps/worker/seed/users.example.yaml` (copy of the API's), `apps/worker/src/seedSql.ts`, `apps/worker/src/importSql.ts`
- Modify: `apps/worker/package.json` (scripts `seed`, `import-excel`; dev deps `exceljs`, `yaml`), `.gitignore` (`apps/worker/seed/users.local.yaml`, `apps/worker/*.sql` outputs)
- Test: `apps/worker/tests/seed.test.ts`, `import.test.ts`

**Interfaces:**
- Consumes: Task 1 schema. Specification: `app/cli.py` (`SCHEDULE`, `RHEINHEIM`, `seed_schedule`, `seed_presets`), `app/import_excel.py` and its tests.
- Produces: `buildSeedSql(users: {email,display_name,role,is_trainer}[]): string` and `buildImportSql(workbook rows…): string` as pure functions emitting idempotent `INSERT OR IGNORE`/guarded statements; CLI: `npm run seed -- --users seed/users.local.yaml > seed.sql` and `npm run import-excel -- ../../ZeroPressure_Retention.xlsm > import.sql`, applied with `wrangler d1 execute zpjj-base --remote --file=…` (documented in Task 10). Seed keeps the schedule incl. Rheinheim (Mo/Mi 19:30–21:30 No-Gi, Nico / Tim) and the Mi 20:00 slot with Chris only, plus the four example presets.

- [ ] **Step 1: Write failing tests**: seeding twice into the test D1 yields the same 12 slots and 5 users; Mi base slot has only Chris; the two Rheinheim slots carry location `Rheinheim`; unknown trainer name aborts without partial output; import of a small generated workbook (via exceljs in the test) gives imported days, skipped rows without a count, open-mat-only rows with `total` NULL, trial persons with member status from "Mitglied geworden"/"Angemeldet? = Ja", never overwrites an existing day, running the SQL twice changes nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Acceptance on the real file (path `/home/terma/zpjj_hub/ZeroPressure_Retention.xlsm`, never printed names): generate SQL, apply to a throwaway local D1 (`wrangler d1 execute --local --persist-to <scratch dir>`), report counts only — expected 136 days, 38 skipped, 35 trial persons, 3 members; applying twice adds nothing.
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(worker): seed, Excel import and export tooling for D1`

---

### Task 10: Local dev, CI and deployment docs

**Files:**
- Modify: `apps/dev.sh`, `.github/workflows/ci.yml`, `docs/deploy.md`, `docs/data-model.md`, `docs/open-questions.md`
- Delete: `apps/dev_proxy.py`, `apps/web/functions/api/[[path]].ts` (and the empty `functions` dir)

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: `apps/dev.sh` builds the web app, applies migrations to a local D1 (`wrangler d1 migrations apply --local`), seeds it from `seed/users.local.yaml` (or the example), starts `wrangler dev --local --var ENV:dev --var AUTH_DEV_EMAIL:… --var BOOTSTRAP_ADMIN_EMAILS:… --var TRELLO_*` on port 3000 with Trello values from `api_key.md` if present, and prints the URL; CI jobs `worker` (npm ci, typecheck, test) and `web` (as before), no Python job; `docs/deploy.md` rewritten for Cloudflare in German: prerequisites (account, domain in Cloudflare DNS, `wrangler login`), `wrangler d1 create zpjj-base` and copying `database_id`, `wrangler d1 migrations apply zpjj-base --remote`, secrets via `wrangler secret put`, Access application on `base.zpjj.de` (AUD tag, team domain) **created before the first deploy**, build web then `wrangler deploy`, seed and Excel import via the Task 9 scripts, flagging pay-per-visit persons in the app, Wednesday Tim removal note, Trello and Google Calendar sections adapted (secrets instead of `fly secrets`), backups (`wrangler d1 export`, D1 Time Travel), offline test, the free-plan limits, and a troubleshooting list (403 from Access, missing secrets, cron not firing).

- [ ] **Step 1: Implement** the changes. No new unit tests; verification is below.
- [ ] **Step 2: Verify locally:** run `apps/dev.sh` in the background, wait for readiness, then with curl: `/` and `/anwesenheit/` return 200 HTML from assets with the security headers; `/healthz`; `/api/me` returns the dev user; PUT an attendance day for a past Wednesday and read it back via `/api/attendance`; `/api/coverage/plan` returns 3 weeks; `/sounds/start.mp3` is served; `POST /api/vacations` triggers no error without Google configured. Stop only the processes you started (note their pids).
- [ ] **Step 3: Run** `npm run typecheck && npm test` in `apps/worker`, and typecheck, lint, vitest, build in `apps/web` → PASS.
- [ ] **Step 4: Commit** `chore: local dev, CI and deployment docs for Cloudflare`

---

### Task 11: Retire the Python API

**Files:**
- Delete: `apps/api/` (entire directory including `fly.toml`, `Dockerfile`, `pyproject.toml`, `uv.lock`, tests, alembic, seed)
- Modify: `.gitignore` (drop Python entries), `docs/data-model.md`, `docs/deploy.md`, `docs/open-questions.md` (remove Fly/Python mentions), repo-wide search for `apps/api`, `fly`, `uvicorn`, `alembic`, `pytest`

**Interfaces:**
- Consumes: Task 10 green (CI jobs pass, the parity table from Tasks 3–9 reports shows every Python test mapped).

- [ ] **Step 1: Pre-flight:** list every Python test function name (`grep -rn "^def test_" apps/api/tests`) and check that each appears in a task report as mapped or consciously dropped; stop and report if one is missing.
- [ ] **Step 2: Delete** `apps/api` and clean references (`grep -rn "apps/api\|uv run\|fly " --include=*.md --include=*.json --include=*.yml --include=*.sh .`).
- [ ] **Step 3: Run** worker typecheck + tests, web typecheck/lint/vitest/build, and `apps/dev.sh` smoke from Task 10 → PASS.
- [ ] **Step 4: Commit** `chore: remove the Python API (replaced by the Cloudflare Worker)`

---

## Self-Review

- **Spec coverage:** one Worker for UI and API (T1, T10), same rules and routes via ported tests (T2–T7), D1 schema (T1), cron and hook sync (T7), Access auth and fail-closed settings (T2), unchanged web types (T8), seed/import/export (T9), dev/CI/docs (T10), Python retirement only after parity (T11). The spec's open question (domain in Cloudflare DNS) is a deploy-time prerequisite documented in T10.
- **Type consistency:** `Bindings/User/AppEnv/db helpers` (T1) are used by every later task; `listSlotsWithTrainers` (T3) feeds T4; `DayEntry/saveDay` (T5) feed T6; `CalendarClient` (T7) is the seam for tests; schema names match the Pydantic names so T8 can diff the web types.
- **Proportion:** eleven tasks, each with its own test cycle; Python sources are referenced instead of transcribed.
