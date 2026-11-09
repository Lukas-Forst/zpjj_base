"use client";
import { Button, Drawer } from "@heroui/react";
import Link from "next/link";
import { createContext, useContext } from "react";
import { type Me, useMe } from "@/lib/useMe";
import { Logo } from "./Logo";
import { Forbidden, Offline } from "./StatusPages";

const MeContext = createContext<Me | null>(null);
export const useCurrentMe = () => useContext(MeContext)!;

const ROLE_LABEL = { gesellschafter: "Gesellschafter", trainer: "Trainer" } as const;
export const roleLabel = (m: Me) => ROLE_LABEL[m.role] + (m.role === "gesellschafter" && m.is_trainer ? " und Trainer" : "");

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/stundenplan/", label: "Stundenplan" },
];

export function AppShell({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  const s = useMe();
  if (s.status === "forbidden") return <Forbidden />;
  if (s.status === "offline") return <Offline />;
  if (s.status === "loading") return <p className="p-6" role="status">Lade …</p>;
  const me = s.me;
  const links = me.role === "gesellschafter" ? [...LINKS, { href: "/admin/nutzer/", label: "Nutzer verwalten" }] : LINKS;
  return (
    <MeContext.Provider value={me}>
      <header className={`sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 ${dark ? "border-[#2B3A5E] bg-[#131C33] text-[#F4F7FF]" : "border-divider bg-background"}`}>
        <Drawer>
          <Drawer.Trigger className="min-h-11 min-w-11 rounded-lg px-3 text-xl" aria-label="Menü öffnen">☰</Drawer.Trigger>
          <Drawer.Backdrop>
            <Drawer.Content placement="left">
              <Drawer.Dialog>
                <Drawer.Header><Drawer.Heading>Menü</Drawer.Heading></Drawer.Header>
                <Drawer.Body>
                  <nav className="flex flex-col gap-1">
                    {links.map((l) => (
                      <Link key={l.href} href={l.href} className="rounded-lg px-3 py-3 hover:bg-default">{l.label}</Link>
                    ))}
                  </nav>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
        <Link href="/" aria-label="Zur Startseite"><Logo /></Link>
        <Button variant="secondary" aria-label={`Konto: ${me.display_name}`} isDisabled>{me.display_name}</Button>
      </header>
      {children}
    </MeContext.Provider>
  );
}
