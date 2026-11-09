// TODO: Logo ersetzen (placeholder: small brand-red block + wordmark)
export function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold">
      <span aria-hidden className="inline-block h-5 w-3" style={{ background: "var(--brand-red)" }} />
      ZPJJ Base
    </span>
  );
}
