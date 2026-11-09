"use client";
import { Logo } from "./Logo";

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold">{title}</h1>
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
      <p>Keine Verbindung zum Hub. Der Gym-Timer funktioniert trotzdem, sobald er einmal geladen wurde.</p>
      <button className="rounded-lg bg-accent px-4 py-3 text-accent-foreground" onClick={() => location.reload()}>
        Neu laden
      </button>
    </Page>
  );
}
