from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, get_db
from app.coverage import compute_gaps, slot_status
from app.dates import today_berlin
from app.models import Role, Slot, Substitute, User, Vacation
from app.schemas import (
    GapOut,
    PlanDay,
    PlanSlot,
    PlanSubstitute,
    PlanWeek,
    SubstituteIn,
    SubstituteOut,
)

router = APIRouter(prefix="/coverage")


def _load(db: Session, today, with_substitutes=True):
    slots = db.scalars(select(Slot).where(Slot.active.is_(True))).all()
    vacs = db.scalars(select(Vacation).where(Vacation.end_date >= today)).all()
    subs = db.scalars(select(Substitute).where(Substitute.date >= today)).all() \
        if with_substitutes else []
    return slots, vacs, subs


@router.get("", response_model=list[GapOut])
def coverage(_: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_berlin()
    slots, vacs, subs = _load(db, today)
    by_slot = {s.id: s for s in slots}
    names = {u.id: u.display_name for u in db.scalars(select(User))}
    return [GapOut(date=g.date, slot_id=g.slot_id, weekday=by_slot[g.slot_id].weekday,
                   start_time=by_slot[g.slot_id].start_time, kind=by_slot[g.slot_id].kind,
                   level=g.level, absent=[names[i] for i in g.absent_user_ids])
            for g in compute_gaps(slots, vacs, subs, today)]


@router.get("/plan", response_model=list[PlanWeek])
def plan(_: User = Depends(current_user), db: Session = Depends(get_db)):
    """This week and the next two (Mon-Sun), from today on, one card per active slot."""
    today = today_berlin()
    slots, vacs, subs = _load(db, today)
    slots.sort(key=lambda s: (s.start_time, s.id))
    names = {u.id: u.display_name for u in db.scalars(select(User))}
    monday = today - timedelta(days=today.isoweekday() - 1)
    weeks = []
    for i in range(3):
        start = monday + timedelta(days=7 * i)
        days, open_, partial = [], 0, 0
        for o in range(7):
            d = start + timedelta(days=o)
            if d < today:
                continue
            off = {v.user_id for v in vacs if v.start_date <= d <= v.end_date}
            cards = []
            for s in slots:
                if s.weekday != d.isoweekday():
                    continue
                status, absent = slot_status(s, d, off, subs)
                open_ += status == "unbesetzt"
                partial += status == "teilweise"
                cards.append(PlanSlot(
                    slot_id=s.id, start_time=s.start_time, kind=s.kind, status=status,
                    trainers=[t.display_name for t in s.trainers if t.active and t.is_trainer],
                    absent=[names[a] for a in absent],
                    substitutes=[PlanSubstitute(user_id=x.user_id, user_name=names[x.user_id])
                                 for x in subs
                                 if x.slot_id == s.id and x.date == d and x.user_id not in off]))
            if cards:
                days.append(PlanDay(date=d, weekday=d.isoweekday(), slots=cards))
        weeks.append(PlanWeek(week_start=start, iso_week=start.isocalendar().week,
                              unbesetzt=open_, teilweise=partial, days=days))
    return weeks


@router.get("/substitutes", response_model=list[SubstituteOut])
def list_substitutes(_: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Substitute, Slot, User).join(Slot, Slot.id == Substitute.slot_id).join(
        User, User.id == Substitute.user_id).where(
        Substitute.date >= today_berlin()).order_by(Substitute.date, Slot.start_time)
    return [SubstituteOut(slot_id=sb.slot_id, date=sb.date, user_id=sb.user_id,
                          user_name=u.display_name, weekday=sl.weekday,
                          start_time=sl.start_time, kind=sl.kind) for sb, sl, u in db.execute(q)]


@router.put("/substitutes", status_code=204)
def add_substitute(body: SubstituteIn, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    target_id = body.user_id or user.id
    if target_id != user.id and user.role != Role.gesellschafter:
        raise HTTPException(403, "Du darfst nur dich selbst als Vertretung eintragen.")
    today = today_berlin()
    slots, vacs, _ = _load(db, today, with_substitutes=False)
    # the date must be a day on which somebody of this slot is absent
    if not any(g.slot_id == body.slot_id and g.date == body.date
               for g in compute_gaps(slots, vacs, [], today)):
        raise HTTPException(422, "An diesem Tag ist für diese Einheit keine Vertretung nötig.")
    target = db.get(User, target_id)
    if not target or not target.active or not target.is_trainer:
        raise HTTPException(422, "Nur aktive Trainer können einspringen.")
    if any(v.user_id == target_id and v.start_date <= body.date <= v.end_date for v in vacs):
        raise HTTPException(409, "Du hast an diesem Tag Urlaub.")
    db.merge(Substitute(slot_id=body.slot_id, date=body.date, user_id=target_id))
    db.commit()
    return Response(status_code=204)


@router.delete("/substitutes", status_code=204)
def remove_substitute(slot_id: int, date: Date, user_id: int, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    if user_id != user.id and user.role != Role.gesellschafter:
        raise HTTPException(403, "Du darfst nur deine eigene Vertretung austragen.")
    row = db.get(Substitute, (slot_id, date, user_id))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
