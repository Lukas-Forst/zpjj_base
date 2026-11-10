from datetime import time, timedelta

import pytest
from sqlalchemy import select

from app.dates import today_berlin
from app.models import Slot, SlotKind, Trial, TrialAttendance, TrialStatus


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
    r = put(client, h, d, total=10, trial_names=["David"])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["members"] == 9 and j["names"] == ["David"] and j["total"] == 10
    t = rows(app, Trial)
    assert [(x.name, x.first_date) for x in t] == [("David", d)]


def test_put_sunday(client, h):
    d = last(7)
    j = put(client, h, d, total=4, open_mat=4, beginner=15).json()
    assert (j["total"], j["open_mat"], j["beginner"]) == (4, 4, 15)
    assert put(client, h, d, total=5).json()["beginner"] is None


def test_replace_removes_orphan_trial(client, app, h):
    d = last(3)
    put(client, h, d, total=10, trial_names=["Davd"])
    put(client, h, d, total=10, trial_names=["David"])
    assert [x.name for x in rows(app, Trial)] == ["David"]


def test_same_name_other_day_is_same_person(client, app, h):
    d1, d2 = last(3, 1), last(3)
    put(client, h, d2, total=10, trial_names=["David"])
    put(client, h, d1, total=8, trial_names=["david"])
    t = rows(app, Trial)
    assert len(t) == 1 and t[0].first_date == d1
    assert len(rows(app, TrialAttendance)) == 2
    put(client, h, d1, total=8)  # removing the earlier visit moves first_date forward
    assert rows(app, Trial)[0].first_date == d2


def test_cancelled_day(client, app, h):
    d = last(3)
    put(client, h, d, total=10, trial_names=["David"])
    j = put(client, h, d, cancelled=True).json()
    assert j["cancelled"] is True and j["total"] is None and j["members"] is None
    assert rows(app, TrialAttendance) == [] and rows(app, Trial) == []


def test_rejects_future_and_closed_day(client, h):
    r = put(client, h, today_berlin() + timedelta(days=1), total=1)
    assert r.status_code == 422 and r.json()["detail"] == "Für die Zukunft kann nichts eingetragen werden."
    r = put(client, h, last(1), total=1)
    assert r.status_code == 422 and r.json()["detail"] == "An diesem Tag ist kein Training."


def test_rheinheim_slot_does_not_open_a_day(client, app, h):
    with app.state.session_factory() as db:  # Monday only has a Rheinheim class
        db.add(Slot(weekday=1, start_time=time(19, 30), end_time=time(21, 30),
                    kind=SlotKind.no_gi, location="Rheinheim"))
        db.commit()
    r = put(client, h, last(1), total=1)
    assert r.status_code == 422 and r.json()["detail"] == "An diesem Tag ist kein Training."


def test_rejects_absurd_count(client, h):
    assert put(client, h, last(3), total=5000).status_code == 422
    assert put(client, h, last(7), total=5, open_mat=5000).status_code == 422
    assert put(client, h, last(3)).status_code == 422  # total required


def test_empty_or_duplicate_name_rejected(client, h):
    for names in (["  "], ["David", "david"]):
        r = put(client, h, last(3), total=10, trial_names=names)
        assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_names_exceeding_total_rejected(client, h):
    r = put(client, h, last(3), total=1, trial_names=["A1", "B2"])
    assert r.status_code == 422
    assert put(client, h, last(3), total=2, trial_names=["A1"], guests=2).status_code == 422


def test_guests_reduce_members(client, h):
    j = put(client, h, last(3), total=10, trial_names=["David"], guests=2).json()
    assert j["members"] == 7 and j["guests"] == 2 and j["trials"] == 1


def test_member_flagged_name_rejected(client, app, h):
    _imported(app, "Anna", last(3, 3))
    with app.state.session_factory() as db:
        db.scalar(select(Trial)).status = TrialStatus.mitglied
        db.commit()
    r = put(client, h, last(3), total=10, trial_names=["anna"])
    assert r.status_code == 422 and "anna" in r.json()["detail"].lower()


def test_open_mat_only_sunday(client, h):
    r = put(client, h, last(3), total=5, open_mat=2)
    assert r.status_code == 422 and "sonntags" in r.json()["detail"]


def test_parse_endpoint_gone(client, h):
    r = client.post("/api/attendance/parse", headers=h, json={})
    assert r.status_code in (404, 405)


def test_unauthenticated_is_401(client):
    d = last(3).isoformat()
    assert client.put(f"/api/attendance/{d}", json={"total": 1}).status_code == 401


def test_cancel_sunday(client, h):
    assert put(client, h, last(7), cancelled=True).json()["cancelled"] is True


def _imported(app, name, first):
    with app.state.session_factory() as db:
        db.add(Trial(name=name, name_key=name.casefold(), first_date=first))
        db.commit()


def test_imported_trial_keeps_earlier_first_date(client, app, h):
    d = last(3)
    _imported(app, "Anna", d - timedelta(days=60))
    put(client, h, d, total=10, trial_names=["Anna"])
    assert rows(app, Trial)[0].first_date == d - timedelta(days=60)


def test_correcting_imported_name_does_not_delete_person(client, app, h):
    d = last(3)
    _imported(app, "Anna", d - timedelta(days=60))
    put(client, h, d, total=10, trial_names=["Anna"])
    put(client, h, d, total=10, trial_names=["Anne"])
    t = {x.name: x.first_date for x in rows(app, Trial)}
    assert t == {"Anna": d - timedelta(days=60), "Anne": d}


def test_input_caps(client, h):
    d = last(3)
    ok = lambda n: put(client, h, d, total=40, trial_names=n).status_code  # noqa: E731
    assert ok([f"Ab{i}" for i in range(31)]) == 422
    assert ok(["a" * 101]) == 422
    assert ok(["a" * 100]) == 200


def _flag(client, h, app, name, since=None):
    tid = next(t.id for t in rows(app, Trial) if t.name == name)
    body = {"status": "mitglied", **({"member_since": since.isoformat()} if since else {})}
    assert client.patch(f"/api/trials/{tid}", headers=h, json=body).status_code == 200


def _statuses(client, h):
    return {t["name"]: t["status"] for t in client.get("/api/trials", headers=h).json()}


def test_resave_keeps_flagged_person_linked_to_day(client, app, h):
    d = last(3)
    assert put(client, h, d, total=5, trial_names=["Zed"]).status_code == 200
    _flag(client, h, app, "Zed")
    assert put(client, h, d, total=5, trial_names=["Zed"]).status_code == 200
    assert _statuses(client, h) == {"Zed": "mitglied"}


def test_dropping_or_cancelling_keeps_flagged_person(client, app, h):
    d = last(3)
    put(client, h, d, total=5, trial_names=["Zed"])
    _flag(client, h, app, "Zed")
    assert put(client, h, d, total=5).status_code == 200
    assert _statuses(client, h) == {"Zed": "mitglied"}
    put(client, h, d, total=5, trial_names=["Zed"])  # rejected now (no link), fine either way
    assert put(client, h, d, cancelled=True).status_code == 200
    assert _statuses(client, h) == {"Zed": "mitglied"}


def test_flagged_person_before_member_since_allowed_after_rejected(client, app, h):
    _imported(app, "Anna", last(3, 3))
    d = last(3)
    _flag(client, h, app, "Anna", since=d + timedelta(days=1))
    assert put(client, h, d, total=5, trial_names=["Anna"]).status_code == 200
    _flag(client, h, app, "Anna", since=d)
    put(client, h, d, total=5)  # unlink
    r = put(client, h, d, total=5, trial_names=["Anna"])
    assert r.status_code == 422 and "Anna" in r.json()["detail"]
