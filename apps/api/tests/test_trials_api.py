from datetime import timedelta

import pytest

from app.dates import today_berlin
from app.models import Attendance, Trial, TrialAttendance, TrialStatus


@pytest.fixture
def h(app, add_user, as_user):
    add_user("t@example.com")
    return as_user("t@example.com")


def person(app, name, days_ago, status=TrialStatus.offen):
    today = today_berlin()
    ds = [today - timedelta(days=n) for n in days_ago]
    with app.state.session_factory() as db:
        t = Trial(name=name, name_key=name.casefold(), first_date=min(ds), status=status)
        db.add(t)
        db.flush()
        for d in ds:
            if db.get(Attendance, d) is None:
                db.add(Attendance(date=d, total=10))
            db.flush()
            if db.get(TrialAttendance, (t.id, d)) is None:
                db.add(TrialAttendance(trial_id=t.id, date=d))
        db.commit()
        return t.id


def test_list_flags_due_and_recent(client, app, h):
    person(app, "B", [42, 45])
    person(app, "C", [1, 3, 5], TrialStatus.mitglied)
    person(app, "A", [1, 9])
    person(app, "D", [2])
    rows = client.get("/api/trials", headers=h).json()
    by = {r["name"]: r for r in rows}
    assert by["A"]["due"] and by["A"]["recent"] and by["A"]["visits"] == 2
    assert not by["B"]["recent"] and by["B"]["due"]
    assert by["C"]["visits"] == 3 and not by["C"]["due"]
    assert by["D"]["visits"] == 1 and not by["D"]["due"]
    assert [r["name"] for r in rows] == ["A", "B", "C", "D"]  # due first, then last_visit desc


def test_patch_member_sets_member_since_and_clears_on_revert(client, app, h):
    tid = person(app, "A", [1, 9])
    r = client.patch(f"/api/trials/{tid}", headers=h, json={"status": "mitglied"})
    assert r.status_code == 200
    assert r.json()["status"] == "mitglied"
    assert r.json()["member_since"] == today_berlin().isoformat()
    r = client.patch(f"/api/trials/{tid}", headers=h,
                     json={"status": "mitglied", "member_since": "2026-01-05"})
    assert r.json()["member_since"] == "2026-01-05"
    r = client.patch(f"/api/trials/{tid}", headers=h, json={"status": "offen"})
    assert r.json()["status"] == "offen" and r.json()["member_since"] is None


def test_patch_unknown_and_invalid(client, app, h):
    r = client.patch("/api/trials/999", headers=h, json={"status": "offen"})
    assert r.status_code == 404 and r.json()["detail"] == "Person nicht gefunden."
    tid = person(app, "A", [1])
    assert client.patch(f"/api/trials/{tid}", headers=h, json={"status": "x"}).status_code == 422


def test_trials_require_login(client):
    assert client.get("/api/trials").status_code == 401
    assert client.patch("/api/trials/1", json={"status": "offen"}).status_code == 401
