import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { todayBerlin } from "../src/dates";
import { cleanMd, findCard, isoWeek, parseWeek, resetTrelloCache, weekData } from "../src/trello";
import { addUser, call, resetDb } from "./helpers";

const DESC = `Montag

Einführung Straight Jacket

Wiederholung + Ergänzung Rear Bodylock

Dienstag

Einführung Straight Jacket

Mittwoch

Go Behinds aus Turtle & Back Takes

Freitag

Gi: Bow & Arrow

Sonntag

Anfängerkurs

Folgewoche: Fokus Guillotinen aus der Turtle
`;
const e = env as any;
beforeEach(async () => {
  await resetDb();
  resetTrelloCache();
  for (const k of ["TRELLO_KEY", "TRELLO_TOKEN", "TRELLO_BOARD"]) delete e[k];
});
afterEach(() => vi.unstubAllGlobals());
const stubTrello = (lists: unknown, status = 200) => {
  const f = vi.fn(async () => (status === 200 ? Response.json(lists) : new Response("x", { status })));
  vi.stubGlobal("fetch", f);
  return f;
};
const configure = () => Object.assign(e, { TRELLO_KEY: "k", TRELLO_TOKEN: "t", TRELLO_BOARD: "b" });

it("parse_week", () => {
  const r = parseWeek(DESC);
  expect(r.days[0].topics).toEqual(["Einführung Straight Jacket", "Wiederholung + Ergänzung Rear Bodylock"]);
  expect(r.days[3].topics).toEqual([]);
  expect(r.days[6].topics).toEqual(["Anfängerkurs"]);
  expect(r.next_week).toBe("Fokus Guillotinen aus der Turtle");
});
it("find_card only in Technik", () => {
  const lists = [
    { name: "Archiv", cards: [{ name: "Woche 45", desc: "x" }] },
    { name: "Technik", cards: [{ name: "Woche 44", desc: "a" }, { name: "Woche 45 (Gi)", desc: "b" }] },
  ];
  expect(findCard(lists, 45)!.desc).toBe("b");
  expect(findCard(lists, 46)).toBeNull();
});
it("endpoint (test_endpoint)", async () => {
  await addUser({ email: "t@example.com" });
  const get = async () => (await (await call("/api/today", { as: "t@example.com" })).json()) as any;
  expect((await get()).status).toBe("unconfigured");
  configure();
  const wk = isoWeek(todayBerlin());
  stubTrello([{ name: "Technik", cards: [{ name: `Woche ${wk}`, desc: DESC }] }]);
  const r = await get();
  expect(r.status).toBe("ok");
  expect(r.days).toHaveLength(7);
  expect(r.next_week).toBeTruthy();
  resetTrelloCache();
  stubTrello([]);
  expect((await get()).status).toBe("no_card");
  expect((await call("/api/today")).status).toBe(401);
});
it("endpoint calls Trello with the Python URL and params", async () => {
  await addUser({ email: "t@example.com" });
  configure();
  const f = stubTrello([]);
  await call("/api/today", { as: "t@example.com" });
  const url = new URL(String((f.mock.calls[0] as any)[0]));
  expect(url.origin + url.pathname).toBe("https://api.trello.com/1/boards/b/lists");
  expect(Object.fromEntries(url.searchParams)).toEqual({ key: "k", token: "t", cards: "open", card_fields: "name,desc", fields: "name" });
});
it("status error on failure, stale served after a success, cached for 10 minutes", async () => {
  const day = new Date("2026-11-09T12:00:00Z");
  const lists = [{ name: "Technik", cards: [{ name: "Woche 46", desc: "**Montag**\nA" }] }];
  const f = vi.fn(async () => lists);
  expect((await weekData(f, "2026-11-09")).status).toBe("ok");
  await weekData(f, "2026-11-09");
  expect(f).toHaveBeenCalledTimes(1);
  resetTrelloCache();
  const bad = vi.fn(async () => { throw new Error("down"); });
  const r = await weekData(bad, "2026-11-09");
  expect(r).toEqual({ status: "error", week: 46, days: [], next_week: null, month_theme: null });
  expect(day).toBeTruthy();
  // stale: expire the entry by advancing the clock
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(day);
    await weekData(f, "2026-11-09");
    vi.setSystemTime(new Date(day.getTime() + 601_000));
    expect((await weekData(bad, "2026-11-09")).status).toBe("ok");
  } finally {
    vi.useRealTimers();
  }
});
it("http error status counts as error", async () => {
  await addUser({ email: "t@example.com" });
  configure();
  stubTrello(null, 500);
  const r = (await (await call("/api/today", { as: "t@example.com" })).json()) as any;
  expect(r.status).toBe("error");
});
it("parse_week markdown bold headers", () => {
  const r = parseWeek("**Montag**\nStraight Jacket, 4 Point\n\n**Donnerstag**\n_Tim vertritt Nico_ Straight Jacket\n\n**Freitag**\nA\nGi: B\n\n**Folgewoche:** Fokus Turtle");
  expect(r.days[0].topics).toEqual(["Straight Jacket, 4 Point"]);
  expect(r.days[3].topics).toEqual(["Tim vertritt Nico Straight Jacket"]);
  expect(r.days[4].topics).toEqual(["A", "Gi: B"]);
  expect(r.next_week).toBe("Fokus Turtle");
});
it("clean_md", () => {
  expect(cleanMd("**Back Control**\n\n- Straight Jacket\n- Control")).toBe("Back Control\n\n• Straight Jacket\n• Control");
  expect(cleanMd("_Tim vertritt Nico_ Straight Jacket")).toBe("Tim vertritt Nico Straight Jacket");
  expect(cleanMd("foo_bar_baz")).toBe("foo_bar_baz");
});
it("month theme in week_data", async () => {
  const lists = [{ name: "Technik", cards: [{ name: "Themen November", desc: "**Rear Bodylock**\n- Throws" }, { name: "Woche 46", desc: "**Montag**\n_Tim_ A" }] }];
  const r = await weekData(async () => lists, "2026-11-09");
  expect(r.month_theme).toBe("Rear Bodylock\n• Throws");
  expect(r.days[0].topics).toEqual(["Tim A"]);
  resetTrelloCache();
  expect((await weekData(async () => lists, "2026-12-07")).month_theme).toBeNull(); // no December card
});
it("isoWeek across the year change", () => {
  expect(isoWeek("2026-01-01")).toBe(1);
  expect(isoWeek("2027-01-01")).toBe(53);
  expect(isoWeek("2024-12-30")).toBe(1);
});
