import type { components } from "@/lib/api/schema";
import { WEEKDAYS } from "@/lib/format";
import { num } from "./WeeklyLine";

type WeekdayAvg = components["schemas"]["WeekdayAvg"];

export function WeekdayBars({ data }: { data: WeekdayAvg[] }) {
  const max = Math.max(0, ...data.map((d) => d.avg ?? 0));
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.weekday} className="flex min-h-8 items-center gap-2 text-sm">
          <span className="w-8 shrink-0">{WEEKDAYS[d.weekday].slice(0, 2)}</span>
          <span className="h-4 flex-1">
            {d.avg !== null && max > 0 && <span data-testid="bar" className="block h-4 rounded-r bg-blue-600 dark:bg-blue-400" style={{ width: `${(d.avg / max) * 100}%` }} />}
          </span>
          <span className="w-10 shrink-0 text-right font-medium tabular-nums">{d.avg === null ? "–" : num(d.avg)}</span>
        </li>
      ))}
    </ul>
  );
}
