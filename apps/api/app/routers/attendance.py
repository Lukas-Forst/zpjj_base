from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.attendance import DayEntry, save_day
from app.auth import current_user, get_db
from app.dates import today_berlin
from app.models import Attendance, Slot, Trial, TrialAttendance, TrialStatus, User
from app.schemas import (
    AttendanceIn,
    AttendanceOut,
    AttendanceOverview,
    MissingOut,
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


def _entry(db: Session, day: date, body: AttendanceIn) -> DayEntry | None:
    _check_day(db, day)
    if body.cancelled:
        return None
    if body.total is None:
        raise HTTPException(422, "Gesamtzahl fehlt.")
    names = [n.strip() for n in body.trial_names]
    if not all(names):
        raise HTTPException(422, "Namen dürfen nicht leer sein.")
    if len({n.casefold() for n in names}) != len(names):
        raise HTTPException(422, "Jeder Name darf nur einmal vorkommen.")
    if len(names) > 30 or any(len(n) > 100 for n in names):
        raise HTTPException(422, "Zu viele oder zu lange Namen.")
    for v in (body.total, body.open_mat, body.beginner):
        if v is not None and not 0 <= v <= MAX_COUNT:
            raise HTTPException(422, f"Zahlen müssen zwischen 0 und {MAX_COUNT} liegen.")
    if body.guests < 0:
        raise HTTPException(422, "Gäste können nicht negativ sein.")
    if len(names) + body.guests > body.total:
        raise HTTPException(422, "Probetrainings und Gäste sind mehr als die Gesamtzahl.")
    if day.isoweekday() != 7 and (body.open_mat is not None or body.beginner is not None):
        raise HTTPException(422, "Openmat und Anfängerkurs gibt es nur sonntags.")
    wording = {TrialStatus.mitglied: "Mitglied", TrialStatus.zahlt_pro_besuch: "zahlt pro Besuch"}
    for n in names:
        t = db.scalar(select(Trial).where(Trial.name_key == n.casefold()))
        if t and t.status in wording:
            raise HTTPException(422, f"{n} ist als {wording[t.status]} markiert und zählt nicht als Probetraining.")
    return DayEntry(body.total, names, body.guests, body.open_mat, body.beginner)


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
        guests=a.guests, members=None if a.total is None else a.total - a.trials - a.guests,
        open_mat=a.open_mat,
        beginner=a.beginner, names=names.get(a.date, []), updated_by_name=u,
        updated_at=a.updated_at) for a, u in rows]
    return AttendanceOverview(
        entries=entries, avg_14d=avg14,
        avg_by_weekday=[WeekdayAvg(weekday=i + 1, avg=v) for i, v in enumerate(by_wd)])


@router.get("/missing", response_model=MissingOut)
def missing(_: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_berlin()
    open_days = set(db.scalars(select(Slot.weekday).where(Slot.active)))
    have = set(db.scalars(select(Attendance.date)))
    for i in range(1, 15):
        d = today - timedelta(days=i)
        if d.isoweekday() in open_days and d not in have:
            return {"date": d}
    return {"date": None}


@router.put("/{day}", response_model=AttendanceOut)
def put_day(day: date, body: AttendanceIn, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    a = save_day(db, day, _entry(db, day, body), user)
    names = list(db.scalars(select(Trial.name).join(TrialAttendance).where(
        TrialAttendance.date == day).order_by(Trial.name)))
    return AttendanceOut(date=a.date, cancelled=a.cancelled, total=a.total, trials=a.trials, guests=a.guests,
                         members=None if a.total is None else a.total - a.trials - a.guests,
                         open_mat=a.open_mat, beginner=a.beginner, names=names,
                         updated_by_name=user.display_name, updated_at=a.updated_at)
