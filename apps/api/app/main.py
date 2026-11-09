import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.auth import JWKSCache
from app.config import Settings
from app.db import make_engine, make_session_factory
from app.models import Role, User
from app.routers import me, presets, slots, users

log = logging.getLogger("hub")


def bootstrap_admins(session_factory, emails) -> None:
    with session_factory() as db:
        for email in emails:
            if not db.scalar(select(User).where(User.email == email)):
                db.add(User(email=email, display_name=email.split("@")[0],
                            role=Role.gesellschafter, is_trainer=False))
        db.commit()


def create_app(settings: Settings | None = None, jwks: JWKSCache | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()  # raises -> process aborts

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bootstrap_admins(app.state.session_factory, settings.bootstrap_admin_emails)
        yield

    app = FastAPI(title="ZPJJ Hub API", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.session_factory = make_session_factory(make_engine(settings.database_url))
    app.state.jwks = jwks or JWKSCache(
        f"https://{settings.cf_access_team_domain}/cdn-cgi/access/certs"
    )

    @app.middleware("http")
    async def security(request: Request, call_next):
        secret = settings.hub_proxy_secret
        if secret and request.url.path != "/healthz" and not hmac.compare_digest(
            request.headers.get("X-Hub-Proxy-Secret", ""), secret
        ):
            resp = JSONResponse({"detail": "Forbidden"}, status_code=403)
        else:
            resp = await call_next(request)
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        return resp

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    for r in (me.router, slots.router, users.router, presets.router):
        app.include_router(r, prefix="/api")
    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
