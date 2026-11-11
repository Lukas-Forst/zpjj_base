"use client";
import { Button, Logo } from "./ui";

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 p-5">
      <Logo />
      <h1 className="text-[28px] font-bold leading-8 tracking-[-0.02em]">{title}</h1>
      {children}
    </main>
  );
}

export function Forbidden() {
  return (
    <Page title="Noch nicht freigeschaltet">
      <p>Dein Zugang ist noch nicht freigeschaltet. Bitte melde dich bei den Gesellschaftern.</p>
    </Page>
  );
}

export function Offline() {
  return (
    <Page title="Du bist offline">
      <p>Keine Verbindung zu ZPJJ Base. Der Gym-Timer funktioniert trotzdem, sobald er einmal geladen wurde.</p>
      <Button onClick={() => location.reload()}>Neu laden</Button>
    </Page>
  );
}
