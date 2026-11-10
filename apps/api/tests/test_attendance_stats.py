from datetime import date, time, timedelta

import pytest

from app.dates import today_berlin
from app.models import Attendance, Slot, SlotKind
from app.routers.attendance import months_ago


def mk(app, d, **kw):
    with app.state.session_factory() as db:
        db.add(Attendance(date=d, **kw))
        db.commit()


@pytest.fixture
def h(app, add_user, as_user):
    add_user("t@example.com")
    with app.state.session_factory() as db:
        for wd in range(2, 8):
            db.add(Slot(weekday=wd, start_time=time(18), end_time=time(20), kind=SlotKind.gi))
        db.commit()
    return as_user("t@example.com")


def monday(d):
    return d - timedelta(days=d.isoweekday() - 1)


def test_months_ago_clamps():
    assert months_ago(date(2026, 5, 31), 3) == date(2026, 2, 28)
    assert months_ago(date(2026, 3, 15), 2) == date(2026, 1, 15)
    assert months_ago(date(2026, 1, 31), 2) == date(2025, 11, 30)


def test_weeks_shape_and_gap(client, app, h):
    mk(app, monday(today_berlin()) - timedelta(days=7 * 3 - 1), total=10)  # Sunday, 3 weeks back
    j = client.get("/api/attendance/stats", headers=h).json()
    assert j["months"] == 3
    w = j["weeks"]
    assert len(w) == 12
    assert [x["week_start"] for x in w] == sorted(x["week_start"] for x in w)
    assert w[-1]["week_start"] == monday(today_berlin()).isoformat()
    assert w[-1] == {"week_start": w[-1]["week_start"], "avg": None, "days": 0}
    assert w[-4]["avg"] == 10.0 and w[-4]["days"] == 1
    assert len(j["weekday_avg"]) == 7
    assert [x["weekday"] for x in j["weekday_avg"]] == list(range(1, 8))


def test_weeks_exclude_openmat_cancelled_and_null_total(client, app, h):
    m = monday(today_berlin()) - timedelta(days=14)
    mk(app, m + timedelta(days=1), total=10)
    mk(app, m + timedelta(days=2), total=5)
    mk(app, m + timedelta(days=3), cancelled=True)
    mk(app, m + timedelta(days=6), total=None, open_mat=9)
    mk(app, m + timedelta(days=4), total=None)
    j = client.get("/api/attendance/stats", headers=h).json()
    assert j["weeks"][-3]["avg"] == 7.5
    assert j["weeks"][-3]["days"] == 2
    assert j["weekday_avg"][6]["avg"] is None


def test_weekday_window_2_vs_3_months(client, app, h):
    d = today_berlin() - timedelta(days=80)
    mk(app, d, total=12)
    wd = d.isoweekday() - 1
    assert client.get("/api/attendance/stats?months=2", headers=h).json()["weekday_avg"][wd]["avg"] is None
    j = client.get("/api/attendance/stats?months=3", headers=h).json()
    assert j["weekday_avg"][wd]["avg"] == 12.0


def test_months_validation(client, h):
    assert client.get("/api/attendance/stats?months=4", headers=h).status_code == 422


def test_stats_requires_login(client):
    assert client.get("/api/attendance/stats").status_code == 401
