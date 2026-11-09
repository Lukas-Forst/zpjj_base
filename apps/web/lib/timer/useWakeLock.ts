"use client";
import { useEffect, useState } from "react";

/** Holds a screen wake lock while `active`; re-acquires when the tab returns to the foreground. */
export function useWakeLock(active: boolean) {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const ok = "wakeLock" in navigator;
    setSupported(ok);
    if (!ok || !active) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) void l.release(); else lock = l;
      } catch { /* denied (e.g. low battery): the hint stays reachable via `supported` */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
  return { supported };
}
