const berlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/** Today's date in Berlin as YYYY-MM-DD. */
export function todayBerlin(): string {
  return berlin.format(new Date());
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(iso: string): number {
  return toUtc(iso).getUTCDay() || 7;
}
