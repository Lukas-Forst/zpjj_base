import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoveragePlan } from "@/components/urlaub/CoveragePlan";
import type { components } from "@/lib/api/schema";

type Week = components["schemas"]["PlanWeek"];
type Slot = components["schemas"]["PlanSlot"];

const slot = (o: Partial<Slot> = {}): Slot => ({
  slot_id: 1, start_time: "18:00:00", kind: "no_gi", status: "besetzt",
  trainers: ["Nico", "Can"], absent: [], substitutes: [], ...o,
});
const day = (date: string, weekday: number, slots: Slot[]) => ({ date, weekday, slots });
const week = (o: Partial<Week> = {}): Week => ({
  week_start: "2026-11-09", iso_week: 46, unbesetzt: 0, teilweise: 0, days: [], ...o,
});

const base = { meId: 7, isTrainer: true, boss: false, myAbsent: () => false, onSubstitute: vi.fn(), onWithdraw: vi.fn() };

function media(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as never;
}
afterEach(() => { vi.clearAllMocks(); Reflect.deleteProperty(window, "matchMedia"); });

describe("CoveragePlan", () => {
  it("summarises each week with a short traffic light", () => {
    media(true);
    render(<CoveragePlan {...base} weeks={[
      week({ unbesetzt: 2, teilweise: 1 }),
      week({ week_start: "2026-11-16", iso_week: 47 }),
    ]} />);
    expect(screen.getByText(/KW 46 · 09\.11\.–15\.11\./)).toBeInTheDocument();
    expect(screen.getByText("2 Einheiten ohne Trainer · 1 Einheit mit fehlendem Trainer")).toBeInTheDocument();
    expect(screen.getByText("alles besetzt")).toBeInTheDocument();
  });

  it("shows a gap card and lets a trainer jump in", async () => {
    media(true);
    const onSubstitute = vi.fn();
    render(<CoveragePlan {...base} onSubstitute={onSubstitute} weeks={[week({
      unbesetzt: 1, days: [day("2026-11-12", 4, [slot({ status: "unbesetzt", absent: ["Nico", "Can"] })])],
    })]} />);
    expect(screen.getByText("kein Trainer")).toBeInTheDocument();
    expect(screen.getByText("Urlaub: Nico, Can")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ich springe ein/ }));
    expect(onSubstitute).toHaveBeenCalledWith(1, "2026-11-12");
  });

  it("hides 'Ich springe ein' for non-trainers and for a trainer on vacation that day", () => {
    media(true);
    const w = [week({ days: [day("2026-11-12", 4, [slot({ status: "teilweise", absent: ["Nico"] })])] })];
    const { rerender } = render(<CoveragePlan {...base} isTrainer={false} weeks={w} />);
    expect(screen.queryByRole("button", { name: /Ich springe ein/ })).toBeNull();
    rerender(<CoveragePlan {...base} myAbsent={(d) => d === "2026-11-12"} weeks={w} />);
    expect(screen.queryByRole("button", { name: /Ich springe ein/ })).toBeNull();
    rerender(<CoveragePlan {...base} weeks={w} />);
    expect(screen.getByRole("button", { name: /Ich springe ein/ })).toBeInTheDocument();
  });

  it("shows the substitute and lets only the owner or a boss withdraw", async () => {
    media(true);
    const onWithdraw = vi.fn();
    const w = [week({ days: [day("2026-11-12", 4, [slot({
      status: "vertreten", absent: ["Nico", "Can"],
      substitutes: [{ user_id: 7, user_name: "Tim" }, { user_id: 9, user_name: "Lukas" }],
    })])] })];
    const { rerender } = render(<CoveragePlan {...base} onWithdraw={onWithdraw} weeks={w} />);
    expect(screen.getByText("Tim springt ein")).toBeInTheDocument();
    expect(screen.getByText("Lukas springt ein")).toBeInTheDocument();
    const own = screen.getAllByRole("button", { name: /Austragen/ });
    expect(own).toHaveLength(1);
    await userEvent.click(own[0]);
    expect(onWithdraw).toHaveBeenCalledWith(1, "2026-11-12", 7);
    rerender(<CoveragePlan {...base} boss weeks={w} />);
    expect(screen.getAllByRole("button", { name: /Austragen/ })).toHaveLength(2);
  });

  it("marks open mat as not checked and never offers a substitute for it", () => {
    media(true);
    render(<CoveragePlan {...base} weeks={[week({ days: [day("2026-11-15", 7, [
      slot({ slot_id: 3, kind: "open_mat", status: "nicht_geprueft", trainers: [] })])] })]} />);
    expect(screen.getByText(/Open Mat/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("on a phone only days with problems are open; on desktop every day is", () => {
    const w = [week({ unbesetzt: 1, days: [
      day("2026-11-10", 2, [slot()]),
      day("2026-11-12", 4, [slot({ slot_id: 2, status: "unbesetzt", absent: ["Nico", "Can"] })]),
    ] })];
    media(false);
    const { container, unmount } = render(<CoveragePlan {...base} weeks={w} />);
    const open = () => [...container.querySelectorAll("details")].map((d) => d.open);
    expect(open()).toEqual([false, true]);
    expect(screen.getByText(/· alles besetzt/)).toBeInTheDocument();
    expect(screen.getByText(/Di 10\.11\./)).toBeInTheDocument();
    unmount();
    media(true);
    const r2 = render(<CoveragePlan {...base} weeks={w} />);
    expect([...r2.container.querySelectorAll("details")].map((d) => d.open)).toEqual([true, true]);
  });
});
