/** Flatten an exceljs cell value (plain, formula result, rich text, hyperlink) to Date | number | string | null. */
export function cellText(v: unknown): Date | number | string | null {
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text?: unknown }[]; text?: unknown };
    if ("result" in o) return cellText(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((p) => String(p.text ?? "")).join("");
    if ("text" in o) return cellText(o.text); // hyperlink (text may itself be rich text)
  }
  return null;
}
