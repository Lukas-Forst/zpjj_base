import type { components } from "@/lib/api/schema";
import { deDate } from "@/lib/format";

type WeekPoint = components["schemas"]["WeekPoint"];
export const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

const W = 320, H = 150, L = 8, R = 8, T = 22, B = 24;

export function WeeklyLine({ weeks }: { weeks: WeekPoint[] }) {
  const vals = weeks.map((w) => w.avg);
  const max = Math.max(1, ...vals.filter((v): v is number => v !== null));
  const x = (i: number) => L + (weeks.length < 2 ? (W - L - R) / 2 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  // consecutive non-null runs -> one path each; a null splits the line
  const segs: string[] = [];
  let cur = "";
  vals.forEach((v, i) => {
    if (v === null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const known = vals.filter((v): v is number => v !== null);
  const label = known.length
    ? `Ø Teilnehmer pro Woche: zuerst ${num(known[0])}, zuletzt ${num(known[known.length - 1])}`
    : "Ø Teilnehmer pro Woche: keine Daten";
  const lastIdx = vals.length - 1 - [...vals].reverse().findIndex((v) => v !== null);
  const ticks = weeks.length ? [...new Set([0, Math.floor((weeks.length - 1) / 2), weeks.length - 1])] : [];

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="w-full text-neutral-900 dark:text-neutral-100">
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="currentColor" strokeOpacity={0.25} />
      {segs.map((d) => <path key={d} d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-blue-600 dark:stroke-blue-400" />)}
      {vals.map((v, i) => v === null ? null : (
        <g key={weeks[i].week_start}>
          <circle cx={x(i)} cy={y(v)} r={3.5} strokeWidth={2} className="fill-blue-600 stroke-white dark:fill-blue-400 dark:stroke-neutral-900" />
          <text x={x(i)} y={y(v) - 8} textAnchor="middle" fontSize={i === lastIdx ? 12 : 9} fontWeight={i === lastIdx ? 700 : 400} fill="currentColor">{num(v)}</text>
        </g>
      ))}
      {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === weeks.length - 1 ? "end" : "middle"} fontSize={10} fill="currentColor" fillOpacity={0.7}>{deDate(weeks[i].week_start)}</text>)}
    </svg>
  );
}
