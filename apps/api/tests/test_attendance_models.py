from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Attendance, Trial, TrialAttendance

D = date(2026, 11, 10)


def test_trials_cannot_exceed_total(app):
    with app.state.session_factory() as db, pytest.raises(IntegrityError):
        db.add(Attendance(date=D, total=3, trials=4))
        db.commit()


def test_name_key_unique(app):
    with app.state.session_factory() as db, pytest.raises(IntegrityError):
        db.add_all([Trial(name="Max", name_key="max", first_date=D),
                    Trial(name="MAX", name_key="max", first_date=D)])
        db.commit()


def test_deleting_day_requires_links_gone(app):
    with app.state.session_factory() as db:
        db.execute(text("PRAGMA foreign_keys=ON"))
        db.add_all([Attendance(date=D, total=3, trials=1),
                    Trial(id=1, name="Max", name_key="max", first_date=D)])
        db.flush()
        db.add(TrialAttendance(trial_id=1, date=D))
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM attendance"))
