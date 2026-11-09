import pytest

from app.cli import EXAMPLE_PRESETS, seed_presets
from app.models import Role

ROUNDS = {"rounds": 5, "work": 300, "rest": 30, "prep": 10}


@pytest.fixture
def admin(add_user, as_user):
    add_user("boss@example.com", Role.gesellschafter)
    return as_user("boss@example.com")


@pytest.fixture
def trainer(add_user, as_user):
    add_user("t@example.com", Role.trainer)
    return as_user("t@example.com")


def body(**kw):
    return {"name": "Rolling", "mode": "rounds", "config": ROUNDS, **kw}


def test_trainer_reads_but_cannot_write(client, admin, trainer):
    pid = client.post("/api/timer-presets", json=body(), headers=admin).json()["id"]
    assert len(client.get("/api/timer-presets", headers=trainer).json()) == 1
    assert client.post("/api/timer-presets", json=body(), headers=trainer).status_code == 403
    assert client.patch(f"/api/timer-presets/{pid}", json={"name": "x"}, headers=trainer).status_code == 403
    assert client.delete(f"/api/timer-presets/{pid}", headers=trainer).status_code == 403
    assert len(client.get("/api/timer-presets", headers=admin).json()) == 1


def test_admin_crud(client, admin):
    pid = client.post("/api/timer-presets", json=body(), headers=admin).json()["id"]
    r = client.patch(f"/api/timer-presets/{pid}", json={"name": "Neu"}, headers=admin)
    assert r.json()["name"] == "Neu"
    assert client.delete(f"/api/timer-presets/{pid}", headers=admin).status_code == 204
    assert client.get("/api/timer-presets", headers=admin).json() == []
    assert client.delete(f"/api/timer-presets/{pid}", headers=admin).status_code == 404


@pytest.mark.parametrize("cfg", [
    {**ROUNDS, "rounds": 0}, {**ROUNDS, "rounds": 100}, {**ROUNDS, "work": 6000},
    {**ROUNDS, "rest": -1}, {**ROUNDS, "extra": 1}, {"duration": 5},
])
def test_rounds_config_validated(client, admin, cfg):
    assert client.post("/api/timer-presets", json=body(config=cfg), headers=admin).status_code == 422


def test_limits_accepted_and_pause_zero(client, admin):
    cfg = {"rounds": 99, "work": 5999, "rest": 0, "prep": 0}
    assert client.post("/api/timer-presets", json=body(config=cfg), headers=admin).status_code == 201


def test_patch_mode_config_mismatch(client, admin):
    pid = client.post("/api/timer-presets", json=body(), headers=admin).json()["id"]
    assert client.patch(f"/api/timer-presets/{pid}", json={"mode": "countdown"},
                        headers=admin).status_code == 422
    assert client.get("/api/timer-presets", headers=admin).json()[0]["mode"] == "rounds"
    ok = client.patch(f"/api/timer-presets/{pid}",
                      json={"mode": "countdown", "config": {"duration": 300}}, headers=admin)
    assert ok.status_code == 200


def test_seed_presets_idempotent(app, client, admin):
    with app.state.session_factory() as db:
        seed_presets(db)
        seed_presets(db)
    names = [p["name"] for p in client.get("/api/timer-presets", headers=admin).json()]
    assert len(names) == len(EXAMPLE_PRESETS) and all("(Beispiel)" in n for n in names)
