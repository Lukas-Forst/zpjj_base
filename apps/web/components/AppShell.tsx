"use client";
import { createContext, useContext } from "react";
import { type Me, useMe } from "@/lib/useMe";
import { AppHeader } from "./ui";
import { Forbidden, Offline } from "./StatusPages";

const MeContext = createContext<Me | null>(null);
export const useCurrentMe = () => useContext(MeContext)!;

/** `bare`: page brings its own header (timer). */
export function AppShell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const s = useMe();
  if (s.status === "forbidden") return <Forbidden />;
  if (s.status === "offline") return <Offline />;
  if (s.status === "loading") return <p className="p-6" role="status">Lade …</p>;
  const me = s.me;
  return (
    <MeContext.Provider value={me}>
      {!bare && <AppHeader initial={me.display_name.slice(0, 1).toUpperCase()} name={me.display_name} />}
      {children}
    </MeContext.Provider>
  );
}
