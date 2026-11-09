import { Chip } from "@heroui/react";
import { type Tile, type TileEnv, type Role, visibleTiles } from "@/lib/tiles";

function TileBody({ t, hero }: { t: Tile; hero?: boolean }) {
  return (
    <>
      <span aria-hidden className="text-2xl">{t.icon}</span>
      <span className="font-semibold">{t.title}</span>
      <span className={`text-sm ${hero && !t.disabled ? "text-white/90" : "text-neutral-600"}`}>{t.sub}</span>
      {t.state === "soon" && <Chip size="sm" className="absolute right-2 top-2">bald</Chip>}
      {t.state === "external" && !t.disabled && (
        <span aria-label="Öffnet in neuem Tab" className="absolute right-3 top-2">↗</span>
      )}
      {t.state === "external" && t.disabled && (
        <Chip size="sm" className="absolute right-2 top-2">nicht eingerichtet</Chip>
      )}
    </>
  );
}

function TileView({ t, hero }: { t: Tile; hero?: boolean }) {
  const base = `relative flex min-h-28 flex-col items-start justify-end gap-1 rounded-2xl border p-4 text-left ${hero ? "col-span-full" : ""}`;
  if (t.disabled || !t.href) {
    return (
      <div aria-disabled="true" className={`${base} border-neutral-200 bg-neutral-100 text-neutral-600`}>
        <TileBody t={t} hero={hero} />
      </div>
    );
  }
  const ext = t.state === "external";
  const look = hero ? "border-transparent bg-accent text-accent-foreground" : "border-neutral-200 bg-white text-accent shadow-sm";
  return (
    <a href={t.href} className={`${base} ${look}`} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      <TileBody t={t} hero={hero} />
    </a>
  );
}

export function TileGrid({ role, env }: { role: Role; env: TileEnv }) {
  const [timer, ...rest] = visibleTiles(role, env);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <TileView t={timer} hero />
      {rest.map((t) => <TileView key={t.id} t={t} />)}
    </div>
  );
}
