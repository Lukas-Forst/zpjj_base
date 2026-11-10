import { describe, expect, it } from "vitest";
import { cellText } from "../src/cellText";

describe("cellText", () => {
  it("flattens exceljs cell values", () => {
    const d = new Date("2025-01-07T00:00:00Z");
    expect(cellText("Ana")).toBe("Ana");
    expect(cellText(5)).toBe(5);
    expect(cellText(d)).toBe(d);
    expect(cellText({ formula: "A1", result: 7 })).toBe(7);
    expect(cellText({ formula: "A1", result: d })).toBe(d);
    expect(cellText({ richText: [{ text: "Max " }, { text: "Muster", font: {} }] })).toBe("Max Muster");
    expect(cellText({ text: "Link Name", hyperlink: "http://x" })).toBe("Link Name");
    expect(cellText({ text: { richText: [{ text: "A" }, { text: "B" }] }, hyperlink: "x" })).toBe("AB");
    expect(cellText(null)).toBeNull();
    expect(cellText(undefined)).toBeNull();
    expect(cellText("")).toBe("");
    expect(cellText({ error: "#N/A" })).toBeNull();
  });
});
