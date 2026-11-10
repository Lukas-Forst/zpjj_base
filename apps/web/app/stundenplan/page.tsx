"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { KIND_LABEL, WEEKDAYS, hhmm } from "@/lib/format";

type Slot = components["schemas"]["SlotOut"];
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
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(90vw,24rem)] rounded-2xl p-5">
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
      {err && <p role="alert" className="mt-2 text-danger">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="min-h-11 rounded-lg px-4" onClick={onClose}>Abbrechen</button>
        <button className="min-h-11 rounded-lg bg-accent px-4 text-accent-foreground" onClick={save}>Speichern</button>
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

  if (error) return <p role="alert" className="p-4 text-danger">{error}</p>;
  if (!slots) return <p className="p-4" role="status">Lade …</p>;
  const days = [2, 3, 4, 5, 6, 7, 1].map((d) => ({ d, items: slots.filter((s) => s.weekday === d) }));
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Stundenplan</h1>
      <div className="flex flex-col gap-4">
        {days.map(({ d, items }) => (
          <section key={d} aria-labelledby={`d${d}`}>
            <h2 id={`d${d}`} className="mb-1 font-semibold">{WEEKDAYS[d]}</h2>
            {items.length === 0 ? <p className="text-sm text-neutral-600">trainingsfrei</p> : (
              <ul className="flex flex-col gap-2">
                {items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 p-3">
                    <div>
                      <div className="font-medium">{hhmm(s.start_time)}–{hhmm(s.end_time)} · {KIND_LABEL[s.kind]}{s.location ? ` · ${s.location}` : ""}</div>
                      <div className="text-sm text-neutral-600">{s.trainers.length ? s.trainers.map((t) => t.display_name).join(", ") : "kein Trainer"}</div>
                    </div>
                    {admin && <button className="min-h-11 rounded-lg border border-accent px-3 text-accent" onClick={() => setEditing(s)}>Trainer ändern</button>}
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
