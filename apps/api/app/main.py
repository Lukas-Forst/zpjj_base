import asyncio
import hmac
import json
import logging
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import JWKSCache
from app.calsync import sync
from app.config import Settings
from app.dates import today_berlin
from app.db import make_engine, make_session_factory
from app.gcal import GoogleCalendar
from app.models import Role, User
from app.routers import (
    attendance,
    coverage,
    me,
    presets,
    slots,
    sync_status,
    today,
    trials,
    users,
    vacations,
)

log = logging.getLogger("base")


def bootstrap_admins(session_factory, emails) -> None:
    with session_factory() as db:
        for email in emails:
            if db.scalar(select(User).where(User.email == email)):
                continue
            db.add(User(email=email, display_name=email.split("@")[0],
                        role=Role.gesellschafter, is_trainer=False))
            try:
                db.commit()
            except IntegrityError:  # another process created it first
                db.rollback()


def create_app(settings: Settings | None = None, jwks: JWKSCache | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()  # raises -> process aborts

    sync_lock = threading.Lock()

    def run_sync() -> None:
        client = app.state.calendar_client
        if client is None:
            return
        with sync_lock, app.state.session_factory() as db:
            sync(db, client, today_berlin(), datetime.now(UTC).replace(tzinfo=None))

    async def sync_loop():
        while True:
            try:
                await asyncio.to_thread(run_sync)
            except Exception:  # keep the loop alive
                log.exception("sync loop iteration failed")
            await asyncio.sleep(15 * 60)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bootstrap_admins(app.state.session_factory, settings.bootstrap_admin_emails)
        task = asyncio.create_task(sync_loop()) if app.state.calendar_client else None
        yield
        if task:
            task.cancel()

    app = FastAPI(title="ZPJJ Base API", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.calendar_client = (
        GoogleCalendar(settings.gcal_calendar_id, json.loads(settings.gcal_service_account_json))
        if settings.gcal_calendar_id and settings.gcal_service_account_json else None)
    app.state.on_vacation_change = run_sync  # errors are recorded by sync(), never raised
    app.state.session_factory = make_session_factory(make_engine(settings.database_url))
    app.state.jwks = jwks or JWKSCache(
        f"https://{settings.cf_access_team_domain}/cdn-cgi/access/certs"
    )

    @app.middleware("http")
    async def security(request: Request, call_next):
        secret = settings.base_proxy_secret
        if secret and request.url.path != "/healthz" and not hmac.compare_digest(
            request.headers.get("X-Base-Proxy-Secret", ""), secret
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

    for r in (attendance.router, me.router, slots.router, users.router, presets.router, today.router, vacations.router, coverage.router, sync_status.router, trials.router):
        app.include_router(r, prefix="/api")
    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
