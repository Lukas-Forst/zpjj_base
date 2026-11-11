import { AppHeader, Button, EmptyState, ListRow, SectionHeader, SlotTag, StatusMark, TextLink } from "@/components/ui";

export default function Page() {
  if (process.env.NODE_ENV === "production") return <p className="p-5">Nicht verfügbar.</p>;
  return (
    <>
      <AppHeader initial="L" name="Beispiel" />
      <main className="mx-auto flex max-w-xl flex-col gap-8 p-5">
        <p className="font-mono text-xs font-semibold">BEISPIELDATEN</p>
        <section><SectionHeader title="Heute" aside="MI 11.11." />
          <ListRow href="/stundenplan/" aside="Trainer A">Do 18:00 · <SlotTag kind="nogi" /></ListRow>
          <ListRow aside="Trainer B"><SlotTag kind="gi" /></ListRow>
          <ListRow><SlotTag kind="openmat" /></ListRow>
          <EmptyState>Heute kein Training.</EmptyState>
        </section>
        <section className="flex items-center gap-4"><Button>Eintragen</Button><TextLink href="/">Wählen</TextLink></section>
        <section className="flex items-center gap-4"><StatusMark state="active" /><StatusMark state="soon" /><StatusMark state="external" /></section>
      </main>
    </>
  );
}
