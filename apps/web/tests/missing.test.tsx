import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingNumbers } from "@/components/MissingNumbers";
import { api } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);

describe("MissingNumbers", () => {
  beforeEach(() => get.mockReset());

  it("prints the date with a single dot", async () => {
    get.mockResolvedValue({ data: { date: "2026-11-08" } } as never);
    render(<MissingNumbers />);
    expect(await screen.findByText("Zahlen von Sonntag 08.11. fehlen")).toBeInTheDocument();
  });

  it("renders nothing without a date", async () => {
    get.mockResolvedValue({ data: { date: null } } as never);
    const { container } = render(<MissingNumbers />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
