from datetime import date, time, timedelta

import pytest

from app.models import Role, Slot, SlotKind, User

T = date.today()
DAY = T + timedelta(days=3)


@pytest.fixture
def setup(app, add_user, as_user):
    add_user("boss@example.com", Role.gesellschafter, is_trainer=False)
    a, b, c = (add_user(f"{n}@example.com", name=n) for n in ("nico", "can", "tim"))
    with app.state.session_factory() as db:
        slot = Slot(weekday=DAY.isoweekday(), start_time=time(18), end_time=time(20),
                    kind=SlotKind.no_gi)
        slot.trainers = [db.get(User, a), db.get(User, b)]
        om = Slot(weekday=DAY.isoweekday(), start_time=time(20), end_time=time(21),
                  kind=SlotKind.open_mat)
        db.add_all([slot, om])
        db.commit()
        sid = slot.id
    return dict(boss=as_user("boss@example.com"), tim=as_user("tim@example.com"),
                a=a, b=b, c=c, sid=sid)


def vac(client, h, uid):
    r = client.post("/api/vacations", headers=h, json={
        "user_id": uid, "start_date": DAY.isoformat(), "end_date": DAY.isoformat()})
    assert r.status_code == 201, r.text


def plan(client, h):
    r = client.get("/api/coverage/plan", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def cards(p):
    """(week, day, slot) of the test day."""
    for w in p:
        for d in w["days"]:
            if d["date"] == DAY.isoformat():
                return w, d, {s["start_time"][:5]: s for s in d["slots"]}
    raise AssertionError("test day not in plan")


def test_three_weeks_from_this_monday_and_no_past_days(client, setup):
    p = plan(client, setup["tim"])
    assert len(p) == 3
    monday = T - timedelta(days=T.isoweekday() - 1)
    assert [w["week_start"] for w in p] == [(monday + timedelta(days=7 * i)).isoformat()
                                            for i in range(3)]
    assert all(d["date"] >= T.isoformat() for w in p for d in w["days"])
    assert p[0]["iso_week"] == T.isocalendar().week


def test_status_per_card(client, setup):
    s = setup
    w, _, slots = cards(plan(client, s["tim"]))
    card = slots["18:00"]
    assert card["status"] == "besetzt" and card["kind"] == "no_gi"
    assert card["trainers"] == ["nico", "can"] and card["absent"] == []
    assert slots["20:00"]["status"] == "nicht_geprueft"  # open mat is never a gap
    assert (w["unbesetzt"], w["teilweise"]) == (0, 0)

    vac(client, s["boss"], s["a"])
    w, _, slots = cards(plan(client, s["tim"]))
    assert slots["18:00"]["status"] == "teilweise" and slots["18:00"]["absent"] == ["nico"]
    assert (w["unbesetzt"], w["teilweise"]) == (0, 1)

    vac(client, s["boss"], s["b"])
    w, _, slots = cards(plan(client, s["tim"]))
    assert slots["18:00"]["status"] == "unbesetzt"
    assert sorted(slots["18:00"]["absent"]) == ["can", "nico"]
    assert (w["unbesetzt"], w["teilweise"]) == (1, 0)


def test_substitute_turns_card_into_vertreten(client, setup):
    s = setup
    vac(client, s["boss"], s["a"])
    vac(client, s["boss"], s["b"])
    r = client.put("/api/coverage/substitutes", headers=s["tim"],
                   json={"slot_id": s["sid"], "date": DAY.isoformat()})
    assert r.status_code == 204
    w, _, slots = cards(plan(client, s["tim"]))
    card = slots["18:00"]
    assert card["status"] == "vertreten"
    assert [(x["user_id"], x["user_name"]) for x in card["substitutes"]] == [(s["c"], "tim")]
    assert (w["unbesetzt"], w["teilweise"]) == (0, 0)  # covered cards are not counted


def test_card_and_gap_carry_the_location(client, app, setup):
    s = setup
    with app.state.session_factory() as db:
        rh = Slot(weekday=DAY.isoweekday(), start_time=time(19, 30), end_time=time(21, 30),
                  kind=SlotKind.no_gi, location="Rheinheim")
        rh.trainers = [db.get(User, s["c"])]
        db.add(rh)
        db.commit()
    vac(client, s["boss"], s["c"])
    _, _, slots = cards(plan(client, s["tim"]))
    assert slots["19:30"]["location"] == "Rheinheim" and slots["19:30"]["status"] == "unbesetzt"
    assert slots["18:00"]["location"] is None
    gaps = client.get("/api/coverage", headers=s["tim"]).json()
    assert [g["location"] for g in gaps] == ["Rheinheim"]


def test_plan_requires_login(client):
    assert client.get("/api/coverage/plan").status_code == 401
