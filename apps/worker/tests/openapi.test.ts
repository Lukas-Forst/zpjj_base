import { expect, it } from "vitest";
import { buildOpenApi } from "../src/app";

const ROUTES: Record<string, string[]> = {
  "/api/attendance": ["get"],
  "/api/attendance/missing": ["get"],
  "/api/attendance/stats": ["get"],
  "/api/attendance/{day}": ["put"],
  "/api/me": ["get"],
  "/api/slots": ["get", "post"],
  "/api/slots/{slot_id}": ["patch"],
  "/api/slots/{slot_id}/trainers": ["put"],
  "/api/users": ["get", "post"],
  "/api/users/{user_id}": ["patch"],
  "/api/timer-presets": ["get", "post"],
  "/api/timer-presets/{preset_id}": ["patch", "delete"],
  "/api/today": ["get"],
  "/api/vacations": ["get", "post"],
  "/api/vacations/{vacation_id}": ["delete"],
  "/api/coverage": ["get"],
  "/api/coverage/plan": ["get"],
  "/api/coverage/substitutes": ["get", "put", "delete"],
  "/api/sync-status": ["get"],
  "/api/trials": ["get"],
  "/api/trials/{trial_id}": ["patch"],
};

// components["schemas"][...] names used in apps/web sources (grep result)
const WEB_SCHEMAS = [
  "AttendanceIn", "AttendanceOut", "AttendanceOverview", "GapOut", "MissingOut", "PlanDay", "PlanSlot", "PlanWeek",
  "PresetOut", "SlotOut", "StatsOut", "SyncOut", "TodayOut", "TrialOut", "TrialStatus", "UserOut", "UserPatch",
  "VacationOut", "WeekdayAvg", "WeekPoint",
];

const doc = buildOpenApi();

it("has every path and method of the Python API", () => {
  for (const [path, methods] of Object.entries(ROUTES)) {
    for (const m of methods) expect(doc.paths?.[path], `${m} ${path}`).toHaveProperty(m);
  }
});

it("defines every schema the web imports", () => {
  for (const n of WEB_SCHEMAS) expect(doc.components?.schemas, n).toHaveProperty(n);
});
