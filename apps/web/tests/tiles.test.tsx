import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TileGrid } from "@/components/TileGrid";

const env = { plannerUrl: "https://planner.example.com", crmUrl: "https://crm.example.com" };

describe("TileGrid", () => {
  it("shows Admin only for gesellschafter", () => {
    const { unmount } = render(<TileGrid role="gesellschafter" env={env} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    unmount();
    render(<TileGrid role="trainer" env={env} />);
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("disables external tile when URL variable is missing", () => {
    render(<TileGrid role="trainer" env={{ plannerUrl: undefined, crmUrl: env.crmUrl }} />);
    const planer = screen.getByText("Produktionsplaner").closest("[aria-disabled]");
    expect(planer).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Produktionsplaner").closest("a")).toBeNull();
  });

  it("opens configured external tiles safely in a new tab", () => {
    render(<TileGrid role="trainer" env={env} />);
    const crm = screen.getByText("CRM").closest("a")!;
    expect(crm).toHaveAttribute("target", "_blank");
    expect(crm).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByLabelText("Öffnet in neuem Tab").length).toBe(2);
  });

  it("marks coming-soon tiles as disabled with badge and links the schedule", () => {
    render(<TileGrid role="trainer" env={env} />);
    expect(screen.getByText("Heute").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("bald").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Stundenplan").closest("a")).toHaveAttribute("href", "/stundenplan/");
  });
});
