type Tab = { id: string; label: string };

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-6 flex gap-5 overflow-x-auto border-b border-hairline">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => onChange(t.id)}
          className={`-mb-px min-h-11 whitespace-nowrap border-b-2 ${t.id === active ? "border-ink font-bold" : "border-transparent text-muted-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
