from datetime import date, datetime, timedelta
from itertools import count

import pytest
from sqlalchemy import select

from app.calsync import sync
from app.gcal import Event, match_user, parse_event
from app.models import SyncState, User, Vacation, VacationSource

TODAY = date(2026, 11, 9)
NOW = datetime(2026, 11, 9, 12, 0)
D1, D2 = TODAY + timedelta(days=3), TODAY + timedelta(days=5)


class FakeCalendar:
    def __init__(self):
        self.events: dict[str, Event] = {}
        self.fail_list = False
        self.fail_create = False
        self._ids = count(1)

    def list_events(self, time_min, time_max):
        if self.fail_list:
            raise RuntimeError("google down")
        return list(self.events.values())

    def create(self, title, start, end_inclusive, base_id):
        if self.fail_create:
            raise RuntimeError("create failed")
        eid = f"e{next(self._ids)}"
        self.events[eid] = Event(eid, title, start, end_inclusive, str(base_id))
        return eid

    def update(self, event_id, start, end_inclusive):
        e = self.events[event_id]
        self.events[event_id] = Event(e.id, e.title, start, end_inclusive, e.private_base_id)

    def delete(self, event_id):
        self.events.pop(event_id, None)

    def add_manual(self, title, start, end_inclusive):
        eid = f"m{next(self._ids)}"
        self.events[eid] = Event(eid, title, start, end_inclusive, None)
        return eid


@pytest.fixture
def db(app):
    with app.state.session_factory() as s:
        yield s


@pytest.fixture
def cal():
    return FakeCalendar()


def mk_user(db, name, email=None):
    u = User(email=email or f"{name.lower()}@example.com", display_name=name, role="trainer",
             is_trainer=True)
    db.add(u)
    db.commit()
    return u


def mk_vac(db, user, a=D1, b=D2, source=VacationSource.base, eid=None):
    v = Vacation(user_id=user.id, start_date=a, end_date=b, source=source, gcal_event_id=eid)
    db.add(v)
    db.commit()
    return v


def vacs(db):
    db.expire_all()
    return db.scalars(select(Vacation)).all()


def test_base_vacation_is_created_in_calendar(db, cal):
    tim = mk_user(db, "Tim Mustermann")
    v = mk_vac(db, tim)
    sync(db, cal, TODAY, NOW)
    (e,) = cal.events.values()
    assert (e.title, e.start, e.end_inclusive, e.private_base_id) == ("Tim Urlaub", D1, D2,
                                                                      str(v.id))
    assert vacs(db)[0].gcal_event_id == e.id
    st = db.get(SyncState, 1)
    assert st.last_ok_at == NOW and st.error is None


def test_event_deleted_by_hand_is_restored(db, cal):
    mk_vac(db, mk_user(db, "Tim"))
    sync(db, cal, TODAY, NOW)
    cal.events.clear()
    sync(db, cal, TODAY, NOW)
    assert len(cal.events) == 1 and vacs(db)[0].gcal_event_id in cal.events


def test_event_changed_by_hand_is_reset(db, cal):
    mk_vac(db, mk_user(db, "Tim"))
    sync(db, cal, TODAY, NOW)
    eid = next(iter(cal.events))
    cal.update(eid, D1, D1)
    sync(db, cal, TODAY, NOW)
    assert cal.events[eid].end_inclusive == D2


def test_manual_event_becomes_calendar_vacation(db, cal):
    nico = mk_user(db, "Nico")
    eid = cal.add_manual("nico urlaub", D1, D2)
    sync(db, cal, TODAY, NOW)
    (v,) = vacs(db)
    assert (v.user_id, v.source, v.gcal_event_id, v.start_date, v.end_date) == (
        nico.id, VacationSource.calendar, eid, D1, D2)
    sync(db, cal, TODAY, NOW)  # idempotent
    assert len(vacs(db)) == 1


def test_manual_event_removed_removes_calendar_vacation(db, cal):
    mk_user(db, "Nico")
    eid = cal.add_manual("Nico Urlaub", D1, D2)
    sync(db, cal, TODAY, NOW)
    del cal.events[eid]
    sync(db, cal, TODAY, NOW)
    assert vacs(db) == []


def test_base_vacation_deleted_removes_event(db, cal):
    v = mk_vac(db, mk_user(db, "Tim"))
    sync(db, cal, TODAY, NOW)
    db.delete(v)
    db.commit()
    sync(db, cal, TODAY, NOW)
    assert cal.events == {}


def test_failed_fetch_changes_nothing_and_sets_error(db, cal):
    mk_user(db, "Nico")
    cal.add_manual("Nico Urlaub", D1, D2)
    sync(db, cal, TODAY, NOW)
    cal.fail_list = True
    sync(db, cal, TODAY, NOW + timedelta(minutes=15))
    assert len(vacs(db)) == 1
    st = db.get(SyncState, 1)
    assert st.error and st.error_since == NOW + timedelta(minutes=15)
    sync(db, cal, TODAY, NOW + timedelta(minutes=30))  # still failing: error_since stays
    assert db.get(SyncState, 1).error_since == NOW + timedelta(minutes=15)
    cal.fail_list = False
    sync(db, cal, TODAY, NOW + timedelta(minutes=45))
    st = db.get(SyncState, 1)
    assert st.error is None and st.error_since is None


def test_failure_while_writing_rolls_back_and_flags(db, cal):
    v = mk_vac(db, mk_user(db, "Tim"))
    cal.fail_create = True
    sync(db, cal, TODAY, NOW)
    assert vacs(db)[0].id == v.id and vacs(db)[0].gcal_event_id is None
    assert db.get(SyncState, 1).error


def test_unmatched_and_ambiguous_are_reported(db, cal):
    mk_user(db, "Tim A", "a@example.com")
    mk_user(db, "Tim B", "b@example.com")
    cal.add_manual("Tim Urlaub", D1, D2)
    cal.add_manual("Hochzeit", D1, D2)
    cal.add_manual("Unbekannt Urlaub", D1, D2)
    sync(db, cal, TODAY, NOW)
    assert vacs(db) == []
    assert sorted(db.get(SyncState, 1).unmatched) == ["Hochzeit", "Tim Urlaub", "Unbekannt Urlaub"]


def test_match_user_case_insensitive_and_first_word(db):
    tim = mk_user(db, "Tim Mustermann")
    users = [tim]
    assert match_user("TIM urlaub", users) is tim
    assert match_user("Tim Urlaub 3 Tage", users) is None
    assert match_user("Nico Urlaub", users) is None


def test_parse_event_all_day_end_is_exclusive():
    raw = {"id": "x", "summary": "Tim Urlaub", "start": {"date": "2026-11-03"},
           "end": {"date": "2026-11-06"},
           "extendedProperties": {"private": {"base_id": "7"}}}
    e = parse_event(raw)
    assert (e.start, e.end_inclusive, e.private_base_id) == (date(2026, 11, 3), date(2026, 11, 5),
                                                             "7")
    timed = {"id": "y", "summary": "Can Urlaub", "start": {"dateTime": "2026-11-03T09:00:00+01:00"},
             "end": {"dateTime": "2026-11-03T17:00:00+01:00"}}
    assert parse_event(timed).end_inclusive == date(2026, 11, 3)
    assert parse_event({"id": "z", "summary": "x"}) is None


def test_google_client_http_contract():
    import json

    import httpx
    from cryptography.hazmat.primitives import serialization

    from app.gcal import GoogleCalendar
    from tests.conftest import make_key
    pem = make_key().private_bytes(serialization.Encoding.PEM,
                                   serialization.PrivateFormat.PKCS8,
                                   serialization.NoEncryption()).decode()
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.read().decode()))
        if req.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        if req.method == "GET":
            page2 = "pageToken" in req.url.params
            item = {"id": "p2" if page2 else "p1", "summary": "Tim Urlaub",
                    "start": {"date": "2026-11-03"}, "end": {"date": "2026-11-04"}}
            return httpx.Response(200, json={"items": [item],
                                             **({} if page2 else {"nextPageToken": "n"})})
        if req.method == "DELETE":
            return httpx.Response(410)
        return httpx.Response(200, json={"id": "new1"})

    cal = GoogleCalendar("cal@x", {"client_email": "sa@x", "private_key": pem},
                         httpx.Client(transport=httpx.MockTransport(handler)))
    assert [e.id for e in cal.list_events(date(2026, 11, 1), date(2027, 1, 1))] == ["p1", "p2"]
    assert cal.create("Tim Urlaub", date(2026, 11, 3), date(2026, 11, 5), 7) == "new1"
    body = json.loads([b for m, p, b in seen if m == "POST" and "events" in p][0])
    assert body["end"]["date"] == "2026-11-06"  # exclusive
    assert body["extendedProperties"]["private"]["base_id"] == "7"
    cal.delete("gone")  # 410 is fine
    assert sum(1 for m, p, _ in seen if p == "/token") == 1  # token cached


def test_imported_vacation_survives_when_title_becomes_ambiguous(db, cal):
    mk_user(db, "Tim", "a@example.com")
    cal.add_manual("Tim Urlaub", D1, D2)
    sync(db, cal, TODAY, NOW)
    assert len(vacs(db)) == 1
    mk_user(db, "Tim B", "b@example.com")  # now ambiguous, event still exists
    sync(db, cal, TODAY, NOW)
    assert len(vacs(db)) == 1
    assert db.get(SyncState, 1).unmatched == ["Tim Urlaub"]


def test_reused_row_id_does_not_adopt_foreign_event(db, cal):
    nico, can = mk_user(db, "Nico"), mk_user(db, "Can")
    v = mk_vac(db, nico)
    sync(db, cal, TODAY, NOW)
    vid = v.id
    db.delete(v)
    db.commit()
    db.add(Vacation(id=vid, user_id=can.id, start_date=D1, end_date=D2,
                    source=VacationSource.base))
    db.commit()
    sync(db, cal, TODAY, NOW)
    assert [e.title for e in cal.events.values()] == ["Can Urlaub"]


def test_hand_edited_title_is_restored(db, cal):
    mk_vac(db, mk_user(db, "Tim"))
    sync(db, cal, TODAY, NOW)
    eid = next(iter(cal.events))
    cal.events[eid].title = "Tim im Urlaub"
    sync(db, cal, TODAY, NOW)
    assert [e.title for e in cal.events.values()] == ["Tim Urlaub"]
