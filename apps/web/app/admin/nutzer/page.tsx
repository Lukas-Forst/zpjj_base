"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { errText } from "@/lib/format";

type User = components["schemas"]["UserOut"];
type Patch = components["schemas"]["UserPatch"];

function Users() {
  const me = useCurrentMe();
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/users");
    if (data) setUsers(data);
  }, []);
  useEffect(() => { if (me.role === "gesellschafter") load(); }, [me.role, load]);
  if (me.role !== "gesellschafter") return <p role="alert" className="p-4">Nur für Gesellschafter.</p>;

  const patch = async (u: User, body: Patch) => {
    const { response, error } = await api.PATCH("/api/users/{user_id}", { params: { path: { user_id: u.id } }, body });
    setMsg(response.ok ? "" : errText(error, "Änderung fehlgeschlagen."));
    await load();
  };
  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { response, error } = await api.POST("/api/users", {
      body: { email: String(f.get("email")), display_name: String(f.get("name")), role: f.get("role") as "trainer", is_trainer: f.get("is_trainer") === "on" },
    });
    if (response.ok) { e.currentTarget.reset(); setMsg(""); } else setMsg(errText(error, "Anlegen fehlgeschlagen."));
    await load();
  };
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Nutzer verwalten</h1>
      {msg && <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-danger">{msg}</p>}
      <ul className="mb-6 flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 p-3 ${u.active ? "" : "opacity-60"}`}>
            <div className="min-w-40 flex-1"><div className="font-medium">{u.display_name}</div><div className="text-sm text-neutral-600">{u.email}</div></div>
            <select aria-label={`Rolle ${u.display_name}`} className="min-h-11 rounded-lg border px-2" value={u.role} onChange={(e) => patch(u, { role: e.target.value as User["role"] })}>
              <option value="gesellschafter">Gesellschafter</option><option value="trainer">Trainer</option>
            </select>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={u.is_trainer} onChange={(e) => patch(u, { is_trainer: e.target.checked })} />Trainer</label>
            <button className={`min-h-11 rounded-lg border px-3 ${u.active ? "border-danger text-danger" : "border-accent text-accent"}`} onClick={() => patch(u, { active: !u.active })}>
              {u.active ? "Deaktivieren" : "Aktivieren"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4">
        <h2 className="font-semibold">Neuer Nutzer</h2>
        <input name="name" required placeholder="Name" aria-label="Name" className="min-h-11 rounded-lg border px-3" />
        <input name="email" type="email" required placeholder="E-Mail" aria-label="E-Mail" className="min-h-11 rounded-lg border px-3" />
        <select name="role" aria-label="Rolle" className="min-h-11 rounded-lg border px-2" defaultValue="trainer">
          <option value="trainer">Trainer</option><option value="gesellschafter">Gesellschafter</option>
        </select>
        <label className="flex min-h-11 items-center gap-2"><input name="is_trainer" type="checkbox" defaultChecked className="h-5 w-5" />ist Trainer</label>
        <button className="min-h-11 rounded-lg bg-accent px-4 text-accent-foreground">Anlegen</button>
      </form>
    </main>
  );
}

export default function Page() {
  return <AppShell><Users /></AppShell>;
}
