import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-xl font-bold tracking-tight">
      <span aria-hidden className="inline-block h-[22px] w-1.5 bg-brand-red" />
      ZPJJ Base
    </span>
  );
}

export function AppHeader({ initial, name }: { initial: string; name: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-hairline bg-paper">
      <div className="mx-auto flex h-[60px] max-w-[1280px] items-center justify-between px-5 lg:px-12">
        <Link href="/" aria-label="Zur Startseite"><Logo /></Link>
        <span role="img" aria-label={`Konto: ${name}`}
          className="flex size-11 items-center justify-center rounded-full border border-hairline-strong text-sm font-semibold">
          {initial}
        </span>
      </div>
    </header>
  );
}

export function SectionHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
      <h2 className="text-lg font-bold">{title}</h2>
      {aside != null && <span className="font-mono text-xs font-medium text-muted-ink">{aside}</span>}
    </div>
  );
}

export function ListRow({ href, children, aside }: { href?: string; children: ReactNode; aside?: ReactNode }) {
  const cls = "flex min-h-11 items-center justify-between gap-3 border-b border-hairline py-2";
  const body = <><span className="min-w-0">{children}</span>{aside != null && <span className="shrink-0 text-sm text-muted-ink">{aside}</span>}</>;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

const SLOT = {
  nogi: ["bg-ink text-paper", "No-Gi"],
  gi: ["border-[1.5px] border-ink", "Gi"],
  openmat: ["bg-open-mat text-open-mat-ink", "Open Mat"],
} as const;
export type SlotKind = keyof typeof SLOT;
export function SlotTag({ kind }: { kind: SlotKind }) {
  const [cls, label] = SLOT[kind];
  return <span className={`inline-block px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

const BTN = "inline-flex min-h-11 items-center justify-center bg-action px-4 font-semibold text-action-ink disabled:opacity-50";
export function Button({ href, children, ...rest }: { href?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return href
    ? <Link href={href} className={BTN}>{children}</Link>
    : <button type="button" {...rest} className={BTN}>{children}</button>;
}

/** Secondary action: outlined in the action color. */
export function OutlineButton({ children, ...rest }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className="inline-flex min-h-11 items-center justify-center border border-action px-4 font-semibold text-action disabled:opacity-50">{children}</button>;
}

export const FIELD = "min-h-11 border border-hairline-strong bg-paper px-2";

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-6 text-[28px] font-bold leading-8 tracking-[-0.02em] lg:text-[40px] lg:leading-[44px]">{children}</h1>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p role="alert" className="mb-3 border-l-4 border-warn py-1 pl-3 font-semibold">{children}</p>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center gap-1 font-semibold text-action">{children}<ArrowRight size={16} strokeWidth={1.75} aria-hidden /></Link>;
}

export function StatusMark({ state }: { state: "active" | "soon" | "external" }) {
  if (state === "external") return <ArrowUpRight size={16} strokeWidth={1.75} aria-label="Öffnet in neuem Tab" role="img" />;
  if (state === "soon") return <span aria-hidden className="inline-block h-2 w-[30px] border border-ink" />;
  return <span aria-hidden className="inline-block h-2 w-[30px] bg-ink"><span className="float-right h-full w-2 bg-brand-red" /></span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-3 text-muted-ink">{children}</p>;
}
