import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntryForm } from "@/components/attendance/EntryForm";
import { api } from "@/lib/api/client";
import { sundayTotal } from "@/lib/attendance";

vi.mock("@/lib/api/client", () => ({ api: { PUT: vi.fn() } }));
const put = vi.mocked(api.PUT);
const MON = "2026-11-09";
const SUN = "2026-11-08";
const trials = [{ id: 1, name: "David", status: "offen", first_date: "2026-11-01", member_since: null, visits: 2, last_visit: null, due: false, recent: false }];

describe("EntryForm", () => {
  beforeEach(() => { put.mockReset(); put.mockResolvedValue({ response: { ok: true } } as never); });

  it("sundayTotal adds the groups", () => expect(sundayTotal(3, 1, 2)).toBe(6));

  it("shows one name input per trial and removes trailing ones", async () => {
    const u = userEvent.setup();
    render(<EntryForm day={MON} existing={undefined} trials={trials as never} onSaved={() => {}} />);
    const n = screen.getByLabelText("Davon Probetraining");
    expect(n).toHaveValue(0);
    await u.clear(n); await u.type(n, "2");
    expect(screen.getAllByLabelText(/^Name Probetraining/)).toHaveLength(2);
    await u.clear(n); await u.type(n, "1");
    expect(screen.getAllByLabelText(/^Name Probetraining/)).toHaveLength(1);
    await u.clear(n); await u.type(n, "0");
    expect(screen.queryAllByLabelText(/^Name Probetraining/)).toHaveLength(0);
    expect(screen.getByText(/David \(2 Besuche\)/, { selector: "option" })).toBeInTheDocument();
  });

  it("blocks an empty name", async () => {
    const u = userEvent.setup();
    render(<EntryForm day={MON} existing={undefined} trials={[]} onSaved={() => {}} />);
    await u.type(screen.getByLabelText("Teilnehmer gesamt"), "10");
    await u.clear(screen.getByLabelText("Davon Probetraining")); await u.type(screen.getByLabelText("Davon Probetraining"), "1");
    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte für jedes Probetraining einen Namen eintragen.");
    expect(put).not.toHaveBeenCalled();
  });

  it("sends a weekday body", async () => {
    const u = userEvent.setup(); const saved = vi.fn();
    render(<EntryForm day={MON} existing={undefined} trials={[]} onSaved={saved} />);
    await u.type(screen.getByLabelText("Teilnehmer gesamt"), "10");
    await u.clear(screen.getByLabelText("Davon Probetraining")); await u.type(screen.getByLabelText("Davon Probetraining"), "1");
    await u.type(screen.getByLabelText(/^Name Probetraining/), "Eva");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toMatchObject({ params: { path: { day: MON } }, body: { cancelled: false, total: 10, trial_names: ["Eva"], guests: 0 } });
    expect((put.mock.calls[0][1] as { body: object }).body).not.toHaveProperty("open_mat");
  });

  it("sends a Sunday body with open mat and beginner", async () => {
    const u = userEvent.setup();
    render(<EntryForm day={SUN} existing={undefined} trials={[]} onSaved={() => {}} />);
    expect(screen.queryByLabelText("Teilnehmer gesamt")).toBeNull();
    await u.type(screen.getByLabelText("Openmat"), "4");
    await u.type(screen.getByLabelText("Anfängerkurs (leer = kein Kurs)"), "15");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0][1] as { body: object }).body).toMatchObject({ total: 0, open_mat: 4, beginner: 15 });
  });

  it("empty Anfängerkurs sends null", async () => {
    const u = userEvent.setup();
    render(<EntryForm day={SUN} existing={undefined} trials={[]} onSaved={() => {}} />);
    await u.type(screen.getByLabelText("Openmat"), "4");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0][1] as { body: object }).body).toMatchObject({ beginner: null });
  });

  it("shows the server detail in an alert", async () => {
    const u = userEvent.setup();
    put.mockResolvedValue({ response: { ok: false }, error: { detail: "Zu viele" } } as never);
    render(<EntryForm day={SUN} existing={undefined} trials={[]} onSaved={() => {}} />);
    await u.type(screen.getByLabelText("Openmat"), "4");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele");
  });
});
