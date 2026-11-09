"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { KEYS, load, save } from "./storage";

export type Preset = components["schemas"]["PresetOut"];

/** Presets from the API, cached locally; on network failure the cache is used. */
export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>(() => []);
  const [fromCache, setFromCache] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.GET("/api/timer-presets");
      if (!data) throw new Error("no data");
      setPresets(data); setFromCache(false); save(KEYS.presets, data);
    } catch {
      setPresets(load<Preset[]>(KEYS.presets, [])); setFromCache(true);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { presets, fromCache, refresh };
}
