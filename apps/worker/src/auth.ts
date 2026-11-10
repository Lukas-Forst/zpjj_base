import type { MiddlewareHandler } from "hono";
import { loadSettings, validateSettings } from "./config";
import { first, run } from "./db";
import { HttpError } from "./errors";
import type { AppEnv, Bindings, User } from "./types";

const JWKS_TTL = 3600;
const JWKS_MIN_REFRESH = 30; // seconds between refreshes triggered by unknown kids
export const FORBIDDEN_MSG = "Dein Zugang ist noch nicht freigeschaltet. Bitte melde dich bei den Gesellschaftern.";
const UNAUTH = () => new HttpError(401, "Nicht angemeldet.");

// Module-level state lives per isolate; tests reset it via resetAuthStateForTests().
let jwks: { url: string; keys: Map<string, CryptoKey>; fetchedAt: number | null } | null = null;
let bootstrapped: Promise<void> | null = null;
let jwksFetcher: typeof fetch = (...a) => fetch(...a);

/** Test seam: inject the JWKS fetch used by the middleware. */
export function setJwksFetchForTests(f: typeof fetch): void {
  jwksFetcher = f;
}
export function resetAuthStateForTests(): void {
  jwks = null;
  bootstrapped = null;
  jwksFetcher = (...a) => fetch(...a);
}

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string): Record<string, unknown> => {
  const v = JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
  if (typeof v !== "object" || v === null) throw new Error("bad json");
  return v;
};

async function keyFor(kid: string, url: string, fetchJwks: typeof fetch, now: number): Promise<CryptoKey | undefined> {
  if (!jwks || jwks.url !== url) jwks = { url, keys: new Map(), fetchedAt: null };
  const j = jwks;
  const age = j.fetchedAt === null ? null : now - j.fetchedAt;
  if (age === null || age > JWKS_TTL || (!j.keys.has(kid) && age > JWKS_MIN_REFRESH)) {
    try {
      const res = await fetchJwks(url);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
      const keys = new Map<string, CryptoKey>();
      for (const k of data.keys ?? []) {
        if (!k.kid) continue;
        try {
          keys.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
        } catch {
          /* skip unusable key */
        }
      }
      j.keys = keys;
      j.fetchedAt = now;
    } catch {
      console.warn("JWKS refresh failed");
    }
  }
  return j.keys.get(kid);
}

export async function verifyAccessJwt(
  token: string,
  e: Bindings,
  fetchJwks: typeof fetch = jwksFetcher,
  now: () => number = () => Date.now() / 1000,
): Promise<{ email: string }> {
  try {
    const st = loadSettings(e);
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    const header = b64urlJson(parts[0]!);
    const claims = b64urlJson(parts[1]!);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("header");
    const t = now();
    const key = await keyFor(header.kid, `https://${st.cfAccessTeamDomain}/cdn-cgi/access/certs`, fetchJwks, t);
    if (!key) throw new Error("unknown kid");
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlBytes(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) throw new Error("signature");
    if (typeof claims.exp !== "number" || claims.exp <= t) throw new Error("exp");
    if (claims.iss !== `https://${st.cfAccessTeamDomain}`) throw new Error("iss");
    const aud = claims.aud;
    if (!(Array.isArray(aud) ? aud.includes(st.cfAccessAud) : aud === st.cfAccessAud)) throw new Error("aud");
    return { email: String(claims.email ?? "").trim().toLowerCase() };
  } catch {
    throw UNAUTH();
  }
}

/** Insert-or-ignore, once per isolate (retried if it failed). */
export function ensureBootstrapAdmins(e: Bindings): Promise<void> {
  bootstrapped ??= (async () => {
    const now = new Date().toISOString();
    for (const email of loadSettings(e).bootstrapAdminEmails) {
      await run(
        e.DB,
        "INSERT OR IGNORE INTO users (email, display_name, role, is_trainer, active, created_at, updated_at) VALUES (?,?,'gesellschafter',0,1,?,?)",
        email,
        email.split("@")[0],
        now,
        now,
      );
    }
  })().catch((err) => {
    bootstrapped = null;
    throw err;
  });
  return bootstrapped;
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const st = loadSettings(c.env);
  validateSettings(st);
  await ensureBootstrapAdmins(c.env);
  let email: string;
  const testUser = c.req.header("X-Test-User");
  if (st.authDevEmail && st.env === "dev") {
    email = st.authDevEmail;
  } else if (st.env === "test" && testUser) {
    email = testUser.trim().toLowerCase();
  } else {
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) throw UNAUTH();
    email = (await verifyAccessJwt(token, c.env)).email;
  }
  const row = email
    ? await first<{ id: number; email: string; display_name: string; role: User["role"]; is_trainer: number; active: number }>(
        c.env.DB,
        "SELECT id, email, display_name, role, is_trainer, active FROM users WHERE email = ?",
        email,
      )
    : null;
  if (!row || !row.active) throw new HttpError(403, FORBIDDEN_MSG);
  c.set("user", { ...row, is_trainer: !!row.is_trainer, active: true });
  await next();
};

export const requireGesellschafter: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.user.role !== "gesellschafter") throw new HttpError(403, "Nur für Gesellschafter.");
  await next();
};
