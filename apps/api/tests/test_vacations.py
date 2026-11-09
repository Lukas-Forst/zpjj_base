from datetime import date, timedelta

import pytest

from app.models import Role

T = date.today()


def d(n):
    return (T + timedelta(days=n)).isoformat()


@pytest.fixture
def boss(add_user, as_user):
    add_user("boss@example.com", Role.gesellschafter, is_trainer=False)
    return as_user("boss@example.com")


@pytest.fixture
def tim(add_user, as_user):
    add_user("tim@example.com", name="Tim")
    return as_user("tim@example.com")


@pytest.fixture
def can(add_user, as_user):
    add_user("can@example.com", name="Can")
    return as_user("can@example.com")


def post(client, h, a, b, **kw):
    return client.post("/api/vacations", json={"start_date": a, "end_date": b, **kw}, headers=h)


def test_trainer_creates_own(client, tim):
    r = post(client, tim, d(3), d(5))
    assert r.status_code == 201
    assert r.json()["user_name"] == "Tim" and r.json()["source"] == "base"
    assert len(client.get("/api/vacations", headers=tim).json()) == 1


def test_trainer_cannot_create_for_other(client, tim, add_user):
    other = add_user("x@example.com")
    assert post(client, tim, d(3), d(4), user_id=other).status_code == 403


def test_gesellschafter_creates_for_other(client, boss, add_user):
    other = add_user("x@example.com")
    assert post(client, boss, d(3), d(4), user_id=other).status_code == 201


def test_non_trainer_target_rejected(client, boss, add_user):
    nt = add_user("nt@example.com", Role.trainer, is_trainer=False)
    assert post(client, boss, d(3), d(4), user_id=nt).status_code == 422


def test_end_before_start_422(client, tim):
    assert post(client, tim, d(5), d(3)).status_code == 422


def test_overlap_and_adjacent_merge(client, tim):
    post(client, tim, d(3), d(5))
    r = post(client, tim, d(6), d(8))  # adjacent
    post(client, tim, d(4), d(10))     # overlapping
    rows = client.get("/api/vacations", headers=tim).json()
    assert len(rows) == 1 and (rows[0]["start_date"], rows[0]["end_date"]) == (d(3), d(10))
    assert r.status_code == 201


def test_delete_rules(client, tim, can, boss):
    vid = post(client, tim, d(3), d(4)).json()["id"]
    assert client.delete(f"/api/vacations/{vid}", headers=can).status_code == 403
    assert client.delete(f"/api/vacations/{vid}", headers=tim).status_code == 204


def test_past_vacation_only_gesellschafter(client, tim, boss, add_user):
    assert post(client, tim, d(-10), d(-8)).status_code == 403  # trainer may not create past
    uid = add_user("p@example.com")
    vid = post(client, boss, d(-10), d(-8), user_id=uid).json()["id"]
    assert client.delete(f"/api/vacations/{vid}", headers=boss).status_code == 204


def test_past_delete_forbidden_for_trainer(client, boss, tim, add_user):
    me = client.get("/api/me", headers=tim).json()["id"]
    vid = post(client, boss, d(-10), d(-8), user_id=me).json()["id"]
    assert client.delete(f"/api/vacations/{vid}", headers=tim).status_code == 403


def test_requires_login(client):
    assert client.get("/api/vacations").status_code in (401, 403)


def test_calendar_entry_cannot_be_deleted_in_base(app, client, boss, add_user):
    from app.models import Vacation, VacationSource
    uid = add_user("c@example.com")
    with app.state.session_factory() as db:
        v = Vacation(user_id=uid, start_date=T + timedelta(days=3), end_date=T + timedelta(days=4),
                     source=VacationSource.calendar, gcal_event_id="g1")
        db.add(v)
        db.commit()
        vid = v.id
    r = client.delete(f"/api/vacations/{vid}", headers=boss)
    assert r.status_code == 409 and "Kalender" in r.json()["detail"]


def test_sync_hook_failure_never_fails_the_request(app, client, tim):
    def boom():
        raise RuntimeError("db locked")
    app.state.on_vacation_change = boom
    assert post(client, tim, d(3), d(4)).status_code == 201
