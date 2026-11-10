import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stats } from "@/components/attendance/Stats";
import { WeekdayBars } from "@/components/attendance/WeekdayBars";
import { WeeklyLine } from "@/components/attendance/WeeklyLine";
import { api } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);

const wk = (i: number, avg: number | null) => ({ week_start: `2026-10-${String(5 + i * 7).padStart(2, "0")}`, avg, days: avg === null ? 0 : 2 });

describe("WeekdayBars", () => {
  it("prints a decimal comma and a dash without a bar for null", () => {
    render(<WeekdayBars data={[{ weekday: 1, avg: 6.5 }, { weekday: 2, avg: null }, { weekday: 3, avg: 3 }]} />);
    expect(screen.getByText("6,5")).toBeInTheDocument();
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(screen.getAllByTestId("bar")).toHaveLength(2);
    expect(screen.getAllByTestId("bar")[1]).toHaveStyle({ width: `${(3 / 6.5) * 100}%` });
  });
});

describe("WeeklyLine", () => {
  const weeks = [wk(0, 4), wk(1, null), wk(2, 6)];
  it("breaks the line at a gap and draws no point for it", () => {
    const { container } = render(<WeeklyLine weeks={weeks} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
  it("labels the image with first and last value and prints the last one", () => {
    render(<WeeklyLine weeks={weeks} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/6/);
    expect(screen.getByText("19.10.")).toBeInTheDocument();
  });
  it("prints a date under every week, also for a gap week", () => {
    render(<WeeklyLine weeks={weeks} />);
    for (const d of ["05.10.", "12.10.", "19.10."]) expect(screen.getByText(d)).toBeInTheDocument();
  });
});

describe("Stats", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { months: 3, weeks: [wk(0, 4), wk(1, 5)], weekday_avg: [{ weekday: 1, avg: 5 }] } } as never);
  });
  it("refetches with months=2", async () => {
    const u = userEvent.setup();
    render(<Stats />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/attendance/stats", { params: { query: { months: 3 } } }));
    await u.click(screen.getByRole("button", { name: "2 Monate" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/api/attendance/stats", { params: { query: { months: 2 } } }));
  });
  it("drops old bars while loading the other range and shows only the alert on failure", async () => {
    const u = userEvent.setup();
    render(<Stats />);
    expect(await screen.findAllByTestId("bar")).toHaveLength(1);
    let rej!: (e: Error) => void;
    get.mockReturnValueOnce(new Promise((_, r) => { rej = r; }) as never);
    await u.click(screen.getByRole("button", { name: "2 Monate" }));
    expect(screen.queryAllByTestId("bar")).toHaveLength(0);
    expect(screen.getByText("Lädt …")).toBeInTheDocument();
    rej(new Error("x"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryAllByTestId("bar")).toHaveLength(0);
    expect(screen.queryByText("Lädt …")).not.toBeInTheDocument();
  });
});
