export type Role = "gesellschafter" | "trainer";
export type ModuleState = "active" | "external";
export type Module = { id: string; title: string; href: string; state: ModuleState };
export type ModuleEnv = { plannerUrl?: string; crmUrl?: string };

// External modules without a configured URL are left out (no placeholder cells). Admin only for gesellschafter.
export function visibleModules(role: Role, env: ModuleEnv): Module[] {
  const m: Module[] = [
    { id: "stundenplan", title: "Stundenplan", href: "/stundenplan/", state: "active" },
    { id: "urlaub", title: "Urlaub", href: "/urlaub/", state: "active" },
    { id: "anwesenheit", title: "Anwesenheit", href: "/anwesenheit/", state: "active" },
  ];
  if (env.plannerUrl) m.push({ id: "planer", title: "Produktion", href: env.plannerUrl, state: "external" });
  if (env.crmUrl) m.push({ id: "crm", title: "CRM", href: env.crmUrl, state: "external" });
  if (role === "gesellschafter") m.push({ id: "admin", title: "Admin", href: "/admin/nutzer/", state: "active" });
  return m;
}
