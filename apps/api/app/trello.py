"""Read-only Trello: board list "Technik" -> card "Woche NN" -> description per weekday."""
import re
import time
from datetime import date

import httpx

DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
TTL = 600  # seconds
_cache: dict[int, tuple[float, dict]] = {}


def parse_week(desc: str) -> dict:
    """Weekday header line starts a day, 'Folgewoche:' ends the days. Blank lines are skipped."""
    days: dict[str, list[str]] = {}
    cur: list[str] | None = None
    next_week = None
    for raw in desc.splitlines():
        line = raw.strip().lstrip("#*- ").strip()
        if not line:
            continue
        if line.rstrip(":") in DAYS:
            cur = days.setdefault(line.rstrip(":"), [])
        elif line.lower().startswith("folgewoche"):
            next_week = line.split(":", 1)[-1].strip() or None
            cur = None
        elif cur is not None:
            cur.append(line)
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
    hit = _cache.get(week)
    if hit and time.monotonic() - hit[0] < TTL:
        return hit[1]
    try:
        card = find_card(fetch(), week)
    except httpx.HTTPError:
        if hit:  # serve stale rather than nothing
            return hit[1]
        return {"status": "error", "week": week, "days": [], "next_week": None}
    data = ({"status": "ok", **parse_week(card["desc"])} if card
            else {"status": "no_card", "days": [], "next_week": None}) | {"week": week}
    _cache[week] = (time.monotonic(), data)
    return data
