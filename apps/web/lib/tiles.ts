export type Role = "gesellschafter" | "trainer";
export type TileState = "active" | "soon" | "external";
export type Tile = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  state: TileState;
  href?: string;
  /** external tile whose env URL is missing -> rendered disabled */
  disabled: boolean;
};

export type TileEnv = { plannerUrl?: string; crmUrl?: string };

// Order = frequency of use, admin last. Timer is the hero tile (rendered separately).
export function visibleTiles(role: Role, env: TileEnv): Tile[] {
  const ext = (id: string, title: string, sub: string, icon: string, url?: string): Tile => ({
    id, title, sub, icon, state: "external", href: url || undefined, disabled: !url,
  });
  const soon = (id: string, title: string, sub: string, icon: string): Tile => ({
    id, title, sub, icon, state: "soon", disabled: true,
  });
  const tiles: Tile[] = [
    { id: "timer", title: "Gym-Timer", sub: "Runden, Countdown, Stoppuhr", icon: "⏱", state: "soon", disabled: true },
    { id: "stundenplan", title: "Stundenplan", sub: "Wochenplan mit Trainern", icon: "📅", state: "active", href: "/stundenplan/", disabled: false },
    soon("heute", "Heute", "Nächste Einheit", "☀"),
    soon("urlaub", "Urlaub", "Abwesenheiten im Team", "🏖"),
    soon("anwesenheit", "Anwesenheit", "Zahlen pro Einheit", "👥"),
    ext("planer", "Produktionsplaner", "Merch und Produktion", "🏭", env.plannerUrl),
    ext("crm", "CRM", "Kontakte und Probetrainings", "🗂", env.crmUrl),
  ];
  if (role === "gesellschafter") {
    tiles.push({ id: "admin", title: "Admin", sub: "Nutzer verwalten", icon: "⚙", state: "active", href: "/admin/nutzer/", disabled: false });
  }
  return tiles;
}
