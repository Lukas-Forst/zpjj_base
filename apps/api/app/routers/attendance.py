from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.attendance import save_day
from app.attendance_parse import Parsed, parse_line
from app.auth import current_user, get_db
from app.dates import today_berlin
from app.models import Slot, Trial, TrialAttendance, User
from app.schemas import AttendanceIn, AttendanceOut, AttendanceParseIn, AttendanceParseOut

router = APIRouter(prefix="/attendance")
MAX_COUNT = 1000


def _check_day(db: Session, day: date) -> None:
    if day > today_berlin():
        raise HTTPException(422, "Für die Zukunft kann nichts eingetragen werden.")
    if not db.scalar(select(Slot.id).where(Slot.weekday == day.isoweekday(),
                                           Slot.active).limit(1)):
        raise HTTPException(422, "An diesem Tag ist kein Training.")


def _parse(db: Session, day: date, text: str | None) -> Parsed:
    _check_day(db, day)
    try:
        p = parse_line(text or "", day.isoweekday())
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    if max(p.total, p.open_mat or 0, p.beginner or 0) > MAX_COUNT:
        raise HTTPException(422, f"Zahlen über {MAX_COUNT} sind nicht möglich.")
    return p


@router.post("/parse", response_model=AttendanceParseOut)
def parse(body: AttendanceParseIn, _: User = Depends(current_user),
          db: Session = Depends(get_db)):
    p = _parse(db, body.date, body.text)
    return AttendanceParseOut(total=p.total, trials=p.trials, members=p.total - p.trials,
                              open_mat=p.open_mat, beginner=p.beginner, names=p.names,
                              warnings=p.warnings)


@router.put("/{day}", response_model=AttendanceOut)
def put_day(day: date, body: AttendanceIn, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    if body.cancelled:
        _check_day(db, day)
        p = None
    else:
        p = _parse(db, day, body.text)
    a = save_day(db, day, p, user)
    names = list(db.scalars(select(Trial.name).join(TrialAttendance).where(
        TrialAttendance.date == day).order_by(Trial.name)))
    return AttendanceOut(date=a.date, cancelled=a.cancelled, total=a.total, trials=a.trials,
                         members=None if a.total is None else a.total - a.trials,
                         open_mat=a.open_mat, beginner=a.beginner, names=names,
                         updated_by_name=user.display_name, updated_at=a.updated_at)
