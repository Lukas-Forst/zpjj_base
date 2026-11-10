import { afterEach, expect, it, vi } from "vitest";
import { firstWord, GoogleCalendar, matchUser, parseEvent } from "../src/gcal";

afterEach(() => vi.unstubAllGlobals());
const tim = { id: 1, display_name: "Tim Mustermann" };

it("match_user case insensitive and first word", () => {
  expect(matchUser("TIM urlaub", [tim])).toBe(tim);
  expect(matchUser("Tim Urlaub 3 Tage", [tim])).toBeNull();
  expect(matchUser("Nico Urlaub", [tim])).toBeNull();
  expect(matchUser("Tim Urlaub", [tim, { id: 2, display_name: "Tim B" }])).toBe("ambiguous");
  expect(firstWord("  ")).toBe("");
});
it("parse_event all-day end is exclusive", () => {
  const raw = { id: "x", summary: "Tim Urlaub", start: { date: "2026-11-03" }, end: { date: "2026-11-06" }, extendedProperties: { private: { base_id: "7" } } };
  const e = parseEvent(raw)!;
  expect([e.start, e.end_inclusive, e.private_base_id]).toEqual(["2026-11-03", "2026-11-05", "7"]);
  const timed = { id: "y", summary: "Can Urlaub", start: { dateTime: "2026-11-03T09:00:00+01:00" }, end: { dateTime: "2026-11-03T17:00:00+01:00" } };
  expect(parseEvent(timed)!.end_inclusive).toBe("2026-11-03");
  expect(parseEvent({ id: "z", summary: "x" })).toBeNull();
});

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

it("google client http contract (test_google_client_http_contract) and verifiable RS256 JWT", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  const seen: { method: string; url: URL; body: string }[] = [];
  vi.stubGlobal("fetch", async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const body = init.body instanceof URLSearchParams ? init.body.toString() : (init.body ?? "");
    seen.push({ method: init.method ?? "GET", url, body });
    if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "tok", expires_in: 3600 });
    if (init.method === "DELETE") return new Response(null, { status: 410 });
    if (!init.method || init.method === "GET") {
      const page2 = url.searchParams.has("pageToken");
      return Response.json({ items: [{ id: page2 ? "p2" : "p1", summary: "Tim Urlaub", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }], ...(page2 ? {} : { nextPageToken: "n" }) });
    }
    expect(init.headers.Authorization).toBe("Bearer tok");
    return Response.json({ id: "new1" });
  });
  const cal = new GoogleCalendar("cal@x", JSON.stringify({ client_email: "sa@x", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" }));
  expect((await cal.listEvents("2026-11-01", "2027-01-01")).map((e) => e.id)).toEqual(["p1", "p2"]);
  const list = seen.find((s) => s.url.pathname.endsWith("/events"))!;
  expect(list.url.searchParams.get("timeMin")).toBe("2026-11-01T00:00:00Z");
  expect(list.url.searchParams.get("singleEvents")).toBe("true");
  expect(await cal.create("Tim Urlaub", "2026-11-03", "2026-11-05", 7)).toBe("new1");
  const post = JSON.parse(seen.find((s) => s.method === "POST" && s.url.host !== "oauth2.googleapis.com")!.body);
  expect(post.end.date).toBe("2026-11-06"); // exclusive
  expect(post.extendedProperties.private.base_id).toBe("7");
  await cal.update("e1", "2026-11-03", "2026-11-04");
  expect(JSON.parse(seen.find((s) => s.method === "PATCH")!.body).end.date).toBe("2026-11-05");
  await cal.delete("gone"); // 410 is fine
  expect(seen.filter((s) => s.url.host === "oauth2.googleapis.com")).toHaveLength(1); // token cached

  const form = new URLSearchParams(seen.find((s) => s.url.host === "oauth2.googleapis.com")!.body);
  expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, p, s] = form.get("assertion")!.split(".");
  expect(JSON.parse(new TextDecoder().decode(unb64url(h)))).toEqual({ alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(new TextDecoder().decode(unb64url(p)));
  expect(claims).toMatchObject({ iss: "sa@x", scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token" });
  expect(claims.exp - claims.iat).toBe(3600);
  expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, unb64url(s), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
});
it("token is refreshed shortly before expiry", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
  let tokens = 0;
  vi.stubGlobal("fetch", async (input: any) => {
    if (String(input).includes("oauth2")) { tokens++; return Response.json({ access_token: "t", expires_in: 100 }); }
    return Response.json({ items: [] });
  });
  const cal = new GoogleCalendar("c", JSON.stringify({ client_email: "a", private_key: pem }));
  await cal.listEvents("2026-11-01", "2026-12-01");
  await cal.listEvents("2026-11-01", "2026-12-01");
  expect(tokens).toBe(1); // expires_in 100 > 60 s margin
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 50_000);
    await cal.listEvents("2026-11-01", "2026-12-01");
    expect(tokens).toBe(2);
  } finally { vi.useRealTimers(); }
});
it("a failing Google call rejects", async () => {
  vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
  await expect(new GoogleCalendar("c", "{}").listEvents("2026-11-01", "2026-12-01")).rejects.toThrow();
});
