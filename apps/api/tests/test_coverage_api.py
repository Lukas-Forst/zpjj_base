from datetime import date, time, timedelta

import pytest

from app.models import Role, Slot, SlotKind, User

T = date.today()
DAY = T + timedelta(days=3)


def post_vac(client, h, uid, d=DAY):
    r = client.post("/api/vacations", headers=h, json={"user_id": uid, "start_date": d.isoformat(),
                                                       "end_date": d.isoformat()})
    assert r.status_code == 201, r.text


@pytest.fixture
def setup(app, add_user, as_user):
    add_user("boss@example.com", Role.gesellschafter, is_trainer=False)
    a, b, c = (add_user(f"{n}@example.com", name=n) for n in ("nico", "can", "tim"))
    with app.state.session_factory() as db:
        slot = Slot(weekday=DAY.isoweekday(), start_time=time(18), end_time=time(20),
                    kind=SlotKind.no_gi)
        slot.trainers = [db.get(User, a), db.get(User, b)]
        db.add(slot)
        db.commit()
        sid = slot.id
    return dict(boss=as_user("boss@example.com"), nico=as_user("nico@example.com"),
                tim=as_user("tim@example.com"), a=a, b=b, c=c, sid=sid)


def put(client, h, sid, d=DAY, **kw):
    return client.put("/api/coverage/substitutes", headers=h,
                      json={"slot_id": sid, "date": d.isoformat(), **kw})


def test_gap_after_both_on_vacation(client, setup):
    s = setup
    assert client.get("/api/coverage", headers=s["tim"]).json() == []
    post_vac(client, s["boss"], s["a"])
    post_vac(client, s["boss"], s["b"])
    g = client.get("/api/coverage", headers=s["tim"]).json()
    assert len(g) == 1 and g[0]["level"] == "unbesetzt" and g[0]["date"] == DAY.isoformat()
    assert sorted(g[0]["absent"]) == ["can", "nico"] and g[0]["kind"] == "no_gi"


def test_substitute_clears_gap_and_can_be_withdrawn(client, setup):
    s = setup
    post_vac(client, s["boss"], s["a"])
    post_vac(client, s["boss"], s["b"])
    assert put(client, s["tim"], s["sid"]).status_code == 204
    assert client.get("/api/coverage", headers=s["tim"]).json() == []
    r = client.delete(f"/api/coverage/substitutes?slot_id={s['sid']}&date={DAY}&user_id={s['c']}",
                      headers=s["tim"])
    assert r.status_code == 204
    assert len(client.get("/api/coverage", headers=s["tim"]).json()) == 1


def test_substitute_on_vacation_conflict(client, setup):
    s = setup
    post_vac(client, s["boss"], s["a"])
    post_vac(client, s["boss"], s["c"])  # Tim hat selbst Urlaub
    r = put(client, s["tim"], s["sid"])
    assert r.status_code == 409 and "Urlaub" in r.json()["detail"]


def test_wrong_weekday_422(client, setup):
    s = setup
    post_vac(client, s["boss"], s["a"])
    assert put(client, s["tim"], s["sid"], d=DAY + timedelta(days=1)).status_code == 422


def test_trainer_cannot_substitute_for_other(client, setup):
    s = setup
    post_vac(client, s["boss"], s["a"])
    assert put(client, s["tim"], s["sid"], user_id=s["b"]).status_code == 403
    assert put(client, s["boss"], s["sid"], user_id=s["c"]).status_code == 204


def test_list_substitutes(client, setup):
    s = setup
    post_vac(client, s["boss"], s["a"])
    put(client, s["tim"], s["sid"])
    r = client.get("/api/coverage/substitutes", headers=s["tim"]).json()
    assert [(x["slot_id"], x["date"], x["user_id"], x["user_name"], x["kind"]) for x in r] == [
        (s["sid"], DAY.isoformat(), s["c"], "tim", "no_gi")]
