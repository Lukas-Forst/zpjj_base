type Tab = { id: string; label: string };

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-2 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => onChange(t.id)}
          className={`min-h-11 whitespace-nowrap rounded-lg border px-4 ${t.id === active ? "border-accent bg-accent text-accent-foreground" : "border-neutral-300"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
