from pathlib import Path

import pytest
from sqlalchemy import select

from app.cli import seed_schedule
from app.models import Role, Slot, User


@pytest.fixture
def admin(add_user, as_user):
    add_user("boss@example.com", Role.gesellschafter)
    return as_user("boss@example.com")


@pytest.fixture
def trainer(add_user, as_user):
    add_user("t@example.com", Role.trainer)
    return as_user("t@example.com")


SLOT = {"weekday": 2, "start_time": "18:00:00", "end_time": "19:00:00", "kind": "gi"}


def test_trainer_cannot_write(client, trainer):
    assert client.get("/api/slots", headers=trainer).status_code == 200
    assert client.post("/api/slots", json=SLOT, headers=trainer).status_code == 403
    assert client.patch("/api/slots/1", json={"active": False}, headers=trainer).status_code == 403
    assert client.put("/api/slots/1/trainers", json={"user_ids": []}, headers=trainer).status_code == 403
    assert client.get("/api/users", headers=trainer).status_code == 403
    assert client.post("/api/users", json={"email": "x@e.com", "display_name": "X"},
                       headers=trainer).status_code == 403
    assert client.patch("/api/users/1", json={"active": False}, headers=trainer).status_code == 403


def test_slot_crud_and_sorting(client, admin):
    for wd, st in [(5, "19:00:00"), (2, "18:00:00"), (5, "08:00:00")]:
        body = {**SLOT, "weekday": wd, "start_time": st, "end_time": "23:00:00"}
        assert client.post("/api/slots", json=body, headers=admin).status_code == 201
    order = [(s["weekday"], s["start_time"]) for s in client.get("/api/slots", headers=admin).json()]
    assert order == [(2, "18:00:00"), (5, "08:00:00"), (5, "19:00:00")]
    assert client.post("/api/slots", json={**SLOT, "weekday": 5, "start_time": "08:00:00",
                                           "end_time": "09:00:00"}, headers=admin).status_code == 409


def test_slot_validation(client, admin):
    assert client.post("/api/slots", json={**SLOT, "weekday": 8}, headers=admin).status_code == 422
    assert client.post("/api/slots", json={**SLOT, "end_time": "17:00:00"}, headers=admin).status_code == 422


def test_deactivate_hides_slot_from_trainer(client, admin, trainer):
    sid = client.post("/api/slots", json=SLOT, headers=admin).json()["id"]
    assert client.patch(f"/api/slots/{sid}", json={"active": False}, headers=admin).status_code == 200
    assert client.get("/api/slots", headers=trainer).json() == []
    assert len(client.get("/api/slots?include_inactive=true", headers=trainer).json()) == 0
    assert len(client.get("/api/slots?include_inactive=true", headers=admin).json()) == 1


def test_set_trainers(client, admin, add_user):
    sid = client.post("/api/slots", json=SLOT, headers=admin).json()["id"]
    t = add_user("tr@example.com", Role.trainer)
    r = client.put(f"/api/slots/{sid}/trainers", json={"user_ids": [t]}, headers=admin)
    assert [x["id"] for x in r.json()["trainers"]] == [t]
    nt = add_user("nt@example.com", Role.trainer, is_trainer=False)
    assert client.put(f"/api/slots/{sid}/trainers", json={"user_ids": [nt]}, headers=admin).status_code == 422
    assert client.put(f"/api/slots/{sid}/trainers", json={"user_ids": []}, headers=admin).json()["trainers"] == []


def test_users_crud(client, admin):
    r = client.post("/api/users", json={"email": " New@Example.com ", "display_name": "N"}, headers=admin)
    assert r.status_code == 201 and r.json()["email"] == "new@example.com"
    assert client.post("/api/users", json={"email": "new@example.com", "display_name": "N"},
                       headers=admin).status_code == 409
    assert client.post("/api/users", json={"email": "bad", "display_name": "N"}, headers=admin).status_code == 422
    uid = r.json()["id"]
    assert client.patch(f"/api/users/{uid}", json={"active": False}, headers=admin).json()["active"] is False


def test_last_gesellschafter_protected(client, admin, add_user):
    me = client.get("/api/me", headers=admin).json()["id"]
    assert client.patch(f"/api/users/{me}", json={"active": False}, headers=admin).status_code == 409
    assert client.patch(f"/api/users/{me}", json={"role": "trainer"}, headers=admin).status_code == 409
    other = add_user("o@example.com", Role.gesellschafter)
    assert client.patch(f"/api/users/{me}", json={"role": "trainer"}, headers=admin).status_code == 200
    # caller is now a trainer: the guard fires before the last-admin rule
    assert client.patch(f"/api/users/{other}", json={"active": False}, headers=admin).status_code == 403


def test_bootstrap_admins(app):
    from app.main import bootstrap_admins
    bootstrap_admins(app.state.session_factory, ["a@example.com"])
    bootstrap_admins(app.state.session_factory, ["a@example.com"])
    with app.state.session_factory() as db:
        us = db.scalars(select(User)).all()
    assert len(us) == 1 and us[0].role == Role.gesellschafter


YAML = """users:
""" + "".join(
    f"  - {{display_name: {n}, email: {n.lower()}@example.com, role: trainer, is_trainer: true}}\n"
    for n in ["Nico", "Can", "Tim", "Chris", "Lukas"]
)


def test_seed_idempotent_and_correct(app, tmp_path: Path):
    f = tmp_path / "u.yaml"
    f.write_text(YAML)
    with app.state.session_factory() as db:
        seed_schedule(db, f)
        seed_schedule(db, f)
        slots = db.scalars(select(Slot).order_by(Slot.weekday, Slot.start_time)).all()
        assert len(slots) == 10
        assert db.scalars(select(User)).all().__len__() == 5
        fr_gi = next(s for s in slots if s.weekday == 5 and s.kind == "gi")
        assert [t.display_name for t in fr_gi.trainers] == ["Can", "Tim"]
        assert next(s for s in slots if s.kind == "open_mat").trainers == []


def test_seed_aborts_cleanly(app, tmp_path: Path):
    with app.state.session_factory() as db:
        with pytest.raises(SystemExit, match="Missing"):
            seed_schedule(db, tmp_path / "nope.yaml")
        f = tmp_path / "u.yaml"
        f.write_text("users:\n  - {display_name: Nico, email: n@example.com, role: trainer}\n")
        with pytest.raises(SystemExit, match="Can"):
            seed_schedule(db, f)
        assert db.scalars(select(Slot)).all() == []


def test_alembic_upgrade_head(tmp_path, monkeypatch):
    from alembic.config import Config

    from alembic import command
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    cfg = Config(str(Path(__file__).parent.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).parent.parent / "alembic"))
    command.upgrade(cfg, "head")
