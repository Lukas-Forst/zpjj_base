"use client";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { Modules } from "@/components/home/Modules";
import { Open } from "@/components/home/Open";
import { Today } from "@/components/home/Today";
import { TimerRow } from "@/components/home/TimerRow";

const env = {
  plannerUrl: process.env.NEXT_PUBLIC_PRODUCTION_PLANNER_URL,
  crmUrl: process.env.NEXT_PUBLIC_CRM_URL,
};

function Home() {
  const me = useCurrentMe();
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-5 py-6 lg:px-12">
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <Today />
        <div className="flex flex-col gap-8">
          <Open />
          <TimerRow />
        </div>
      </div>
      <Modules role={me.role} env={env} />
    </main>
  );
}

export default function Page() {
  return <AppShell><Home /></AppShell>;
}
