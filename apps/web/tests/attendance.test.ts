import { describe, expect, it } from "vitest";
import { attendanceLine, todayISO } from "@/lib/attendance";

describe("attendance helpers", () => {
  it("todayISO uses local date parts", () => {
    expect(todayISO(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
  });
  it("formats a weekday line", () => {
    expect(attendanceLine("2026-11-10", { total: 10, members: 9, trials: 1, open_mat: null, beginner: null, names: ["David"] }))
      .toBe("Di 10.11. · 10 gesamt · 9 Mitglieder · 1 Probetraining: David");
  });
  it("formats a Sunday with open mat and beginner only", () => {
    expect(attendanceLine("2026-11-08", { total: null, members: null, trials: 0, open_mat: 0, beginner: 4, names: [] }))
      .toBe("So 08.11. · Openmat 0 · Anfängerkurs 4");
  });
  it("pluralizes Probetrainings", () => {
    const c = { total: 5, members: 3, open_mat: null, beginner: null };
    expect(attendanceLine("2026-11-10", { ...c, trials: 0, names: [] })).toContain("0 Probetrainings");
    expect(attendanceLine("2026-11-10", { ...c, trials: 2, names: ["A", "B"] })).toContain("2 Probetrainings: A, B");
  });
});

describe("guests in line", () => {
  it("shows guests when present", () => {
    expect(attendanceLine("2026-11-10", { total: 10, members: 6, trials: 1, guests: 3, open_mat: null, beginner: null, names: ["A"] }))
      .toBe("Di 10.11. · 10 gesamt · 6 Mitglieder · 1 Probetraining: A · 3 Gäste");
  });
});
