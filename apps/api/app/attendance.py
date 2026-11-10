from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Attendance, Trial, TrialAttendance, User


@dataclass(frozen=True)
class DayEntry:
    total: int
    trial_names: list[str]
    guests: int
    open_mat: int | None
    beginner: int | None


def save_day(db: Session, day: date, parsed: DayEntry | None, user: User) -> Attendance:
    """Create or replace one day; parsed=None means cancelled. Commits."""
    row = db.get(Attendance, day) or Attendance(date=day)
    old = set(db.scalars(select(TrialAttendance.trial_id).where(TrialAttendance.date == day)))
    row.updated_by = user.id
    if parsed is None:
        row.cancelled, row.total, row.trials, row.guests = True, None, 0, 0
        row.open_mat, row.beginner = None, None
    else:
        row.cancelled, row.total, row.trials = False, parsed.total, len(parsed.trial_names)
        row.guests = parsed.guests
        row.open_mat, row.beginner = parsed.open_mat, parsed.beginner
    db.add(row)
    db.flush()
    db.execute(delete(TrialAttendance).where(TrialAttendance.date == day))
    linked: set[int] = set()
    for name in {n.casefold(): n for n in (parsed.trial_names if parsed else [])}.values():
        t = db.scalar(select(Trial).where(Trial.name_key == name.casefold()))
        if not t:
            t = Trial(name=name, name_key=name.casefold(), first_date=day)
            db.add(t)
            db.flush()
        elif day < t.first_date:
            t.first_date = day  # never move an imported first_date later
        db.add(TrialAttendance(trial_id=t.id, date=day))
        linked.add(t.id)
    db.flush()
    for tid in old - linked:  # link for this day removed
        t = db.get(Trial, tid)
        first = db.scalar(select(func.min(TrialAttendance.date))
                          .where(TrialAttendance.trial_id == tid))
        if t.first_date != day:
            continue  # imported/earlier first_date stays
        if first is None:
            db.delete(t)  # created by typing on this day
        else:
            t.first_date = first
    db.commit()
    return row
