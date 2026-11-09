// localStorage can throw (private mode, blocked data): always degrade silently.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const KEYS = { last: "base.timer.last", presets: "base.timer.presets", audio: "base.timer.audio" } as const;
