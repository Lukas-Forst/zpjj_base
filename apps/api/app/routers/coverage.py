from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, get_db
from app.coverage import compute_gaps
from app.dates import today_berlin
from app.models import Role, Slot, Substitute, User, Vacation
from app.schemas import GapOut, SubstituteIn

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
