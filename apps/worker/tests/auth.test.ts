import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadSettings, validateSettings } from "../src/config";
import { resetAuthStateForTests, setJwksFetchForTests, verifyAccessJwt } from "../src/auth";
import type { Bindings } from "../src/types";
import { addUser, call, resetDb } from "./helpers";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag";
const prodEnv = (extra: Partial<Bindings> = {}): Bindings =>
  ({ DB: env.DB, ASSETS: env.ASSETS, ENV: "prod", CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ...extra }) as Bindings;

const b64u = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const makeKey = () =>
  crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

async function mint(key: CryptoKeyPair, o: { email?: string; kid?: string; aud?: string; iss?: string; exp_in?: number; nbf?: unknown } = {}) {
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: o.kid ?? "k1" }));
  const body = b64u(
    JSON.stringify({
      email: o.email ?? "a@example.com",
      aud: [o.aud ?? AUD],
      iss: o.iss ?? `https://${TEAM}`,
      exp: Math.floor(Date.now() / 1000) + (o.exp_in ?? 300),
      ...(o.nbf !== undefined ? { nbf: o.nbf } : {}),
    }),
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

let key: CryptoKeyPair;
let fetchCount = 0;
const jwksFetch = (k: CryptoKeyPair, kid = "k1"): typeof fetch =>
  (async () => {
    fetchCount++;
    return Response.json({ keys: [{ ...(await crypto.subtle.exportKey("jwk", k.publicKey)), kid, alg: "RS256" }] });
  }) as typeof fetch;

beforeAll(async () => {
  key = await makeKey();
});
beforeEach(async () => {
  await resetDb();
  resetAuthStateForTests();
  fetchCount = 0;
  setJwksFetchForTests(jwksFetch(key));
});

const getMe = (token?: string, e: Bindings = prodEnv()) =>
  createApp().fetch(new Request("http://example.com/api/me", { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} }), e);

describe("JWT", () => {
  it("test_valid", async () => {
    await addUser({ email: "a@example.com" });
    const r = await getMe(await mint(key));
    expect(r.status).toBe(200);
    expect((await r.json<{ display_name: string }>()).display_name).toBe("a");
  });

  it.each([{ exp_in: -10 }, { aud: "other" }, { kid: "nope" }, { iss: "https://evil.example" }])("test_invalid_claims %j", async (kw) => {
    await addUser({ email: "a@example.com" });
    expect((await getMe(await mint(key, kw))).status).toBe(401);
  });

  it("test_wrong_signature", async () => {
    await addUser({ email: "a@example.com" });
    expect((await getMe(await mint(await makeKey()))).status).toBe(401);
  });

  it("test_missing_and_garbage", async () => {
    expect((await getMe()).status).toBe(401);
    expect((await getMe("garbage")).status).toBe(401);
  });

  it("test_unknown_email_403_german", async () => {
    const r = await getMe(await mint(key, { email: "who@example.com" }));
    expect(r.status).toBe(403);
    expect((await r.json<{ detail: string }>()).detail).toContain("nicht freigeschaltet");
  });

  it("test_inactive_403", async () => {
    await addUser({ email: "a@example.com", active: false });
    expect((await getMe(await mint(key))).status).toBe(403);
  });

  it("test_email_case_insensitive", async () => {
    await addUser({ email: "a@example.com" });
    expect((await getMe(await mint(key, { email: "A@Example.com" }))).status).toBe(200);
  });

  it("nbf: future and non-numeric rejected, past accepted", async () => {
    await addUser({ email: "a@example.com" });
    const now = Math.floor(Date.now() / 1000);
    expect((await getMe(await mint(key, { nbf: now + 600 }))).status).toBe(401);
    expect((await getMe(await mint(key, { nbf: "soon" }))).status).toBe(401);
    expect((await getMe(await mint(key, { nbf: now - 60 }))).status).toBe(200);
  });

  it("verifyAccessJwt returns the lowercased email and honours injected clock", async () => {
    const tok = await mint(key, { email: "A@Example.com" });
    expect(await verifyAccessJwt(tok, prodEnv(), jwksFetch(key))).toEqual({ email: "a@example.com" });
    const later = () => Date.now() / 1000 + 1000;
    await expect(verifyAccessJwt(tok, prodEnv(), jwksFetch(key), later)).rejects.toMatchObject({ status: 401, detail: "Nicht angemeldet." });
  });

  it("JWKS is cached, unknown kid refetches only after the 30 s floor", async () => {
    let t = 1_000_000;
    const now = () => t;
    const f = jwksFetch(key);
    const good = await mint(key);
    const bad = await mint(key, { kid: "nope" });
    const e = prodEnv();
    // exp is wall-clock based, so keep the injected clock close to it
    t = Math.floor(Date.now() / 1000);
    await verifyAccessJwt(good, e, f, now);
    await verifyAccessJwt(good, e, f, now);
    expect(fetchCount).toBe(1);
    await expect(verifyAccessJwt(bad, e, f, now)).rejects.toThrow();
    expect(fetchCount).toBe(1); // within floor
    t += 31;
    await expect(verifyAccessJwt(bad, e, f, now)).rejects.toThrow();
    expect(fetchCount).toBe(2);
  });
});

describe("test_every_route_protected", () => {
  it("api routes without credentials never reach a handler", async () => {
    for (const [m, p] of [["GET", "/api/me"], ["POST", "/api/me"], ["GET", "/api/does-not-exist"]]) {
      const r = await createApp().fetch(new Request(`http://example.com${p}`, { method: m }), prodEnv());
      expect([401, 403], `${m} ${p}`).toContain(r.status);
    }
  });
  it("test_healthz_open", async () => {
    const r = await createApp().fetch(new Request("http://example.com/healthz"), prodEnv());
    expect(r.status).toBe(200);
  });
  it("test_hsts_header", async () => {
    const r = await call("/healthz");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
  });
});

describe("settings", () => {
  it("test_startup_aborts_dev_email_in_prod", async () => {
    expect(() => validateSettings(loadSettings(prodEnv({ AUTH_DEV_EMAIL: "x@example.com" })))).toThrow("AUTH_DEV_EMAIL");
    // fail closed at request time too
    const r = await createApp().fetch(new Request("http://example.com/api/me"), prodEnv({ AUTH_DEV_EMAIL: "x@example.com" }));
    expect(r.status).toBe(500);
  });
  it("missing CF_ACCESS_* outside dev throws", () => {
    expect(() => validateSettings(loadSettings({ DB: env.DB, ASSETS: env.ASSETS, ENV: "prod" }))).toThrow("required outside dev");
    expect(() => validateSettings(loadSettings({ DB: env.DB, ASSETS: env.ASSETS }))).toThrow("required outside dev"); // default env is prod
    expect(() => validateSettings(loadSettings({ DB: env.DB, ASSETS: env.ASSETS, ENV: "dev" }))).not.toThrow();
  });
  it("invalid GCAL json throws", () => {
    expect(() => validateSettings(loadSettings(prodEnv({ GCAL_SERVICE_ACCOUNT_JSON: "{nope" })))).toThrow("GCAL_SERVICE_ACCOUNT_JSON is not valid JSON");
  });
  it("test_dev_bypass_works_in_dev", async () => {
    await addUser({ email: "d@example.com" });
    const e = { DB: env.DB, ASSETS: env.ASSETS, ENV: "dev", AUTH_DEV_EMAIL: " D@Example.com " } as Bindings;
    expect((await createApp().fetch(new Request("http://example.com/api/me"), e)).status).toBe(200);
  });
  it("X-Test-User is ignored when ENV is not test", async () => {
    await addUser({ email: "a@example.com" });
    const req = () => new Request("http://example.com/api/me", { headers: { "X-Test-User": "a@example.com" } });
    expect((await createApp().fetch(req(), prodEnv())).status).toBe(401);
    expect((await createApp().fetch(req(), prodEnv({ ENV: "dev" }))).status).toBe(401);
  });
});

describe("bootstrap admins", () => {
  it("test_bootstrap_admins: created once, lowercased, gesellschafter", async () => {
    const e = prodEnv({ BOOTSTRAP_ADMIN_EMAILS: " A@Example.com , ,b@example.com" });
    const tok = await mint(key, { email: "a@example.com" });
    expect((await getMe(tok, e)).status).toBe(200);
    resetAuthStateForTests();
    setJwksFetchForTests(jwksFetch(key));
    expect((await getMe(tok, e)).status).toBe(200);
    const rows = (await env.DB.prepare("SELECT email, role FROM users ORDER BY email").all<{ email: string; role: string }>()).results;
    expect(rows).toEqual([
      { email: "a@example.com", role: "gesellschafter" },
      { email: "b@example.com", role: "gesellschafter" },
    ]);
  });
  it("runs once per isolate", async () => {
    const e = prodEnv({ BOOTSTRAP_ADMIN_EMAILS: "a@example.com" });
    const tok = await mint(key);
    await getMe(tok, e);
    await env.DB.prepare("DELETE FROM users").run();
    expect((await getMe(tok, e)).status).toBe(403); // not re-created
  });
});
