# Anwesenheit (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coaches type the chat line (`10 1 (David)`, `0 0 4 (15)`) into the Base, which stores attendance per day, keeps trial names as people, hints at missing numbers on the home page and imports the Excel history once.

**Architecture:** A pure parser turns the line into counts and names. A new FastAPI router `attendance` validates, saves one row per day (`attendance`) plus trial people (`trials`, `trial_attendance`), and serves a small overview and the "missing day". The web side adds the page `/anwesenheit/`, a hint component on the home page and activates the tile. The Excel import is a CLI command.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, SQLite, pytest, ruff; Next.js static export, HeroUI, openapi-typescript, vitest; openpyxl (new, import only).

**Spec:** `docs/superpowers/specs/2026-11-10-anwesenheit-design.md`

## Global Constraints

- German user-facing text; code and identifiers English (follow existing files).
- "Heute" is the Berlin day: use `app.dates.today_berlin()`. Entries only for today or the past, never the future.
- Wochentage: line = `Gesamt [Probetrainings] [(Name, Name)]`, Gesamt includes trials, missing trials = 0.
- Sonntag: line = `Mitglieder Probetrainings Openmat [(Anfängerkurs)]`. Exactly three numbers. Brace with a number = Anfängerkurs, brace with text = names (comma separated). No beginner brace = no course.
- Members = Gesamt − Probetrainings. Open mat and beginner course never count toward the day's Gesamt.
- "Nicht erfasst" is never 0. "Ausgefallen" is neither 0 nor missing.
- Montag (no active slot) is closed: no entry, never flagged as missing.
- More trials than total, empty input, or input not matching the format: reject with a German message, never guess.
- Trial names match case-insensitively (`casefold`) and are one person across days.
- Any signed-in user may create/replace entries; store who changed last and when.
- Real names live in `ZeroPressure_Retention.xlsm`: never commit it.
- Migrations: next revision is `0004` (down_revision `0003`). After API changes run `npm run gen:api` in `apps/web` and commit `openapi.json` and `schema.d.ts`.
- Out of scope: trial follow-up (second visit evaluation, status, source), full dashboard, "next session" in the strip.

## Review Focus

- `5 0 4` on a Sunday with no beginner brace: stored beginner is `NULL` (no course), not 0.
- `0 0 4 (15)` on a Wednesday: rejected (weekday takes at most 1 number plus names), not silently reinterpreted.
- Name brace that holds a number and a name, e.g. `10 1 (David 2)`: rejected.
- Name count differs from the trial number (`10 2 (David)`): saved with a warning in the preview, not rejected.
- Saving the same day twice with a corrected name (`Davd` → `David`): old person is removed, no orphan trial remains.
- Import run twice: no duplicate days or people; the 38 Excel rows without a count are skipped, not imported as 0.

---

### Task 1: Models and migration

**Files:**
- Modify: `apps/api/app/models.py` (append)
- Create: `apps/api/alembic/versions/0004_attendance.py`
- Test: `apps/api/tests/test_attendance_models.py`
- Modify: `docs/data-model.md`, `.gitignore`

**Interfaces:**
- Produces (in `app.models`):
  - `Attendance`: table `attendance`, PK `date: date`; `cancelled: bool` (default False); `total: int | None`; `trials: int` (default 0); `open_mat: int | None`; `beginner: int | None`; `updated_by: int | None` FK `users.id`; `updated_at: datetime`. CheckConstraint `total IS NULL OR trials <= total`, and all counts `>= 0`.
  - `Trial`: table `trials`, `id` PK; `name: str(100)`; `name_key: str(100)` unique (casefolded name); `first_date: date`.
  - `TrialAttendance`: table `trial_attendance`, PK (`trial_id` FK `trials.id`, `date` FK `attendance.date`).

- [ ] **Step 1: Write the failing test** `test_attendance_models.py` with `test_trials_cannot_exceed_total` (insert `Attendance(date=..., total=3, trials=4)`, expect `IntegrityError`), `test_name_key_unique` (two `Trial` with same `name_key` → `IntegrityError`), `test_deleting_day_requires_links_gone` (FK on, link row blocks deleting the day). Use the `app` fixture's `session_factory`.
- [ ] **Step 2: Run** `cd apps/api && uv run pytest tests/test_attendance_models.py -q` → FAIL (import error).
- [ ] **Step 3: Implement** the three models in `models.py` in the existing style (`mapped_column`, `_now`), the matching migration `0004_attendance.py` modeled on `0003_vacations.py`, and add `ZeroPressure_Retention.xlsm*` to `.gitignore`. Document the three tables in `docs/data-model.md` under "Migriert" and drop the old "sessions/trials/trial_attendance" proposal lines that this replaces (note: one row per day with nullable open-mat/beginner columns instead of per-slot sessions).
- [ ] **Step 4: Run** the new test plus `uv run pytest -q` and `uv run alembic upgrade head` against a temp DB (`DATABASE_URL=sqlite:////tmp/x.db`) → all pass, migration applies.
- [ ] **Step 5: Commit** `feat(api): attendance, trials models and migration`

---

### Task 2: Line parser (pure)

**Files:**
- Create: `apps/api/app/attendance_parse.py`
- Test: `apps/api/tests/test_attendance_parse.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass(frozen=True)
  class Parsed:
      total: int            # Gesamt (weekday) or members+trials (Sunday morning)
      trials: int
      open_mat: int | None  # Sunday only
      beginner: int | None  # Sunday only, None = no course
      names: list[str]
      warnings: list[str]   # e.g. name count != trials
  def parse_line(text: str, weekday: int) -> Parsed  # weekday 1=Mon..7=Sun (date.isoweekday())
  ```
  Raises `ValueError(<German message>)` for every rejected input.

- [ ] **Step 1: Write the failing tests** in `test_attendance_parse.py`, one assert block per spec example:
  - `parse_line("10", 2)` → total 10, trials 0, names `[]`, open_mat/beginner `None`.
  - `parse_line("10 1 (David)", 2)` → total 10, trials 1, names `["David"]`, no warnings.
  - `parse_line("8 2 (Mathias, Anthony)", 4)` → names `["Mathias", "Anthony"]`.
  - `parse_line("0 0 4 (15)", 7)` → total 0, trials 0, open_mat 4, beginner 15.
  - `parse_line("5 0 4", 7)` → total 5, open_mat 4, beginner `None`.
  - `parse_line("3 1 4 (Tom)", 7)` → total 4 (members 3 + trial 1), names `["Tom"]`.
  - `parse_line("10 2 (David)", 2).warnings` has one entry mentioning the mismatch.
  - Rejected with `pytest.raises(ValueError)`: `""`, `"  "`, `"abc"`, `"1 5"` (weekday, trials > total), `"0 0 4 (15)"` with weekday 3, `"5 0"` with weekday 7 (needs three numbers), `"10 1 (David 2)"`, `"-3"`, `"10 1 (David"` (unbalanced).
- [ ] **Step 2: Run** `uv run pytest tests/test_attendance_parse.py -q` → FAIL.
- [ ] **Step 3: Implement `parse_line`.** Approach: strip, pull out `( … )` groups with one regex (reject unbalanced brackets), split the rest on whitespace and require integers `>= 0`. A group that is only digits is the beginner number (Sunday only, at most one); any other group is the names list (at most one, split on commas, trimmed, no digits-only parts, no digit in a name). Apply the weekday/Sunday number-count rules from Global Constraints.
- [ ] **Step 4: Run** the tests → PASS; `uv run ruff check .`.
- [ ] **Step 5: Commit** `feat(api): attendance line parser`

---

### Task 3: Save and parse endpoints

**Files:**
- Create: `apps/api/app/routers/attendance.py`, `apps/api/app/attendance.py` (save logic)
- Modify: `apps/api/app/schemas.py` (append), `apps/api/app/main.py` (register router)
- Test: `apps/api/tests/test_attendance_api.py`

**Interfaces:**
- Consumes: `parse_line`, `Parsed` (Task 2); models (Task 1); `current_user`, `get_db`; `today_berlin`.
- Produces schemas in `schemas.py`:
  - `AttendanceParseIn {date: date, text: str}`; `AttendanceParseOut {total, trials, members, open_mat, beginner, names, warnings}` (members = total − trials).
  - `AttendanceIn {text: str | None, cancelled: bool = False}` (exactly one of the two meaningful: `cancelled=True` ignores text).
  - `AttendanceOut {date, cancelled, total, trials, members, open_mat, beginner, names, updated_by_name, updated_at}` with `total`/`members` possibly `None`.
- Produces endpoints (prefix `/api/attendance`):
  - `POST /attendance/parse` → `AttendanceParseOut` (no write; 422 with the parser's German message as `detail` string).
  - `PUT /attendance/{date}` → `AttendanceOut` (create or replace the day).
  - `save_day(db, day: date, parsed: Parsed | None, user: User) -> Attendance` in `app/attendance.py`: `parsed=None` means cancelled.
- Validation shared by both endpoints (422 string `detail`): day in the future → "Für die Zukunft kann nichts eingetragen werden."; weekday without an active `Slot` → "An diesem Tag ist kein Training."

- [ ] **Step 1: Write the failing tests** in `test_attendance_api.py` (use `add_user`, `as_user`, and add an active `Slot` for the weekday under test the way `test_coverage_api.py` does). Names are assertion-bearing:
  - `test_put_weekday_saves_counts_and_trial`: PUT yesterday-or-last-Wednesday `{"text": "10 1 (David)"}` → 200, `members == 9`, `names == ["David"]`; DB has one `Trial` named `David` with `first_date` = that day.
  - `test_put_sunday_line`: `"0 0 4 (15)"` on a Sunday → `total 0, open_mat 4, beginner 15`; `"5 0 4"` → `beginner is None`.
  - `test_replace_removes_orphan_trial`: PUT `"10 1 (Davd)"`, then `"10 1 (David)"` same day → exactly one `Trial` (`David`), none named `Davd`.
  - `test_same_name_other_day_is_same_person`: `david` on a second day (lowercase) → still one `Trial`, `first_date` = earlier day, two `trial_attendance` rows.
  - `test_cancelled_day`: `{"cancelled": true}` → `cancelled True`, `total is None`, no trials linked.
  - `test_rejects_future_and_closed_day`: tomorrow → 422; a Monday (no slot) → 422.
  - `test_rejects_bad_line_with_german_message`: `"0 0 4 (15)"` on a Wednesday → 422 and `detail` is a string.
  - `test_parse_endpoint_does_not_write`: `POST /parse` returns `members`, `warnings`; `Attendance` table stays empty.
  - `test_unauthenticated_is_401` for both endpoints.
- [ ] **Step 2: Run** `uv run pytest tests/test_attendance_api.py -q` → FAIL.
- [ ] **Step 3: Implement** `save_day` (upsert row; delete the day's `trial_attendance`; upsert `Trial` by `name_key`; after linking, delete trials without links and recompute `first_date` as the minimum linked date for affected people), the router, schemas, and register `attendance.router` in `main.py`'s router tuple.
- [ ] **Step 4: Run** the new tests and the full suite; `uv run ruff check .` → clean.
- [ ] **Step 5: Commit** `feat(api): attendance parse and save endpoints`

---

### Task 4: Overview and missing day

**Files:**
- Modify: `apps/api/app/routers/attendance.py`, `apps/api/app/schemas.py`
- Test: `apps/api/tests/test_attendance_overview.py`

**Interfaces:**
- Consumes: Task 3 schemas/models.
- Produces:
  - `GET /api/attendance?days=60` → `AttendanceOverview {entries: list[AttendanceOut], avg_14d: float | None, avg_by_weekday: list[WeekdayAvg]}` with `WeekdayAvg {weekday: int, avg: float | None}`; entries newest first within the last `days` days (default 60, max 400). Averages use only rows with `cancelled == False` and `total is not None`; `avg_14d` covers the last 14 days up to today; `avg_by_weekday` covers all stored rows, weekdays 1–7. Open mat and beginner never enter an average.
  - `GET /api/attendance/missing` → `{date: date | None}`: the most recent day before today whose weekday has an active slot and that has no `Attendance` row (cancelled counts as present). `None` if the lookback of 14 days finds none.

- [ ] **Step 1: Write the failing tests**: `test_overview_averages_ignore_openmat_and_cancelled` (rows: Wed total 10, Wed total 6, a cancelled Wed, a Sunday with `total=None, open_mat=5` → `avg_by_weekday[2]` is 8.0, Sunday avg is `None`); `test_avg_14d_window` (an entry 20 days ago is excluded); `test_missing_skips_monday_and_today` (slots Tue–Sun; with yesterday absent it returns yesterday unless yesterday is Monday, then the Sunday before; an entry for today never counts); `test_missing_none_when_recorded_or_cancelled`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both endpoints. Compute in Python over the queried rows (SQLite, ~hundreds of rows). Resolve open weekdays from active `Slot` rows. Place `/missing` route before `/{date}` routes so it is not parsed as a date.
- [ ] **Step 4: Run** full suite and ruff → pass. Run `npm run gen:api` in `apps/web` and stage the generated files.
- [ ] **Step 5: Commit** `feat(api): attendance overview and missing day`

---

### Task 5: Excel import

**Files:**
- Create: `apps/api/app/import_excel.py`
- Modify: `apps/api/app/cli.py` (new subcommand), `apps/api/pyproject.toml` (+`uv.lock`), `docs/deploy.md`
- Test: `apps/api/tests/test_import_excel.py`

**Interfaces:**
- Consumes: models (Task 1), `save_day` is not used (import writes rows directly).
- Produces: `import_workbook(db: Session, path: Path) -> dict[str, int]` returning counts `{"days": n, "skipped": n, "trials": n}`; CLI `python -m app.cli import-excel PATH`.

Mapping (columns of tab "Trainingseinheiten": A Datum, E Kursart, G Teilnehmer gesamt, H Probetraining, K Namen Probetraining; tab "Probetrainings": A Name, B Erstes Training, C Zweites Training):
- Row without date or without G → skipped (not recorded, never 0).
- Kursart `Open Mat` → `Attendance(total=None, open_mat=G)`; any other Kursart → `Attendance(total=G, trials=min(H or 0, G))`.
- Days that already exist in `attendance` are left untouched (typed entries win).
- Names in K (comma split) and tab "Probetrainings" create `Trial` by `name_key`; `first_date` = earliest date seen; `trial_attendance` only for dates that exist in `attendance`.

- [ ] **Step 1: Write the failing test.** Build a tiny workbook with `openpyxl` in `tmp_path` (two tabs with the headers above): a BJJ row `10, 1, "Nathan"`, an Open Mat row `6`, a row without G, and a Probetrainings row `Nathan` with second date. Assert counts, `open_mat == 6` with `total is None`, no row for the empty one, and that running `import_workbook` twice leaves the same counts (`test_import_is_idempotent`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `openpyxl.load_workbook(path, data_only=True)` (cached values; formula columns unused). Add `openpyxl` to `pyproject.toml` dependencies and wire the CLI subcommand next to `seed-presets`. Document in `docs/deploy.md`: upload the file with `fly ssh sftp`, run `fly ssh console -C "python -m app.cli import-excel /tmp/ZeroPressure_Retention.xlsm"`, delete the file afterwards.
- [ ] **Step 4: Run** the test and the full suite; run once locally against the real file with a temp DB and report counts (expected: 174 rows in, 38 skipped).
- [ ] **Step 5: Commit** `feat(api): one-off Excel import for attendance history`

---

### Task 6: Attendance page and tile

**Files:**
- Create: `apps/web/app/anwesenheit/page.tsx`
- Modify: `apps/web/lib/tiles.ts`, `apps/web/tests/tiles.test.tsx`

**Interfaces:**
- Consumes: generated `schema.d.ts` types `AttendanceParseOut`, `AttendanceOut`, `AttendanceOverview`; endpoints `POST /api/attendance/parse`, `PUT /api/attendance/{date}`, `GET /api/attendance`; helpers `errText`, `deDate`, `WEEKDAYS` from `lib/format`; `AppShell`.
- Produces: page at `/anwesenheit/`; reads the optional query `?datum=YYYY-MM-DD` (from `window.location.search` in an effect, no `useSearchParams`, because of the static export) to preselect the date.

Page behavior: date field (`type="date"`, default today, `max` today); text field; live preview (debounced ~300 ms call to `/parse`): "Mi 10.11. · 10 gesamt · 9 Mitglieder · 1 Probetraining: David", warnings in a neutral note, the German error in `role="alert"` on 422; **Speichern** (disabled until the preview is valid); **Ausgefallen** button; if the chosen date already has an entry, show it ("Schon eingetragen: …") and label the button "Ersetzen". Below: overview (last entries with Gesamt/Probetraining/Mitglieder, Openmat and Anfängerkurs separate; "ausgefallen" and "–" for not recorded), Ø letzte 14 Tage and Ø pro Wochentag.

- [ ] **Step 1: Write the failing test.** In `tiles.test.tsx`: the "Anwesenheit" tile is a link to `/anwesenheit/`, and the earlier "bald" assertion is replaced by one expecting zero "bald" badges. Run `npx vitest run` → FAIL.
- [ ] **Step 2: Implement** the tile change in `lib/tiles.ts` (state `active`, `href: "/anwesenheit/"`, sub "Zahlen pro Einheit") and update the old "soon" test accordingly.
- [ ] **Step 3: Implement** `app/anwesenheit/page.tsx` following `app/urlaub/page.tsx` (AppShell, `api` client, `errText`, 44px touch targets via `min-h-11`).
- [ ] **Step 4: Verify.** `npm run typecheck && npm run lint && npx vitest run && npm run build` pass. Then run the app per the `run` skill (or `docs/`/dev script from commit `b9913d5`), enter `10 1 (David)` and a Sunday `0 0 4 (15)`, confirm preview, save, replace, and the overview update. State plainly if the browser check could not be done.
- [ ] **Step 5: Commit** `feat(web): attendance page and active tile`

---

### Task 7: "Zahlen fehlen" hint on the home page

**Files:**
- Create: `apps/web/components/MissingNumbers.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/attendance/missing` (`{date: string | null}`), `WEEKDAYS`, `deDate`.
- Produces: `<MissingNumbers />`, rendered between `CoverageBanner` and `TodayStrip`; renders nothing when `date` is `null` or the request fails (offline).

Content: "Zahlen von {Wochentag} {dd.mm.} fehlen" with a button-styled link **Eintragen** to `/anwesenheit/?datum={date}`, same card style as `CoverageBanner`.

- [ ] **Step 1: Implement** the component (fetch in `useEffect`, `.catch(() => {})` like `CoverageBanner`) and add it to `page.tsx`.
- [ ] **Step 2: Verify.** typecheck, lint, vitest, build pass. In the running app, with one open day missing the hint shows and the link opens the page with that date preselected; after saving that day the hint disappears. State plainly if the browser check could not be done.
- [ ] **Step 3: Update docs.** Add one line to `docs/open-questions.md` that the trial follow-up (second visit, status, source, "Follow-up nötig") is the next phase.
- [ ] **Step 4: Commit** `feat(web): missing attendance hint on home`

---

## Self-Review

- **Spec coverage:** line input and preview (T2, T3, T6), coach enters/anyone backfills and no future days (T3), trial people (T1, T3), hint in the strip area (T4 `/missing`, T7), tile active (T6), overview with Ø 14 days and per weekday (T4, T6), cancelled day (T3), Excel import with open mat as open-mat count (T5), Montag closed (T3, T4), name-count warning (T2). Trial follow-up and full dashboard intentionally absent (spec non-goals).
- **Deviation from spec, flagged:** the spec says "one entry per date and block"; the plan stores one row per day with nullable `open_mat` and `beginner` columns, which holds the same information with one table less. The spec leaves the table shape to the builder.
- **Placement call:** the hint is its own component on the home page instead of inside `TodayStrip`, because the strip hides itself when Trello is not configured.
- **Type consistency:** `Parsed` (T2) feeds `save_day` (T3); `AttendanceOut` (T3) is reused in `AttendanceOverview` (T4) and the page (T6); `/missing` shape matches `MissingNumbers` (T7).
