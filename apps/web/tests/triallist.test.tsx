import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrialList } from "@/components/attendance/TrialList";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

vi.mock("@/lib/api/client", () => ({ api: { PATCH: vi.fn() } }));
const patch = vi.mocked(api.PATCH);
type T = components["schemas"]["TrialOut"];

const t = (id: number, name: string, o: Partial<T> = {}): T => ({
  id, name, status: "offen", first_date: "2026-10-20", member_since: null,
  visits: 2, last_visit: "2026-11-03", due: false, recent: true, ...o,
});

function Host({ initial }: { initial: T[] }) {
  const [list, setList] = useState(initial);
  return <TrialList trials={list} onUpdate={(u) => setList((l) => l.map((x) => (x.id === u.id ? u : x)))} />;
}

describe("TrialList", () => {
  beforeEach(() => patch.mockReset());

  it("renders due person first with the decision label; hides non-recent", () => {
    render(<Host initial={[t(1, "Anna"), t(2, "Ben", { due: true, visits: 3 }), t(3, "Old", { recent: false })]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ben");
    expect(items[0]).toHaveTextContent("Entscheidung fällig");
    expect(items[0]).toHaveTextContent("Mitgliedschaft oder pro Besuch zahlen");
    expect(items[0]).toHaveTextContent("3 Besuche · zuletzt 03.11.");
    expect(items[1]).not.toHaveTextContent("Entscheidung fällig");
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
  });

  it("Mitglied geworden patches and shows Mitglied seit; Rückgängig sets offen", async () => {
    patch.mockResolvedValueOnce({ data: t(1, "Anna", { status: "mitglied", member_since: "2026-11-10" }) } as never);
    render(<Host initial={[t(1, "Anna")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Mitglied geworden" }));
    expect(patch).toHaveBeenCalledWith("/api/trials/{trial_id}", { params: { path: { trial_id: 1 } }, body: { status: "mitglied" } });
    expect(await screen.findByText("Mitglied seit 10.11.")).toBeInTheDocument();
    patch.mockResolvedValueOnce({ data: t(1, "Anna") } as never);
    await userEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(patch).toHaveBeenLastCalledWith("/api/trials/{trial_id}", { params: { path: { trial_id: 1 } }, body: { status: "offen" } });
    expect(await screen.findByRole("button", { name: "Mitglied geworden" })).toBeInTheDocument();
  });

  it("shows zahlt pro Besuch label", () => {
    render(<Host initial={[t(1, "Anna", { status: "zahlt_pro_besuch" })]} />);
    expect(screen.getByText("zahlt pro Besuch")).toBeInTheDocument();
  });

  it("shows API error in an alert and ignores double taps", async () => {
    let resolve!: (v: unknown) => void;
    patch.mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);
    render(<Host initial={[t(1, "Anna")]} />);
    const b = screen.getByRole("button", { name: "Zahlt pro Besuch" });
    await userEvent.click(b);
    await userEvent.click(b);
    expect(patch).toHaveBeenCalledTimes(1);
    resolve({ error: { detail: "Kaputt" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Kaputt");
    await waitFor(() => expect(screen.getByRole("button", { name: "Zahlt pro Besuch" })).toBeEnabled());
  });

  it("shows the empty state", () => {
    render(<Host initial={[t(3, "Old", { recent: false })]} />);
    expect(screen.getByText("In den letzten 4 Wochen war niemand im Probetraining.")).toBeInTheDocument();
  });
});
