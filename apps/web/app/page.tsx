"use client";
import { AppShell, roleLabel, useCurrentMe } from "@/components/AppShell";
import { TileGrid } from "@/components/TileGrid";

const env = {
  plannerUrl: process.env.NEXT_PUBLIC_PRODUCTION_PLANNER_URL,
  crmUrl: process.env.NEXT_PUBLIC_CRM_URL,
};

function Home() {
  const me = useCurrentMe();
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-semibold">Hallo {me.display_name}</h1>
      <p className="mb-4 text-sm text-neutral-600">{roleLabel(me)}</p>
      <TileGrid role={me.role} env={env} />
    </main>
  );
}

export default function Page() {
  return <AppShell><Home /></AppShell>;
}
