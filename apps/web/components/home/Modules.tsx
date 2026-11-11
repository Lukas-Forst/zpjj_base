import Link from "next/link";
import { SectionHeader, StatusMark } from "@/components/ui";
import { type ModuleEnv, type Role, visibleModules } from "@/lib/tiles";

export function Modules({ role, env }: { role: Role; env: ModuleEnv }) {
  const mods = visibleModules(role, env);
  return (
    <section aria-label="Module">
      <SectionHeader title="Module" />
      <ul className="grid grid-cols-2 border-l border-hairline lg:grid-cols-6">
        {mods.map((m) => {
          const ext = m.state === "external";
          return (
            <li key={m.id} className="border-b border-r border-hairline">
              <Link href={m.href} className="flex min-h-[52px] items-center justify-between gap-2 px-3 font-semibold"
                {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {m.title}{ext && <StatusMark state="external" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
