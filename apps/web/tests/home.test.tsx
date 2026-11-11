import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modules } from "@/components/home/Modules";
import { Open } from "@/components/home/Open";
import { presetLabel } from "@/components/home/TimerRow";
import { api } from "@/lib/api/client";
import { DEFAULT_FORM } from "@/lib/timer/form";

vi.mock("@/lib/api/client", () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);
const env = { plannerUrl: "https://planner.example.com", crmUrl: "https://crm.example.com" };

describe("Modules", () => {
  it("shows Admin only for gesellschafter", () => {
    const { unmount } = render(<Modules role="gesellschafter" env={env} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    unmount();
    render(<Modules role="trainer" env={env} />);
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("omits external modules without URL", () => {
    render(<Modules role="trainer" env={{ crmUrl: env.crmUrl }} />);
    expect(screen.queryByText("Produktion")).not.toBeInTheDocument();
    expect(screen.getByText("CRM")).toBeInTheDocument();
  });

  it("opens external modules safely in a new tab and links internal ones", () => {
    render(<Modules role="trainer" env={env} />);
    const crm = screen.getByText("CRM").closest("a")!;
    expect(crm).toHaveAttribute("target", "_blank");
    expect(crm).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByLabelText("Öffnet in neuem Tab")).toHaveLength(2);
    expect(screen.getByText("Anwesenheit").closest("a")).toHaveAttribute("href", expect.stringMatching(/^\/anwesenheit\/?$/));
  });
});

describe("Open", () => {
  beforeEach(() => get.mockReset());
  const answer = (map: Record<string, unknown>) =>
    get.mockImplementation(((path: string) => Promise.resolve({ data: map[path] })) as never);

  it("prints missing numbers with a single dot and links to the entry form", async () => {
    answer({ "/api/coverage": [], "/api/attendance/missing": { date: "2026-11-08" } });
    render(<Open />);
    expect(await screen.findByText("Zahlen von Sonntag 08.11. fehlen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Eintragen" })).toHaveAttribute("href", expect.stringMatching(/^\/anwesenheit\/?\?datum=2026-11-08$/));
  });

  it("renders nothing when nothing is open", async () => {
    answer({ "/api/coverage": [], "/api/attendance/missing": { date: null } });
    const { container } = render(<Open />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(container).toBeEmptyDOMElement();
  });
});

it("labels the last timer preset", () => {
  expect(presetLabel({ ...DEFAULT_FORM, rounds: 5, work: 300 })).toBe("5 × 5:00");
});
