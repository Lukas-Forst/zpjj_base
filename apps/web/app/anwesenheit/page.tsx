"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { attendanceLine, todayISO } from "@/lib/attendance";
import { WEEKDAYS, errText } from "@/lib/format";

type Parsed = components["schemas"]["AttendanceParseOut"];
type Entry = components["schemas"]["AttendanceOut"];
type Overview = components["schemas"]["AttendanceOverview"];

const field = "min-h-11 rounded-lg border border-neutral-300 px-2";
const btn = "min-h-11 rounded-lg border border-accent px-4 text-accent disabled:opacity-50";
const dash = (n: number | null) => (n === null ? "–" : n);

function Anwesenheit() {
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Parsed | null>(null);
  const [perr, setPerr] = useState("");
  const [err, setErr] = useState("");
  const [ov, setOv] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/attendance", { params: { query: { days: 400 } } });
    if (data) setOv(data); else setErr("Daten konnten nicht geladen werden.");
  }, []);
  useEffect(() => { load().catch(() => setErr("Daten konnten nicht geladen werden.")); }, [load]);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("datum");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayISO()) setDate(d);
  }, []);

  // live preview, debounced; a stale response is dropped via `live`
  useEffect(() => {
    setPreview(null); setPerr(""); setErr("");
    if (!text.trim() || !date) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await api.POST("/api/attendance/parse", { body: { date, text } });
        if (!live) return;
        if (data) setPreview(data); else setPerr(errText(error, "Eingabe nicht lesbar."));
      } catch { if (live) setPerr("Vorschau fehlgeschlagen."); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [date, text]);

  const existing = ov?.entries.find((e) => e.date === date);
  const save = async (cancelled: boolean) => {
    if (busy) return;
    if (cancelled && existing && !confirm("Vorhandenen Eintrag durch 'ausgefallen' ersetzen?")) return;
    setBusy(true);
    try {
      const { error, response } = await api.PUT("/api/attendance/{day}", {
        params: { path: { day: date } }, body: cancelled ? { cancelled: true } : { text, cancelled: false },
      });
      if (!response.ok) { setErr(errText(error, "Speichern fehlgeschlagen.")); return; }
      setText(""); await load();
    } catch { setErr("Speichern fehlgeschlagen."); } finally { setBusy(false); }
  };

  const line = (e: Entry) => e.cancelled
    ? `${attendanceLine(e.date, { ...e, total: null, open_mat: null, beginner: null })} · ausgefallen`
    : attendanceLine(e.date, e) + (e.total === null ? " · Gesamt –" : "");

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Anwesenheit</h1>
      {err && <p role="alert" className="mb-3 text-danger">{err}</p>}

      <section className="mb-6" aria-labelledby="neu">
        <h2 id="neu" className="mb-2 font-semibold">Eintragen</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (preview) save(false); }} className="flex flex-col gap-3">
          <label className="flex flex-col text-sm">Datum
            <input type="date" required max={today} className={field} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col text-sm">Zahlen (z. B. 10 1 (David))
            <input className={field} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </label>
          {existing && <p className="text-sm text-neutral-600">Schon eingetragen: {line(existing)}</p>}
          {perr && <p role="alert" className="text-danger">{perr}</p>}
          {preview && (
            <div className="rounded-xl border border-neutral-200 p-3" aria-live="polite">
              <p>{attendanceLine(date, preview)}</p>
              {preview.warnings.map((w) => <p key={w} className="mt-1 text-sm text-neutral-600">{w}</p>)}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={!preview || !ov || busy} className="min-h-11 rounded-lg bg-accent px-4 text-accent-foreground disabled:opacity-50">
              {existing ? "Ersetzen" : "Speichern"}
            </button>
            <button type="button" disabled={!date || !ov || busy} className={btn} onClick={() => save(true)}>Ausgefallen</button>
          </div>
        </form>
      </section>

      {ov && (
        <section aria-labelledby="ov">
          <h2 id="ov" className="mb-2 font-semibold">Übersicht</h2>
          <p className="mb-2 text-sm">Ø letzte 14 Tage: <b>{dash(ov.avg_14d)}</b></p>
          <p className="mb-3 text-sm">Ø pro Wochentag: {ov.avg_by_weekday.map((w) => `${WEEKDAYS[w.weekday].slice(0, 2)} ${w.avg ?? "–"}`).join(" · ")}</p>
          {ov.entries.length === 0 ? <p className="text-sm text-neutral-600">Noch nichts eingetragen.</p> : (
            <ul className="flex flex-col gap-2">
              {ov.entries.map((e) => (
                <li key={e.date} className="rounded-xl border border-neutral-200 p-3">
                  {line(e)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

export default function Page() {
  return <AppShell><Anwesenheit /></AppShell>;
}
