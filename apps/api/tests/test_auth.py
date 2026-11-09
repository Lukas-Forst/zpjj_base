import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import AUD, TEAM, make_key, mint


def get(client, tok):
    return client.get("/api/me", headers={"Cf-Access-Jwt-Assertion": tok} if tok else {})


def test_valid(client, key, add_user):
    add_user("a@example.com")
    r = get(client, mint(key))
    assert r.status_code == 200 and r.json()["display_name"] == "a"


@pytest.mark.parametrize("kw", [{"exp_in": -10}, {"aud": "other"}, {"kid": "nope"},
                                {"iss": "https://evil.example"}])
def test_invalid_claims(client, key, add_user, kw):
    add_user("a@example.com")
    assert get(client, mint(key, **kw)).status_code == 401


def test_wrong_signature(client, add_user):
    add_user("a@example.com")
    assert get(client, mint(make_key())).status_code == 401


def test_missing_and_garbage(client):
    assert get(client, None).status_code == 401
    assert get(client, "garbage").status_code == 401


def test_unknown_email_403_german(client, key):
    r = get(client, mint(key, "who@example.com"))
    assert r.status_code == 403 and "nicht freigeschaltet" in r.json()["detail"]


def test_inactive_403(client, key, add_user):
    add_user("a@example.com", active=False)
    assert get(client, mint(key)).status_code == 403


def test_email_case_insensitive(client, key, add_user):
    add_user("a@example.com")
    assert get(client, mint(key, "A@Example.com")).status_code == 200


def test_every_route_protected(app, client):
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api"):
            continue
        for m in route.methods - {"HEAD", "OPTIONS"}:
            r = client.request(m, path.replace("{slot_id}", "1").replace("{user_id}", "1"))
            assert r.status_code in (401, 403), (m, path)


def test_healthz_open(client):
    assert client.get("/healthz").status_code == 200


def test_startup_aborts_dev_email_in_prod():
    with pytest.raises(RuntimeError):
        create_app(Settings(env="prod", database_url="sqlite://", cf_access_team_domain=TEAM,
                            cf_access_aud=AUD, auth_dev_email="x@example.com"))


def test_dev_bypass_works_in_dev(add_user):
    app = create_app(Settings(env="dev", database_url="sqlite://", auth_dev_email="d@example.com"))
    from app.db import Base
    from app.models import Role, User
    Base.metadata.create_all(app.state.session_factory.kw["bind"])
    with app.state.session_factory() as db:
        db.add(User(email="d@example.com", display_name="D", role=Role.trainer, is_trainer=True))
        db.commit()
    assert TestClient(app).get("/api/me").status_code == 200


def test_proxy_secret(key, add_user):
    app = create_app(Settings(env="dev", database_url="sqlite://", hub_proxy_secret="s3"))
    c = TestClient(app)
    assert c.get("/api/me").status_code == 403
    assert c.get("/api/me", headers={"X-Hub-Proxy-Secret": "s3"}).status_code == 401
    assert c.get("/healthz").status_code == 200


def test_hsts_header(client):
    assert "max-age" in client.get("/healthz").headers["strict-transport-security"]
