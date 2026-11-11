"use client";
import { useEffect, useState } from "react";
import { Button, ListRow, SectionHeader, TextLink } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { KIND_LABEL, WEEKDAYS, deDate, hhmm, isoWeekday } from "@/lib/format";

type Gap = components["schemas"]["GapOut"];
type Task = { key: string; text: string; href: string; label: string; primary?: boolean };

export const gapLabel = (g: Gap) =>
  `${WEEKDAYS[g.weekday]} ${deDate(g.date)}, ${hhmm(g.start_time)} ${KIND_LABEL[g.kind]}${g.location ? ` (${g.location})` : ""}`;

/** Open items: uncovered classes, failed calendar sync, missing attendance numbers. */
export function useOpenTasks(): Task[] {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    const quiet = <T,>(p: Promise<T>) => p.catch(() => null);
    Promise.all([
      quiet(api.GET("/api/coverage")),
      quiet(api.GET("/api/sync-status")),
      quiet(api.GET("/api/attendance/missing")),
    ]).then(([cov, sync, miss]) => {
      const t: Task[] = [];
      const gaps = cov?.data ?? [];
      for (const g of gaps.filter((g) => g.level === "unbesetzt"))
        t.push({ key: `g${g.slot_id}${g.date}`, text: `Kein Trainer: ${gapLabel(g)}`, href: "/urlaub/", label: "Wählen" });
      const partial = gaps.filter((g) => g.level === "teilweise").length;
      if (partial) t.push({ key: "partial", text: `${partial} Einheit(en) mit fehlendem Trainer, noch besetzt`, href: "/urlaub/", label: "Ansehen" });
      const s = sync?.data;
      if (s?.enabled && !s.ok)
        t.push({ key: "sync", text: `Kalender-Sync fehlgeschlagen seit ${deDate(String(s.error_since).slice(0, 10))}`, href: "/urlaub/", label: "Ansehen" });
      const d = miss?.data?.date;
      if (d) t.push({ key: "miss", text: `Zahlen von ${WEEKDAYS[isoWeekday(d)]} ${deDate(d)} fehlen`, href: `/anwesenheit/?datum=${d}`, label: "Eintragen", primary: true });
      setTasks(t);
    });
  }, []);
  return tasks;
}

export function Open() {
  const tasks = useOpenTasks();
  if (!tasks.length) return null;
  return (
    <section aria-label="Offen">
      <SectionHeader title="Offen" aside={tasks.length} />
      {tasks.map((t) => (
        <ListRow key={t.key} aside={t.primary ? <Button href={t.href}>{t.label}</Button> : <TextLink href={t.href}>{t.label}</TextLink>}>
          <span className="text-sm font-medium text-ink">{t.text}</span>
        </ListRow>
      ))}
    </section>
  );
}
