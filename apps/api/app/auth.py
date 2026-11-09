import logging
import threading
import time
from collections.abc import Callable

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWK
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Role, User

log = logging.getLogger("hub.auth")

JWKS_TTL = 3600
JWKS_MIN_REFRESH = 30  # seconds between refreshes triggered by unknown kids
FORBIDDEN_MSG = "Dein Zugang ist noch nicht freigeschaltet. Bitte melde dich bei den Gesellschaftern."


class JWKSCache:
    def __init__(self, url: str, fetch: Callable[[str], dict] | None = None, clock=time.monotonic):
        self.url, self._clock = url, clock
        self._fetch = fetch or (lambda u: httpx.get(u, timeout=5).raise_for_status().json())
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._lock = threading.Lock()

    def _refresh(self) -> None:
        data = self._fetch(self.url)
        self._keys = {k["kid"]: PyJWK(k) for k in data.get("keys", []) if "kid" in k}
        self._fetched_at = self._clock()

    def key_for(self, kid: str):
        with self._lock:
            now = self._clock()
            age = None if self._fetched_at is None else now - self._fetched_at
            if age is None or age > JWKS_TTL or (kid not in self._keys and age > JWKS_MIN_REFRESH):
                try:
                    self._refresh()
                except Exception:
                    log.warning("JWKS refresh failed")
            k = self._keys.get(kid)
            return k.key if k else None


def verify_token(token: str, jwks: JWKSCache, team_domain: str, aud: str) -> dict:
    kid = jwt.get_unverified_header(token).get("kid")
    key = jwks.key_for(kid) if kid else None
    if key is None:
        raise jwt.InvalidTokenError("unknown kid")
    return jwt.decode(
        token, key, algorithms=["RS256"], audience=aud, issuer=f"https://{team_domain}",
        options={"require": ["exp", "iss", "aud"]},
    )


def get_db(request: Request):
    with request.app.state.session_factory() as s:
        yield s


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    st = request.app.state.settings
    if st.auth_dev_email and st.env == "dev":
        email = st.auth_dev_email
    else:
        token = request.headers.get("Cf-Access-Jwt-Assertion")
        if not token:
            raise HTTPException(401, "Nicht angemeldet.")
        try:
            claims = verify_token(token, request.app.state.jwks, st.cf_access_team_domain,
                                  st.cf_access_aud)
        except jwt.PyJWTError:
            raise HTTPException(401, "Nicht angemeldet.") from None
        email = str(claims.get("email", "")).strip().lower()
    user = db.scalar(select(User).where(User.email == email)) if email else None
    if user is None or not user.active:
        raise HTTPException(403, FORBIDDEN_MSG)
    return user


def require_gesellschafter(user: User = Depends(current_user)) -> User:
    if user.role != Role.gesellschafter:
        raise HTTPException(403, "Nur für Gesellschafter.")
    return user
