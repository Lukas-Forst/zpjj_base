"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { Button, FIELD, ListRow, Notice, OutlineButton, PageTitle, SectionHeader } from "@/components/ui";
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
  if (me.role !== "gesellschafter") return <p role="alert" className="p-5">Nur für Gesellschafter.</p>;

  const patch = async (u: User, body: Patch) => {
    const { response, error } = await api.PATCH("/api/users/{user_id}", { params: { path: { user_id: u.id } }, body });
    setMsg(response.ok ? "" : errText(error, "Änderung fehlgeschlagen."));
    await load();
  };
  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget; // currentTarget is null after the first await
    const f = new FormData(form);
    const { response, error } = await api.POST("/api/users", {
      body: { email: String(f.get("email")), display_name: String(f.get("name")), role: f.get("role") as "trainer", is_trainer: f.get("is_trainer") === "on" },
    });
    if (response.ok) { form.reset(); setMsg(""); } else setMsg(errText(error, "Anlegen fehlgeschlagen."));
    await load();
  };
  return (
    <main className="mx-auto max-w-3xl px-5 py-6">
      <PageTitle>Nutzer verwalten</PageTitle>
      {msg && <Notice>{msg}</Notice>}
      <SectionHeader title="Nutzer" aside={users.length} />
      <ul className="mb-8">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-3 border-b border-hairline py-3 ${u.active ? "" : "opacity-60"}`}>
            <div className="min-w-40 flex-1"><div className="font-medium">{u.display_name}</div><div className="text-sm text-muted-ink">{u.email}</div></div>
            <select aria-label={`Rolle ${u.display_name}`} className={FIELD} value={u.role} onChange={(e) => patch(u, { role: e.target.value as User["role"] })}>
              <option value="gesellschafter">Gesellschafter</option><option value="trainer">Trainer</option>
            </select>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={u.is_trainer} onChange={(e) => patch(u, { is_trainer: e.target.checked })} />Trainer</label>
            <OutlineButton onClick={() => patch(u, { active: !u.active })}>{u.active ? "Deaktivieren" : "Aktivieren"}</OutlineButton>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-3">
        <SectionHeader title="Neuer Nutzer" />
        <input name="name" required placeholder="Name" aria-label="Name" className={FIELD} />
        <input name="email" type="email" required placeholder="E-Mail" aria-label="E-Mail" className={FIELD} />
        <select name="role" aria-label="Rolle" className={FIELD} defaultValue="trainer">
          <option value="trainer">Trainer</option><option value="gesellschafter">Gesellschafter</option>
        </select>
        <label className="flex min-h-11 items-center gap-2"><input name="is_trainer" type="checkbox" defaultChecked className="h-5 w-5" />ist Trainer</label>
        <Button type="submit">Anlegen</Button>
      </form>
    </main>
  );
}

export default function Page() {
  return <AppShell><Users /></AppShell>;
}
