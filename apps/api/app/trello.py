"""Read-only Trello: board list "Technik" -> card "Woche NN" -> description per weekday."""
import re
import time
from datetime import date

import httpx

DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
TTL = 600  # seconds
MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september",
          "oktober", "november", "dezember"]
_cache: dict[tuple[int, int], tuple[float, dict]] = {}


def clean_md(text: str) -> str:
    """Trello markdown -> plain text: no bold/italic marks, '- ' bullets become '• '."""
    text = text.replace("**", "")
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", text)
    return re.sub(r"(?m)^[ \t]*[-*] ", "• ", text).strip()


def parse_week(desc: str) -> dict:
    """Weekday header line starts a day, 'Folgewoche:' ends the days. Blank lines are skipped."""
    days: dict[str, list[str]] = {}
    cur: list[str] | None = None
    next_week = None
    for raw in desc.splitlines():
        line = raw.strip()
        head = line.strip("#*_ :")  # Trello markdown: **Montag**, # Montag, Montag:
        if not line:
            continue
        if head in DAYS:
            cur = days.setdefault(head, [])
        elif head.lower().startswith("folgewoche"):
            next_week = head.split(":", 1)[-1].strip(" *_") or None
            cur = None
        elif cur is not None:
            cur.append(clean_md(line))
    return {"days": [{"weekday": i, "topics": days.get(d, [])} for i, d in enumerate(DAYS)],
            "next_week": next_week}


def find_card(lists: list[dict], week: int) -> dict | None:
    for lst in lists:
        if lst["name"].strip().lower() != "technik":
            continue
        for c in lst["cards"]:
            m = re.match(r"\s*woche\s*0*(\d+)\b", c["name"], re.I)
            if m and int(m.group(1)) == week:
                return c
    return None


def find_month_card(lists: list[dict], month: int) -> dict | None:
    want = f"themen {MONTHS[month - 1]}"
    for lst in lists:
        if lst["name"].strip().lower() == "technik":
            return next((c for c in lst["cards"] if c["name"].strip().lower() == want), None)
    return None


def fetch_lists(key: str, token: str, board: str) -> list[dict]:
    r = httpx.get(
        f"https://api.trello.com/1/boards/{board}/lists",
        params={"key": key, "token": token, "cards": "open", "card_fields": "name,desc",
                "fields": "name"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def week_data(fetch, today: date) -> dict:
    """ponytail: ISO week number only, a 'Woche 1' card from another year would match."""
    week = today.isocalendar().week
    key = (week, today.month)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < TTL:
        return hit[1]
    try:
        lists = fetch()
    except httpx.HTTPError:
        if hit:  # serve stale rather than nothing
            return hit[1]
        return {"status": "error", "week": week, "days": [], "next_week": None,
                "month_theme": None}
    card, month = find_card(lists, week), find_month_card(lists, today.month)
    theme = clean_md(month["desc"]) if month and month["desc"].strip() else None
    data = ({"status": "ok", **parse_week(card["desc"])} if card
            else {"status": "no_card", "days": [], "next_week": None}) | {
        "week": week, "month_theme": theme}
    _cache[key] = (time.monotonic(), data)
    return data
