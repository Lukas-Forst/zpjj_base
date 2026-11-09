import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.auth import JWKSCache
from app.config import Settings
from app.main import create_app
from app.models import Role, User

TEAM, AUD = "team.cloudflareaccess.com", "aud-tag"


def make_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def key():
    return make_key()


def mint(key, email="a@example.com", kid="k1", aud=AUD, iss=f"https://{TEAM}", exp_in=300):
    return jwt.encode(
        {"email": email, "aud": [aud], "iss": iss, "exp": int(time.time()) + exp_in},
        key, algorithm="RS256", headers={"kid": kid},
    )


@pytest.fixture
def app(key):
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = "k1"
    settings = Settings(env="prod", database_url="sqlite://", cf_access_team_domain=TEAM,
                        cf_access_aud=AUD)
    app = create_app(settings, JWKSCache("x", fetch=lambda _: {"keys": [jwk]}))
    from app.db import Base
    Base.metadata.create_all(app.state.session_factory.kw["bind"])
    return app


@pytest.fixture
def add_user(app):
    def _add(email, role=Role.trainer, is_trainer=True, active=True, name=None):
        with app.state.session_factory() as db:
            u = User(email=email, display_name=name or email.split("@")[0], role=role,
                     is_trainer=is_trainer, active=active)
            db.add(u)
            db.commit()
            return u.id
    return _add


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def as_user(client, key):
    def _h(email):
        return {"Cf-Access-Jwt-Assertion": mint(key, email)}
    return _h
