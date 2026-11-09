import json
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    env: str = "prod"
    database_url: str = "sqlite:///./base.db"
    cf_access_team_domain: str = ""
    cf_access_aud: str = ""
    bootstrap_admin_emails: tuple[str, ...] = ()
    auth_dev_email: str = ""
    base_proxy_secret: str = ""
    trello_key: str = ""
    trello_token: str = ""
    trello_board: str = ""
    gcal_calendar_id: str = ""
    gcal_service_account_json: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        return cls(
            env=e("ENV", "prod"),
            database_url=e("DATABASE_URL", "sqlite:///./base.db"),
            cf_access_team_domain=e("CF_ACCESS_TEAM_DOMAIN", ""),
            cf_access_aud=e("CF_ACCESS_AUD", ""),
            bootstrap_admin_emails=tuple(
                x.strip().lower() for x in e("BOOTSTRAP_ADMIN_EMAILS", "").split(",") if x.strip()
            ),
            auth_dev_email=e("AUTH_DEV_EMAIL", "").strip().lower(),
            base_proxy_secret=e("BASE_PROXY_SECRET", ""),
            trello_key=e("TRELLO_KEY", ""),
            trello_token=e("TRELLO_TOKEN", ""),
            trello_board=e("TRELLO_BOARD", ""),
            gcal_calendar_id=e("GCAL_CALENDAR_ID", ""),
            gcal_service_account_json=e("GCAL_SERVICE_ACCOUNT_JSON", ""),
        )

    def validate(self) -> None:
        if self.gcal_service_account_json:
            try:
                json.loads(self.gcal_service_account_json)
            except ValueError:
                raise RuntimeError("GCAL_SERVICE_ACCOUNT_JSON is not valid JSON") from None
        if self.auth_dev_email and self.env != "dev":
            raise RuntimeError("AUTH_DEV_EMAIL is set but ENV is not 'dev': refusing to start")
        if self.env != "dev" and not (self.cf_access_team_domain and self.cf_access_aud):
            raise RuntimeError("CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required outside dev")
