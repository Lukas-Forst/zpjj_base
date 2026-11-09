import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    env: str = "prod"
    database_url: str = "sqlite:///./hub.db"
    cf_access_team_domain: str = ""
    cf_access_aud: str = ""
    bootstrap_admin_emails: tuple[str, ...] = ()
    auth_dev_email: str = ""
    hub_proxy_secret: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        return cls(
            env=e("ENV", "prod"),
            database_url=e("DATABASE_URL", "sqlite:///./hub.db"),
            cf_access_team_domain=e("CF_ACCESS_TEAM_DOMAIN", ""),
            cf_access_aud=e("CF_ACCESS_AUD", ""),
            bootstrap_admin_emails=tuple(
                x.strip().lower() for x in e("BOOTSTRAP_ADMIN_EMAILS", "").split(",") if x.strip()
            ),
            auth_dev_email=e("AUTH_DEV_EMAIL", "").strip().lower(),
            hub_proxy_secret=e("HUB_PROXY_SECRET", ""),
        )

    def validate(self) -> None:
        if self.auth_dev_email and self.env != "dev":
            raise RuntimeError("AUTH_DEV_EMAIL is set but ENV is not 'dev': refusing to start")
        if self.env != "dev" and not (self.cf_access_team_domain and self.cf_access_aud):
            raise RuntimeError("CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required outside dev")
