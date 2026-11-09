/** mm:ss; minutes are not capped (stopwatch may exceed 99:59). Countdown rounds up, stopwatch down. */
export function fmt(ms: number, up = true): string {
  const total = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
