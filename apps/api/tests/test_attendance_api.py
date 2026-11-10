from datetime import time, timedelta

import pytest
from sqlalchemy import select

from app.dates import today_berlin
from app.models import Attendance, Slot, SlotKind, Trial, TrialAttendance


def last(isoday, back=0):
    d = today_berlin() - timedelta(days=1)
    while d.isoweekday() != isoday:
        d -= timedelta(days=1)
    return d - timedelta(days=7 * back)


@pytest.fixture
def h(app, add_user, as_user):
    add_user("t@example.com")
    with app.state.session_factory() as db:
        for wd in (3, 5, 7):
            db.add(Slot(weekday=wd, start_time=time(18), end_time=time(20), kind=SlotKind.gi))
        db.commit()
    return as_user("t@example.com")


def put(client, h, d, **body):
    return client.put(f"/api/attendance/{d.isoformat()}", headers=h, json=body)


def rows(app, model):
    with app.state.session_factory() as db:
        return db.scalars(select(model)).all()


def test_put_weekday_saves_counts_and_trial(client, app, h):
    d = last(3)
    r = put(client, h, d, text="10 1 (David)")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["members"] == 9 and j["names"] == ["David"] and j["total"] == 10
    t = rows(app, Trial)
    assert [(x.name, x.first_date) for x in t] == [("David", d)]


def test_put_sunday_line(client, h):
    d = last(7)
    j = put(client, h, d, text="0 0 4 (15)").json()
    assert (j["total"], j["open_mat"], j["beginner"]) == (0, 4, 15)
    assert put(client, h, d, text="5 0 4").json()["beginner"] is None


def test_replace_removes_orphan_trial(client, app, h):
    d = last(3)
    put(client, h, d, text="10 1 (Davd)")
    put(client, h, d, text="10 1 (David)")
    assert [x.name for x in rows(app, Trial)] == ["David"]


def test_same_name_other_day_is_same_person(client, app, h):
    d1, d2 = last(3, 1), last(3)
    put(client, h, d2, text="10 1 (David)")
    put(client, h, d1, text="8 1 (david)")
    t = rows(app, Trial)
    assert len(t) == 1 and t[0].first_date == d1
    assert len(rows(app, TrialAttendance)) == 2
    put(client, h, d1, text="8")  # removing the earlier visit moves first_date forward
    assert rows(app, Trial)[0].first_date == d2


def test_cancelled_day(client, app, h):
    d = last(3)
    put(client, h, d, text="10 1 (David)")
    j = put(client, h, d, cancelled=True).json()
    assert j["cancelled"] is True and j["total"] is None and j["members"] is None
    assert rows(app, TrialAttendance) == [] and rows(app, Trial) == []


def test_rejects_future_and_closed_day(client, h):
    r = put(client, h, today_berlin() + timedelta(days=1), text="1")
    assert r.status_code == 422 and r.json()["detail"] == "Für die Zukunft kann nichts eingetragen werden."
    r = put(client, h, last(1), text="1")
    assert r.status_code == 422 and r.json()["detail"] == "An diesem Tag ist kein Training."


def test_rejects_bad_line_with_german_message(client, h):
    r = put(client, h, last(3), text="0 0 4 (15)")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_rejects_absurd_count(client, h):
    r = put(client, h, last(3), text="5000")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_parse_endpoint_does_not_write(client, app, h):
    r = client.post("/api/attendance/parse", headers=h,
                    json={"date": last(3).isoformat(), "text": "10 2 (David)"})
    j = r.json()
    assert r.status_code == 200 and j["members"] == 8 and j["warnings"]
    assert rows(app, Attendance) == []
    bad = client.post("/api/attendance/parse", headers=h,
                      json={"date": last(3).isoformat(), "text": "x"})
    assert bad.status_code == 422 and isinstance(bad.json()["detail"], str)


def test_unauthenticated_is_401(client):
    d = last(3).isoformat()
    assert client.put(f"/api/attendance/{d}", json={"text": "1"}).status_code == 401
    assert client.post("/api/attendance/parse", json={"date": d, "text": "1"}).status_code == 401


def test_cancel_sunday(client, h):
    assert put(client, h, last(7), cancelled=True).json()["cancelled"] is True
