from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.attendance import save_day
from app.attendance_parse import Parsed, parse_line
from app.auth import current_user, get_db
from app.dates import today_berlin
from app.models import Attendance, Slot, Trial, TrialAttendance, User
from app.schemas import (
    AttendanceIn,
    AttendanceOut,
    AttendanceOverview,
    AttendanceParseIn,
    AttendanceParseOut,
    WeekdayAvg,
)

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


def _avg(vals: list[int]) -> float | None:
    return round(sum(vals) / len(vals), 1) if vals else None


@router.get("", response_model=AttendanceOverview)
def overview(days: int = Query(60, ge=1, le=400), _: User = Depends(current_user),
             db: Session = Depends(get_db)):
    today = today_berlin()
    counted = [a for a in db.scalars(select(Attendance))
               if not a.cancelled and a.total is not None]
    by_wd = [_avg([a.total for a in counted if a.date.isoweekday() == wd])
             for wd in range(1, 8)]
    avg14 = _avg([a.total for a in counted
                  if today - timedelta(days=13) <= a.date <= today])
    names: dict[date, list[str]] = {}
    for d, n in db.execute(select(TrialAttendance.date, Trial.name).join(Trial)
                           .order_by(Trial.name)):
        names.setdefault(d, []).append(n)
    rows = db.execute(
        select(Attendance, User.display_name).outerjoin(User, User.id == Attendance.updated_by)
        .where(Attendance.date >= today - timedelta(days=days))
        .order_by(Attendance.date.desc()))
    entries = [AttendanceOut(
        date=a.date, cancelled=a.cancelled, total=a.total, trials=a.trials,
        members=None if a.total is None else a.total - a.trials, open_mat=a.open_mat,
        beginner=a.beginner, names=names.get(a.date, []), updated_by_name=u,
        updated_at=a.updated_at) for a, u in rows]
    return AttendanceOverview(
        entries=entries, avg_14d=avg14,
        avg_by_weekday=[WeekdayAvg(weekday=i + 1, avg=v) for i, v in enumerate(by_wd)])


@router.get("/missing")
def missing(_: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_berlin()
    open_days = set(db.scalars(select(Slot.weekday).where(Slot.active)))
    have = set(db.scalars(select(Attendance.date)))
    for i in range(1, 15):
        d = today - timedelta(days=i)
        if d.isoweekday() in open_days and d not in have:
            return {"date": d}
    return {"date": None}


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
