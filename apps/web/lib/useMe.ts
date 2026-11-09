"use client";
import { useEffect, useState } from "react";
import { api } from "./api/client";
import type { Role } from "./tiles";

export type Me = { id: number; display_name: string; role: Role; is_trainer: boolean };
export type MeState =
  | { status: "loading" }
  | { status: "ok"; me: Me }
  | { status: "forbidden" }
  | { status: "offline" };

const KEY = "base.me";
const read = (): Me | null => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
};
const write = (me: Me | null) => {
  try { me ? localStorage.setItem(KEY, JSON.stringify(me)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};

export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    (async () => {
      let next: MeState;
      try {
        const { data, response } = await api.GET("/api/me");
        if (response.status === 403) { write(null); next = { status: "forbidden" }; }
        else if (data) { write(data as Me); next = { status: "ok", me: data as Me }; }
        else throw new Error(String(response.status));
      } catch {
        const cached = read(); // offline / network error: fall back to last known user
        next = cached ? { status: "ok", me: cached } : { status: "offline" };
      }
      if (alive) setState(next);
    })();
    return () => { alive = false; };
  }, []);
  return state;
}
