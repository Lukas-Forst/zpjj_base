/** Google Calendar over plain REST (service account, JWT bearer, WebCrypto RS256). */
import { addDays } from "./dates";

const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
export const SUFFIX = " urlaub";

export type CalEvent = { id: string; title: string; start: string; end_inclusive: string; private_base_id: string | null };

export interface CalendarClient {
  listEvents(min: string, max: string): Promise<CalEvent[]>;
  create(title: string, start: string, endInclusive: string, baseId: number): Promise<string>;
  update(id: string, start: string, endInclusive: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export const firstWord = (s: string): string => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export function matchUser<U extends { display_name: string }>(title: string, users: U[]): U | null | "ambiguous" {
  const t = title.trim();
  if (!t.toLowerCase().endsWith(SUFFIX)) return null;
  const name = firstWord(t.slice(0, -SUFFIX.length));
  const hits = users.filter((u) => firstWord(u.display_name) === name);
  return hits.length === 1 ? hits[0] : hits.length ? "ambiguous" : null;
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
/** All-day events carry an exclusive end date; timed events count as start..end day.
 *  ponytail: an event ending exactly at 00:00 counts that day too. */
export function parseEvent(raw: any): CalEvent | null {
  try {
    const s = raw.start;
    const e = raw.end;
    let start: string;
    let end: string;
    if ("date" in s) {
      start = s.date;
      end = addDays(e.date, -1);
      if (!isoDay.test(e.date)) return null;
    } else {
      start = s.dateTime.slice(0, 10);
      end = e.dateTime.slice(0, 10);
    }
    if (!isoDay.test(start) || !isoDay.test(end) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) return null;
    return {
      id: String(raw.id),
      title: raw.summary ?? "",
      start,
      end_inclusive: end < start ? start : end,
      private_base_id: raw.extendedProperties?.private?.base_id ?? null,
    };
  } catch {
    return null;
  }
}

const b64url = (b: ArrayBuffer | string): string => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

async function signJwt(claims: object, pem: string): Promise<string> {
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

export class GoogleCalendar implements CalendarClient {
  private token: { value: string; exp: number } | null = null;
  /** `serviceAccountJson` is the raw secret; parsed lazily so a bad value fails the sync (flagged), not the app. */
  constructor(private cal: string, private serviceAccountJson: string) {}

  private async auth(): Promise<string> {
    if (!this.token || this.token.exp < Date.now() / 1000 + 60) {
      const sa = JSON.parse(this.serviceAccountJson);
      const uri: string = sa.token_uri || DEFAULT_TOKEN_URI;
      const now = Math.floor(Date.now() / 1000);
      const assertion = await signJwt({ iss: sa.client_email, scope: SCOPE, aud: uri, iat: now, exp: now + 3600 }, sa.private_key);
      const r = await fetch(uri, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`Google token HTTP ${r.status}`);
      const j = (await r.json()) as { access_token: string; expires_in?: number };
      this.token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
    }
    return `Bearer ${this.token.value}`;
  }

  private async req(method: string, path = "", init: { params?: Record<string, string>; json?: unknown } = {}): Promise<any> {
    const q = init.params ? `?${new URLSearchParams(init.params)}` : "";
    const r = await fetch(`${API}/calendars/${encodeURIComponent(this.cal)}/events${path}${q}`, {
      method,
      headers: { Authorization: await this.auth(), ...(init.json ? { "Content-Type": "application/json" } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok && !(method === "DELETE" && (r.status === 404 || r.status === 410))) throw new Error(`Google Calendar HTTP ${r.status}`);
    return method === "DELETE" ? null : r.json();
  }

  async listEvents(min: string, max: string): Promise<CalEvent[]> {
    const out: CalEvent[] = [];
    let token: string | undefined;
    do {
      const params: Record<string, string> = { timeMin: `${min}T00:00:00Z`, timeMax: `${max}T00:00:00Z`, singleEvents: "true", maxResults: "2500" };
      if (token) params.pageToken = token;
      const data = await this.req("GET", "", { params });
      for (const it of data.items ?? []) {
        const e = parseEvent(it);
        if (e) out.push(e);
      }
      token = data.nextPageToken;
    } while (token);
    return out;
  }

  private span = (start: string, endInclusive: string) => ({ start: { date: start }, end: { date: addDays(endInclusive, 1) } });

  async create(title: string, start: string, endInclusive: string, baseId: number): Promise<string> {
    const j = await this.req("POST", "", {
      json: { summary: title, ...this.span(start, endInclusive), extendedProperties: { private: { base_id: String(baseId) } } },
    });
    return j.id;
  }
  async update(id: string, start: string, endInclusive: string): Promise<void> {
    await this.req("PATCH", `/${encodeURIComponent(id)}`, { json: this.span(start, endInclusive) });
  }
  async delete(id: string): Promise<void> {
    await this.req("DELETE", `/${encodeURIComponent(id)}`);
  }
}
