export const WEEKDAYS = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const KIND_LABEL: Record<string, string> = { no_gi: "No-Gi", gi: "Gi", open_mat: "Open Mat" };
export const hhmm = (t: string) => t.slice(0, 5);

/** FastAPI errors: `detail` is a string (HTTPException) or a validation list (422). */
export function errText(error: unknown, fallback: string): string {
  const d = (error as { detail?: unknown } | undefined)?.detail;
  return typeof d === "string" ? d : fallback;
}
