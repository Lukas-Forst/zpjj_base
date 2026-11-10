/** Read-only Trello: board list "Technik" -> card "Woche NN" -> description per weekday. */
import { isoWeekday } from "./dates";

export const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const TTL_MS = 600_000;
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

export type Card = { name: string; desc: string };
export type TrelloList = { name: string; cards: Card[] };
export type WeekData = {
  status: "ok" | "no_card" | "error";
  week: number;
  days: { weekday: number; topics: string[] }[];
  next_week: string | null;
  month_theme: string | null;
};

const cache = new Map<string, { at: number; data: WeekData }>();
/** Test hook: forget the per-isolate cache. */
export const resetTrelloCache = (): void => cache.clear();

/** Trello markdown -> plain text: no bold/italic marks, '- ' bullets become '• '. */
export function cleanMd(text: string): string {
  const w = "[\\p{L}\\p{N}_]";
  return text
    .replaceAll("**", "")
    .replace(new RegExp(`(?<!${w})_(.+?)_(?!${w})`, "gu"), "$1")
    .replace(/^[ \t]*[-*] /gm, "• ")
    .trim();
}

const stripChars = (s: string, chars: string) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");

/** Weekday header line starts a day, 'Folgewoche:' ends the days. Blank lines are skipped. */
export function parseWeek(desc: string): { days: { weekday: number; topics: string[] }[]; next_week: string | null } {
  const days = new Map<string, string[]>();
  let cur: string[] | null = null;
  let nextWeek: string | null = null;
  for (const raw of desc.split(new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]"))) {
    const line = raw.trim();
    if (!line) continue;
    const head = stripChars(line, "#*_ :"); // **Montag**, # Montag, Montag:
    if (DAYS.includes(head)) {
      if (!days.has(head)) days.set(head, []);
      cur = days.get(head)!;
    } else if (head.toLowerCase().startsWith("folgewoche")) {
      nextWeek = stripChars(head.slice(head.indexOf(":") + 1), " *_") || null;
      cur = null;
    } else if (cur) {
      cur.push(cleanMd(line));
    }
  }
  return { days: DAYS.map((d, i) => ({ weekday: i, topics: days.get(d) ?? [] })), next_week: nextWeek };
}

export function findCard(lists: TrelloList[], week: number): Card | null {
  for (const l of lists) {
    if (l.name.trim().toLowerCase() !== "technik") continue;
    for (const c of l.cards) {
      const m = /^\s*woche\s*0*(\d+)\b/i.exec(c.name);
      if (m && Number(m[1]) === week) return c;
    }
  }
  return null;
}

function findMonthCard(lists: TrelloList[], month: number): Card | null {
  const want = `themen ${MONTHS[month - 1]}`;
  const l = lists.find((x) => x.name.trim().toLowerCase() === "technik");
  return l?.cards.find((c) => c.name.trim().toLowerCase() === want) ?? null;
}

export async function fetchLists(key: string, token: string, board: string): Promise<TrelloList[]> {
  const q = new URLSearchParams({ key, token, cards: "open", card_fields: "name,desc", fields: "name" });
  const r = await fetch(`https://api.trello.com/1/boards/${board}/lists?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Trello HTTP ${r.status}`);
  return (await r.json()) as TrelloList[];
}

export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekday(iso)); // Thursday of this week
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - y0) / 86_400_000 + 1) / 7);
}

/** ponytail: ISO week number only, a 'Woche 1' card from another year would match. */
export async function weekData(fetchFn: () => Promise<TrelloList[]>, today: string): Promise<WeekData> {
  const week = isoWeek(today);
  const month = Number(today.slice(5, 7));
  const key = `${week}-${month}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let lists: TrelloList[];
  try {
    lists = await fetchFn();
  } catch {
    if (hit) return hit.data; // serve stale rather than nothing
    return { status: "error", week, days: [], next_week: null, month_theme: null };
  }
  const card = findCard(lists, week);
  const mc = findMonthCard(lists, month);
  const theme = mc && mc.desc.trim() ? cleanMd(mc.desc) : null;
  const data: WeekData = card
    ? { status: "ok", ...parseWeek(card.desc), week, month_theme: theme }
    : { status: "no_card", days: [], next_week: null, week, month_theme: theme };
  cache.set(key, { at: Date.now(), data });
  return data;
}
