from datetime import time, timedelta

import pytest

from app.dates import today_berlin
from app.models import Attendance, Slot, SlotKind


def mk(app, d, **kw):
    with app.state.session_factory() as db:
        db.add(Attendance(date=d, **kw))
        db.commit()


def last(isoday, back=0):
    d = today_berlin() - timedelta(days=1)
    while d.isoweekday() != isoday:
        d -= timedelta(days=1)
    return d - timedelta(days=7 * back)


@pytest.fixture
def h(app, add_user, as_user):
    add_user("t@example.com")
    with app.state.session_factory() as db:
        for wd in range(2, 8):
            db.add(Slot(weekday=wd, start_time=time(18), end_time=time(20), kind=SlotKind.gi))
        db.commit()
    return as_user("t@example.com")


def test_overview_averages_ignore_openmat_and_cancelled(client, app, h):
    mk(app, last(3), total=10)
    mk(app, last(3, 1), total=6)
    mk(app, last(3, 2), cancelled=True)
    mk(app, last(7), total=None, open_mat=5)
    j = client.get("/api/attendance", headers=h).json()
    assert len(j["avg_by_weekday"]) == 7
    assert j["avg_by_weekday"][2] == {"weekday": 3, "avg": 8.0}
    assert j["avg_by_weekday"][6]["avg"] is None
    assert j["entries"][0]["date"] == max(e["date"] for e in j["entries"])


def test_avg_14d_window(client, app, h):
    mk(app, last(3), total=10)
    mk(app, today_berlin() - timedelta(days=20), total=100)
    j = client.get("/api/attendance", headers=h).json()
    assert j["avg_14d"] == 10.0
    assert len(j["entries"]) == 2
    assert len(client.get("/api/attendance?days=10", headers=h).json()["entries"]) == 1


def test_missing_skips_monday_and_today(client, app, h):
    mk(app, today_berlin(), total=5)
    y = today_berlin() - timedelta(days=1)
    if y.isoweekday() == 1:
        y -= timedelta(days=1)
    assert client.get("/api/attendance/missing", headers=h).json() == {"date": y.isoformat()}


def test_missing_none_when_recorded_or_cancelled(client, app, h):
    d = today_berlin()
    for i in range(1, 15):
        x = d - timedelta(days=i)
        if x.isoweekday() != 1:
            mk(app, x, cancelled=True) if i % 2 else mk(app, x, total=3)
    assert client.get("/api/attendance/missing", headers=h).json() == {"date": None}


def test_auth_required(client):
    assert client.get("/api/attendance").status_code == 401
    assert client.get("/api/attendance/missing").status_code == 401


def test_missing_has_response_model(client, h):
    props = client.app.openapi()["components"]["schemas"]["MissingOut"]["properties"]
    assert set(props) == {"date"}
