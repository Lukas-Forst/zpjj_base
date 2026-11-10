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


def test_guests_default_zero_and_bounded(app):
    with app.state.session_factory() as db:
        db.add(Attendance(date=D, total=3, trials=1))
        db.commit()
        assert db.get(Attendance, D).guests == 0
    with app.state.session_factory() as db, pytest.raises(IntegrityError):
        db.add(Attendance(date=date(2026, 11, 11), total=3, trials=1, guests=3))
        db.commit()


def test_trial_status_default_offen(app):
    with app.state.session_factory() as db:
        db.add(Trial(name="Max", name_key="max", first_date=D))
        db.commit()
        t = db.query(Trial).one()
        assert t.status == "offen" and t.member_since is None


def test_invalid_status_rejected(app):
    with app.state.session_factory() as db, pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO trials (name, name_key, first_date, status)"
                        " VALUES ('a', 'a', '2026-11-10', 'x')"))
        db.commit()
