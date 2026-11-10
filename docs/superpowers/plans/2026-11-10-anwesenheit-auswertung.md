# Anwesenheit M4b: Felder, Auswertung, Probetrainings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed attendance line by form fields, add an evaluation tab (weekly line chart, per-weekday bar chart) and a trial-person tab with a member flag, all on `/anwesenheit/`.

**Architecture:** Backend: new columns (`attendance.guests`, `trials.status`, `trials.member_since`), a structured `PUT /attendance/{day}` replacing the text line (parser and `/parse` removed), `GET /trials` + `PATCH /trials/{id}`, `GET /attendance/stats`. Web: the page becomes three tabs (Eintragen, Auswertung, Probetrainings); charts are small inline-SVG components, no chart library.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (SQLite, `op.batch_alter_table`), pytest, ruff; Next.js static export, HeroUI/Tailwind, openapi-typescript, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-11-10-anwesenheit-auswertung-design.md` (builds on `2026-11-10-anwesenheit-design.md`)

## Global Constraints

- German user-facing text, English identifiers; error `detail` always a plain German string.
- Members = Gesamt − Probetrainings − Gäste. Stored `total` = everyone on the mat in the training block (members + trials + guests). Sunday UI computes `total` from "Mitglieder" + trials + guests.
- Open mat and beginner course never enter any average or the weekly line. Cancelled days and days with `total` NULL never enter averages. "Nicht erfasst" is never 0: gaps stay gaps (`avg = null`, chart shows a gap / "–").
- Trial name fields: exactly one non-empty name per counted trial (no guessing), names ≤ 100 chars, ≤ 30 names, matched by `casefold()`. A name whose person has status `mitglied` or `zahlt_pro_besuch` is rejected as a trial with a German message naming the person.
- Guests (`zahlt pro Besuch`) are a count only, no names stored. `guests >= 0`, `trials + guests <= total`.
- `trials.status` ∈ `offen` (default), `mitglied`, `zahlt_pro_besuch`. `due` = status `offen` and ≥ 2 distinct visit dates. Setting `mitglied` sets `member_since` (default today, Berlin; changeable); any other status clears it. All reversible.
- Trial list window: persons with a visit in the last 28 days (Berlin). `due` persons are highlighted at the top ("Entscheidung fällig"), then by most recent visit.
- Stats: weekly line = last 12 ISO weeks (Mon–Sun) ending with the current week; bar chart = Ø `total` per weekday over the last 2 or 3 calendar months (`months` ∈ {2, 3}, default 3).
- Day rules from M4 stay: no future days, no day without an active slot, Berlin day.
- No new chart/npm dependency. Values are always readable as numbers (not only color/hover); light and dark mode; mobile first, touch targets `min-h-11`.
- Web must typecheck at every commit except between Task 2 and Task 3 (the API changes first and Task 3 regenerates the types and rewrites the form).
- Never commit `ZeroPressure_Retention.xlsm*` (real names). Use explicit `git add <paths>`.
- Out of scope: export, filters by trainer/course, notifications, year-over-year.

## Review Focus

- Weekday entry with trials = 2 and one empty or duplicate name → 422, nothing saved.
- A name of a person flagged `mitglied` typed as a trial → 422 whose message contains the person's name.
- A week or weekday without any recorded day → `avg: null` and a visible gap, never 0 (line must break, not dip to 0).
- A person with two visits who is `offen` but last came 6 weeks ago is not listed (window rule); a person with a third visit stays `due`.
- Same person typed in a different case, or on two days, is one person with correct `visits` (same-day twice = one visit).
- Sunday form: Mitglieder 0, Probetraining 0, Openmat 4, Anfängerkurs 15 saves `total 0`; empty Anfängerkurs stores NULL (no course), not 0.

---

### Task 1: Schema change (guests, trial status, member_since)

**Files:**
- Modify: `apps/api/app/models.py` (`Attendance`, `Trial`)
- Create: `apps/api/alembic/versions/0005_trial_status_guests.py`
- Test: `apps/api/tests/test_attendance_models.py` (extend)
- Modify: `docs/data-model.md`

**Interfaces:**
- Produces: `Attendance.guests: int` (default 0, NOT NULL, `>= 0`, CheckConstraint `total IS NULL OR trials + guests <= total`); `class TrialStatus(StrEnum)`: `offen`, `mitglied`, `zahlt_pro_besuch` (use the existing `_enum` helper, name `trial_status`); `Trial.status: TrialStatus` (default `offen`, NOT NULL); `Trial.member_since: date | None`.

- [ ] **Step 1: Write failing tests**: `test_guests_default_zero_and_bounded` (insert with `total=3, trials=1, guests=3` → `IntegrityError`; default guests is 0), `test_trial_status_default_offen`, `test_invalid_status_rejected` (insert raw status `"x"` → `IntegrityError`).
- [ ] **Step 2: Run** `cd apps/api && uv run pytest tests/test_attendance_models.py -q` → FAIL.
- [ ] **Step 3: Implement** models and migration 0005 (`down_revision = "0004"`) using `op.batch_alter_table` for SQLite; existing rows get `guests = 0`, `status = 'offen'`. Update the table descriptions in `docs/data-model.md` and reconcile its "Regeln" section with the new fields (`drop_in`/`person_kind` → `status`; `Gäste` is a count).
- [ ] **Step 4: Run** the new tests, the full suite, `uv run ruff check .`, and `uv run alembic upgrade head` on a temp DB copy of an existing populated `dev.db` (do not touch `dev.db` itself; use `sqlite:///` temp path) → pass and data preserved.
- [ ] **Step 5: Commit** `feat(api): guests on attendance, status and member_since on trials`

---

### Task 2: Structured attendance entry (replaces the text line)

**Files:**
- Modify: `apps/api/app/attendance.py`, `apps/api/app/routers/attendance.py`, `apps/api/app/schemas.py`
- Delete: `apps/api/app/attendance_parse.py`, `apps/api/tests/test_attendance_parse.py`
- Test: `apps/api/tests/test_attendance_api.py` (rewrite request bodies), `tests/test_attendance_overview.py` (adapt helpers)

**Interfaces:**
- Produces schemas: `AttendanceIn {cancelled: bool = False, total: int | None, trial_names: list[str] = [], guests: int = 0, open_mat: int | None = None, beginner: int | None = None}`; `AttendanceOut` gains `guests: int` and `members: int | None` (= total − trials − guests, None when total None) and keeps `trials`, `names`, `open_mat`, `beginner`, `cancelled`, `updated_*`.
- Produces: `@dataclass(frozen=True) class DayEntry: total: int; trial_names: list[str]; guests: int; open_mat: int | None; beginner: int | None` and `save_day(db, day, entry: DayEntry | None, user) -> Attendance` (None = cancelled). `PUT /api/attendance/{day}` takes `AttendanceIn`. `POST /api/attendance/parse` and `AttendanceParseIn/Out` are removed.
- Validation (422, German strings): cancelled → no other fields needed; otherwise `total` required, `0 <= total <= 1000`, each name stripped and non-empty, unique by casefold, count ≤ 30, length ≤ 100; `guests >= 0`; `len(names) + guests <= total`; `open_mat`/`beginner` only allowed on Sundays (else 422 "Openmat und Anfängerkurs gibt es nur sonntags."), each `0..1000`; a name belonging to a person with status `mitglied`/`zahlt_pro_besuch` → "{name} ist als Mitglied markiert und zählt nicht als Probetraining." (use "zahlt pro Besuch" wording for that status). `trials` stored = number of names.
- `save_day` keeps the M4 trial bookkeeping (orphan cleanup, never move an imported `first_date` later).

- [ ] **Step 1: Rewrite the failing tests** in `test_attendance_api.py` for the new body, keeping every M4 scenario (weekday save with `{"total": 10, "trial_names": ["David"]}` → `members == 9`; Sunday `{"total": 4, "open_mat": 4, "beginner": 15}`; replace removes orphan trial; same name other day is one person; cancelled day; future/closed day; caps; unauthenticated) and add: `test_empty_or_duplicate_name_rejected`, `test_names_exceeding_total_rejected`, `test_guests_reduce_members` (`total 10, names 1, guests 2` → `members 7`), `test_member_flagged_name_rejected` (set `status` via the DB, message contains the name), `test_open_mat_only_sunday`, `test_parse_endpoint_gone` (POST `/api/attendance/parse` → 404/405).
- [ ] **Step 2: Run** `uv run pytest tests/test_attendance_api.py tests/test_attendance_overview.py -q` → FAIL.
- [ ] **Step 3: Implement** schema, validation helper `_entry(db, day, body) -> DayEntry | None` in the router, `save_day` signature, and delete the parser module and its tests. Keep `_check_day`. Do not regenerate web types here (Task 3 does).
- [ ] **Step 4: Run** the full api suite and `uv run ruff check .` → pass.
- [ ] **Step 5: Commit** `feat(api): structured attendance entry, drop the text parser`

---

### Task 3: Trial persons API and import status

**Files:**
- Create: `apps/api/app/routers/trials.py`
- Modify: `apps/api/app/schemas.py`, `apps/api/app/main.py` (register router), `apps/api/app/import_excel.py`
- Test: `apps/api/tests/test_trials_api.py`, extend `apps/api/tests/test_import_excel.py`

**Interfaces:**
- Consumes: models (Task 1), `today_berlin`, `current_user`.
- Produces schemas: `TrialOut {id: int, name: str, status: str, first_date: date, member_since: date | None, visits: int, last_visit: date | None, due: bool, recent: bool}`; `TrialPatch {status: str, member_since: date | None = None}` (status validated against `TrialStatus`).
- Produces endpoints (prefix `/api/trials`): `GET ""` → `list[TrialOut]` (all persons; `visits` = distinct `trial_attendance` dates; `last_visit` max date or None; `due` = status `offen` and visits ≥ 2; `recent` = `last_visit` within the last 28 days up to today Berlin; ordered `due` first, then `last_visit` desc, then name). `PATCH "/{trial_id}"` → `TrialOut`: sets status; `mitglied` sets `member_since` to the given date or today; other statuses clear it; unknown id → 404 "Person nicht gefunden."; invalid status → 422.
- Import: `import_workbook` sets `status = mitglied` and `member_since` = "Anmeldedatum" (column E, may be empty → first visit date) when the "Probetrainings" tab row has `Status == "Mitglied geworden"` or `Angemeldet? == "Ja"` (column D); an existing person is only upgraded from `offen`, never downgraded. Re-running stays idempotent.

- [ ] **Step 1: Write failing tests**: `test_list_flags_due_and_recent` (person A: 2 visits yesterday-ish and 9 days ago, status offen → `due True, recent True`; person B: 2 visits 6 weeks ago → `recent False`; person C status mitglied with 3 visits → `due False`; same-day twice counts once), `test_patch_member_sets_member_since_and_clears_on_revert`, `test_patch_unknown_and_invalid`, `test_trials_require_login` (401), and in `test_import_excel.py` `test_import_maps_member_status` (row with `Status="Mitglied geworden"` and one with `Angemeldet?="Ja"` → `mitglied`, third → `offen`) plus an idempotency assertion.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** router, schemas, registration in `main.py`'s router tuple, and the import mapping.
- [ ] **Step 4: Run** the full api suite and ruff → pass. Re-run the import once against the real file into a throwaway DB (path under the session scratchpad) and report only counts (persons, members).
- [ ] **Step 5: Commit** `feat(api): trial persons list with member flag, import status`

---

### Task 4: Stats endpoint

**Files:**
- Modify: `apps/api/app/routers/attendance.py`, `apps/api/app/schemas.py`
- Test: `apps/api/tests/test_attendance_stats.py`

**Interfaces:**
- Produces schemas: `WeekPoint {week_start: date, avg: float | None, days: int}`, `StatsOut {months: int, weeks: list[WeekPoint], weekday_avg: list[WeekdayAvg]}` (reuse `WeekdayAvg`; `weekday_avg` has 7 items, weekday 1..7).
- Produces: `GET /api/attendance/stats?months=3` (`months` ∈ {2, 3}, otherwise 422). `weeks`: exactly 12 items, oldest first, Monday starts, the last one is the current ISO week; `avg` = mean `total` over that week's days with `total` set and not cancelled (rounded to 1 decimal), `days` = how many days entered the mean, `avg = None` when `days == 0`. `weekday_avg`: mean `total` per weekday over days from `today − months calendar months` (same day of month, clamped) through today, same exclusion rules. Register before `PUT /{day}`.
- Consumes: `Attendance` model only.

- [ ] **Step 1: Write failing tests**: `test_weeks_shape_and_gap` (12 items, ascending, last `week_start` is this week's Monday, a week without data has `avg None, days 0` not 0), `test_weeks_exclude_openmat_cancelled_and_null_total`, `test_weekday_window_2_vs_3_months` (an entry 80 days ago appears only with `months=3`), `test_months_validation` (`months=4` → 422), `test_stats_requires_login`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in Python over the queried rows; add a small pure helper `months_ago(today, n) -> date` with a test for month-end clamping (e.g. 31 May − 3 months).
- [ ] **Step 4: Run** full suite and ruff → pass.
- [ ] **Step 5: Commit** `feat(api): attendance stats for weekly line and weekday bars`

---

### Task 5: Tabs shell and Eintragen form

**Files:**
- Modify: `apps/web/app/anwesenheit/page.tsx`, `apps/web/lib/attendance.ts`, `apps/web/lib/api/openapi.json`, `apps/web/lib/api/schema.d.ts` (regenerate with `npm run gen:api`)
- Create: `apps/web/components/attendance/EntryForm.tsx`, `apps/web/components/attendance/Tabs.tsx`
- Test: `apps/web/tests/attendance.test.ts` (adapt), `apps/web/tests/entryform.test.tsx`

**Interfaces:**
- Consumes: API from Tasks 1–3 (`PUT /api/attendance/{day}` with `AttendanceIn`, `GET /api/attendance?days=400`, `GET /api/trials`).
- Produces: `Tabs` component (props `tabs: {id: string; label: string}[]`, `active`, `onChange`; `role="tablist"`/`role="tab"`, `min-h-11`); `EntryForm` (props `{ day: string; existing: Entry | undefined; trials: TrialOut[]; onSaved: () => void }`); pure helper in `lib/attendance.ts`: `sundayTotal(members: number, trials: number, guests: number): number`; page still reads optional `?datum=YYYY-MM-DD` and opens on the **Eintragen** tab.
- Behavior: weekday fields "Teilnehmer gesamt" (default empty), "Davon Probetraining" (default **0**), "Davon Gäste (zahlen pro Besuch)" (default 0). When Probetraining > 0, one required name input per person appears (with a `<datalist>` of known persons whose status is `offen`, option text includes visit count); reducing the number removes trailing inputs. Sunday fields: "Mitglieder (10:00–11:30)", "Davon Probetraining", "Davon Gäste", "Openmat", "Anfängerkurs (leer = kein Kurs)"; `total = sundayTotal(...)`. "Ausgefallen" and "Ersetzen"/"Speichern" behavior, confirm on replace, busy guard, error handling and the 400-day overview load stay as in M4. A server error `detail` is shown in `role="alert"`. The recent-entries list stays under the form; show `guests` and `trial names`, open mat and beginner separately.

- [ ] **Step 1: Write failing tests**: `entryform.test.tsx` — typing 2 in "Davon Probetraining" renders two name inputs and reducing to 0 removes them; saving with an empty name is blocked client-side with a German message; Sunday date shows the Sunday fields and the PUT body for members 0, trials 0, Openmat 4, Anfängerkurs 15 has `total 0, open_mat 4, beginner 15`, and an empty Anfängerkurs sends `beginner: null`; `sundayTotal(3, 1, 2)` is 6. Mock the api client.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run tests/entryform.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the components; run `npm run gen:api`; make `page.tsx` host `Tabs` with tab ids `eintragen`, `auswertung`, `probetrainings` where the last two render a "Kommt in der nächsten Aufgabe" placeholder (replaced in Tasks 6 and 7).
- [ ] **Step 4: Verify** `npm run typecheck && npm run lint && npx vitest run && npm run build` pass; with the dev stack (`apps/dev.sh`) enter a weekday with one trial and a Sunday line through the real API using curl-equivalent checks of the same body shape and say plainly if no browser run was possible.
- [ ] **Step 5: Commit** `feat(web): attendance tabs and field-based entry form`

---

### Task 6: Auswertung tab (charts)

**Files:**
- Create: `apps/web/components/attendance/WeeklyLine.tsx`, `apps/web/components/attendance/WeekdayBars.tsx`, `apps/web/components/attendance/Stats.tsx`
- Modify: `apps/web/app/anwesenheit/page.tsx` (replace placeholder)
- Test: `apps/web/tests/charts.test.tsx`

**Interfaces:**
- Consumes: `GET /api/attendance/stats?months=2|3` (`StatsOut`), the Tabs shell.
- Produces: `WeeklyLine({ weeks: WeekPoint[] })` (inline SVG polyline; a `null` avg breaks the line, no point drawn; x labels `dd.mm.` of selected weeks, last value printed as text; `role="img"` with an `aria-label` summarizing first/last value); `WeekdayBars({ data: WeekdayAvg[] })` (one row per weekday Mon–Sun as in the mockup, bar width proportional to the maximum, value as number, `–` when null); `Stats` (month toggle "2 Monate"/"3 Monate", default 3, refetches).
- Colors via CSS variables/Tailwind classes that read in light and dark mode; values always printed as numbers.

- [ ] **Step 1: Write failing tests**: `charts.test.tsx` — `WeekdayBars` renders "6,5" for 6.5 (German decimal comma) and "–" for null with no bar; `WeeklyLine` with weeks `[4, null, 6]` renders two separate path segments (assert on the `d` attributes or segment count), prints no point for the gap, and its `aria-label` mentions the last value; `Stats` toggle switches the request to `months=2`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three components (hand-written SVG, no dependency) and wire the tab.
- [ ] **Step 4: Verify** typecheck, lint, vitest, build; check the numbers against `GET /api/attendance/stats` on the dev stack with the imported Excel history.
- [ ] **Step 5: Commit** `feat(web): attendance charts tab`

---

### Task 7: Probetrainings tab

**Files:**
- Create: `apps/web/components/attendance/TrialList.tsx`
- Modify: `apps/web/app/anwesenheit/page.tsx`, `apps/web/lib/format.ts` (German relative text helper if needed)
- Test: `apps/web/tests/triallist.test.tsx`

**Interfaces:**
- Consumes: `GET /api/trials`, `PATCH /api/trials/{id}`.
- Produces: `TrialList` (shows `recent` persons only; cards: name, "N Besuche (dd.mm., dd.mm.)" or the last visit date, `due` persons first with a red "Entscheidung fällig" label and the note "Mitgliedschaft oder pro Besuch zahlen"; actions "Mitglied geworden" and "Zahlt pro Besuch" (min-h-11); persons already flagged show a label "Mitglied seit dd.mm." or "zahlt pro Besuch" and an "Rückgängig" action that sets `offen`). Each action calls PATCH and refreshes; errors in `role="alert"`; a busy guard prevents double taps. Empty state: "In den letzten 4 Wochen war niemand im Probetraining."

- [ ] **Step 1: Write failing tests**: `triallist.test.tsx` — due person is rendered before a non-due one and carries "Entscheidung fällig"; a non-`recent` person is not rendered; tapping "Mitglied geworden" sends `PATCH /api/trials/{id}` with `{status: "mitglied"}` and the card then shows "Mitglied seit"; "Rückgängig" sends `{status: "offen"}`; the empty state text.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** and wire the tab (replace the placeholder).
- [ ] **Step 4: Verify** typecheck, lint, vitest, build; on the dev stack (imported history) confirm `GET /api/trials` returns persons and a PATCH round trip works via curl, and say plainly that the page was not clicked through if no browser was available.
- [ ] **Step 5: Commit** `feat(web): trial persons tab with member flag`

---

### Task 8: Docs and cleanup

**Files:**
- Modify: `docs/data-model.md`, `docs/open-questions.md`, `docs/deploy.md` (only if import steps changed), `apps/web/components/MissingNumbers.tsx` (only if the link target needs the new tab id)

**Interfaces:** none new.

- [ ] **Step 1: Verify** that `/anwesenheit/?datum=YYYY-MM-DD` (link from the home hint) opens the Eintragen tab with that date; fix in the page if not; add a vitest case if logic is added.
- [ ] **Step 2: Update docs:** `docs/open-questions.md` (remove the line saying trial follow-up is the next phase, note what remains open: Quelle/Kontakt of trials, Trello) and make sure `docs/data-model.md` matches Tasks 1–3.
- [ ] **Step 3: Run** the whole api suite, ruff, and in `apps/web` typecheck, lint, vitest, build → pass.
- [ ] **Step 4: Commit** `docs: attendance evaluation and trial follow-up`

---

## Self-Review

- **Spec coverage:** fields with trial names and default 0 (T2, T5); guests field (T1, T2, T5); three tabs (T5–T7); line chart and 2/3-month bar chart (T4, T6); trial list with window, due flag, member flag and undo (T3, T7); import status (T3); text parser removed (T2); no chart library (T6); mobile/dark/number readability (Global Constraints, T6); questions of the spec are all answered.
- **Calls made beyond the spec:** one `GET /api/trials` (all persons, flags computed server-side) serves both the name suggestions and the tab; guests are a count only (no names); a due person whose last visit is older than 28 days is not listed (spec window rule) — flagged in Review Focus.
- **Type consistency:** `DayEntry` (T2) → `AttendanceOut.members/guests` (T2) → web `EntryForm` (T5); `TrialOut` (T3) → `EntryForm` datalist (T5) and `TrialList` (T7); `StatsOut/WeekPoint/WeekdayAvg` (T4) → charts (T6).
- **Proportion:** eight tasks, each with its own test cycle; no function bodies are spelled out where signature and tests decide them.
