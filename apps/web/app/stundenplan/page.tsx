"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { SlotTag, type SlotKind } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { KIND_LABEL, WEEKDAYS, hhmm } from "@/lib/format";

type Slot = components["schemas"]["SlotOut"];
const TAG: Record<string, SlotKind> = { no_gi: "nogi", gi: "gi", open_mat: "openmat" };
type User = components["schemas"]["UserOut"];

function TrainerDialog({ slot, users, onClose, onSaved }: { slot: Slot; users: User[]; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sel, setSel] = useState(new Set(slot.trainers.map((t) => t.id)));
  const [err, setErr] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  const save = async () => {
    const { response } = await api.PUT("/api/slots/{slot_id}/trainers", {
      params: { path: { slot_id: slot.id } }, body: { user_ids: [...sel] },
    });
    if (response.ok) { onSaved(); onClose(); } else setErr("Speichern fehlgeschlagen.");
  };
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(90vw,24rem)] bg-paper p-5 text-ink">
      <h2 className="mb-3 text-lg font-semibold">
        Trainer: {WEEKDAYS[slot.weekday]} {hhmm(slot.start_time)} {KIND_LABEL[slot.kind]}{slot.location ? ` (${slot.location})` : ""}
      </h2>
      <div className="flex flex-col gap-1">
        {users.filter((u) => u.active && u.is_trainer).map((u) => (
          <label key={u.id} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={sel.has(u.id)}
              onChange={(e) => setSel((p) => { const n = new Set(p); e.target.checked ? n.add(u.id) : n.delete(u.id); return n; })} />
            {u.display_name}
          </label>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-ink font-semibold">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="min-h-11 rounded-sm px-4" onClick={onClose}>Abbrechen</button>
        <button className="min-h-11 rounded-sm bg-accent px-4 text-accent-foreground" onClick={save}>Speichern</button>
      </div>
    </dialog>
  );
}

function Plan() {
  const me = useCurrentMe();
  const admin = me.role === "gesellschafter";
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/slots");
    if (data) setSlots(data); else setError("Stundenplan konnte nicht geladen werden.");
    if (admin) { const u = await api.GET("/api/users"); if (u.data) setUsers(u.data); }
  }, [admin]);
  useEffect(() => { load().catch(() => setError("Stundenplan konnte nicht geladen werden.")); }, [load]);

  if (error) return <p role="alert" className="p-5 font-semibold">{error}</p>;
  if (!slots) return <p className="p-5" role="status">Lade …</p>;
  const today = new Date().getDay() || 7;
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, items: slots.filter((s) => s.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
  return (
    <main className="mx-auto max-w-[1280px] px-5 py-6 lg:px-12">
      <h1 className="mb-6 text-[28px] font-bold leading-8 tracking-[-0.02em] lg:text-[40px] lg:leading-[44px]">Stundenplan</h1>
      <div className="grid border-t-2 border-ink lg:grid-cols-7 lg:border-l lg:border-hairline">
        {days.map(({ d, items }) => (
          <section key={d} aria-labelledby={`d${d}`} className="border-b border-hairline py-3 lg:border-r lg:px-3">
            <h2 id={`d${d}`} className={`mb-1 flex items-center gap-2 text-lg font-bold ${d === today ? "text-action" : ""}`}>
              {WEEKDAYS[d]}{d === today && <span className="text-xs font-semibold uppercase tracking-widest">Heute</span>}
            </h2>
            {items.length === 0 ? <p className="text-sm text-muted-ink">trainingsfrei</p> : (
              <ul>
                {items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-t border-hairline py-2 first:border-t-0">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{hhmm(s.start_time)}</span>
                        <SlotTag kind={TAG[s.kind]} />
                        {s.location && <span className="text-xs text-muted-ink">{s.location}</span>}
                      </div>
                      <div className="text-sm text-muted-ink">{s.trainers.length ? s.trainers.map((t) => t.display_name).join(", ") : "kein Trainer"}</div>
                    </div>
                    {admin && <button className="min-h-11 px-2 text-sm font-semibold text-action" onClick={() => setEditing(s)}>Ändern</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {editing && <TrainerDialog slot={editing} users={users} onClose={() => setEditing(null)} onSaved={load} />}
    </main>
  );
}

export default function Page() {
  return <AppShell><Plan /></AppShell>;
}
