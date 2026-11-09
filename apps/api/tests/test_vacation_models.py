from datetime import date
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models import Vacation, VacationSource


def test_vacation_end_before_start_rejected(app, add_user):
    uid = add_user("t@example.com")
    with app.state.session_factory() as db:
        db.add(Vacation(user_id=uid, start_date=date(2026, 12, 5), end_date=date(2026, 12, 4),
                        source=VacationSource.base))
        with pytest.raises(IntegrityError):
            db.commit()


def test_migration_creates_new_tables(tmp_path, monkeypatch):
    from alembic.config import Config

    from alembic import command
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    cfg = Config(str(Path(__file__).parent.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).parent.parent / "alembic"))
    command.upgrade(cfg, "head")
    names = sa.inspect(sa.create_engine(f"sqlite:///{tmp_path}/t.db")).get_table_names()
    assert {"vacations", "substitutes", "sync_state"} <= set(names)
