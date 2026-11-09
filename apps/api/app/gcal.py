"""Google Calendar over plain REST (service account, JWT bearer). No google libs needed."""
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Protocol

import httpx
import jwt

API = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.events"
SUFFIX = " urlaub"


@dataclass
class Event:
    id: str
    title: str
    start: date
    end_inclusive: date
    private_base_id: str | None


class CalendarClient(Protocol):
    def list_events(self, time_min: date, time_max: date) -> list[Event]: ...
    def create(self, title: str, start: date, end_inclusive: date, base_id: int) -> str: ...
    def update(self, event_id: str, start: date, end_inclusive: date) -> None: ...
    def delete(self, event_id: str) -> None: ...


def first_word(s: str) -> str:
    parts = s.strip().split()
    return parts[0].lower() if parts else ""


def match_user(title: str, users: Sequence) -> object | None | Literal["ambiguous"]:
    t = title.strip()
    if not t.lower().endswith(SUFFIX):
        return None
    name = first_word(t[: -len(SUFFIX)])
    hits = [u for u in users if first_word(u.display_name) == name]
    return hits[0] if len(hits) == 1 else ("ambiguous" if hits else None)


def parse_event(raw: dict) -> Event | None:
    """All-day events carry an exclusive end date; timed events count as their start..end day.
    ponytail: an event ending exactly at 00:00 counts that day too."""
    try:
        s, e = raw["start"], raw["end"]
        if "date" in s:
            start = date.fromisoformat(s["date"])
            end = date.fromisoformat(e["date"]) - timedelta(days=1)
        else:
            start, end = date.fromisoformat(s["dateTime"][:10]), date.fromisoformat(e["dateTime"][:10])
    except (KeyError, ValueError):
        return None
    private = raw.get("extendedProperties", {}).get("private", {})
    return Event(raw["id"], raw.get("summary", ""), start, max(start, end), private.get("base_id"))


class GoogleCalendar:
    def __init__(self, calendar_id: str, service_account: dict, http: httpx.Client | None = None):
        self.cal = calendar_id
        self.sa = service_account
        self.http = http or httpx.Client(timeout=15)
        self._token: tuple[str, float] | None = None

    def _auth(self) -> dict:
        if not self._token or self._token[1] < time.time() + 60:
            now = int(time.time())
            assertion = jwt.encode(
                {"iss": self.sa["client_email"], "scope": SCOPE, "aud": "https://oauth2.googleapis.com/token",
                 "iat": now, "exp": now + 3600},
                self.sa["private_key"], algorithm="RS256")
            r = self.http.post("https://oauth2.googleapis.com/token", data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
            r.raise_for_status()
            self._token = (r.json()["access_token"], now + int(r.json().get("expires_in", 3600)))
        return {"Authorization": f"Bearer {self._token[0]}"}

    def _req(self, method: str, path: str = "", **kw) -> httpx.Response:
        r = self.http.request(method, f"{API}/calendars/{self.cal}/events{path}",
                              headers=self._auth(), **kw)
        if r.status_code not in (404, 410) or method != "DELETE":
            r.raise_for_status()
        return r

    def list_events(self, time_min: date, time_max: date) -> list[Event]:
        out, token = [], None
        while True:
            params = {"timeMin": f"{time_min}T00:00:00Z", "timeMax": f"{time_max}T00:00:00Z",
                      "singleEvents": "true", "maxResults": 2500}
            if token:
                params["pageToken"] = token
            data = self._req("GET", params=params).json()
            out += [e for e in map(parse_event, data.get("items", [])) if e]
            token = data.get("nextPageToken")
            if not token:
                return out

    @staticmethod
    def _span(start: date, end_inclusive: date) -> dict:
        return {"start": {"date": start.isoformat()},
                "end": {"date": (end_inclusive + timedelta(days=1)).isoformat()}}

    def create(self, title: str, start: date, end_inclusive: date, base_id: int) -> str:
        body = {"summary": title, **self._span(start, end_inclusive),
                "extendedProperties": {"private": {"base_id": str(base_id)}}}
        return self._req("POST", json=body).json()["id"]

    def update(self, event_id: str, start: date, end_inclusive: date) -> None:
        self._req("PATCH", f"/{event_id}", json=self._span(start, end_inclusive))

    def delete(self, event_id: str) -> None:
        self._req("DELETE", f"/{event_id}")
