import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, get_db
from app.dates import today_berlin
from app.models import Role, User, Vacation, VacationSource
from app.schemas import VacationIn, VacationOut

log = logging.getLogger("base.vacations")
router = APIRouter(prefix="/vacations")
PAST = "Vergangenen Urlaub kann nur ein Gesellschafter ändern."


def _out(v: Vacation) -> VacationOut:
    return VacationOut(id=v.id, user_id=v.user_id, user_name=v.user.display_name,
                       start_date=v.start_date, end_date=v.end_date, source=v.source.value)


def changed(request: Request) -> None:
    hook = getattr(request.app.state, "on_vacation_change", None)
    if hook:
        try:
            hook()
        except Exception:  # the vacation is already saved: never fail the request
            log.exception("calendar sync trigger failed")


@router.get("", response_model=list[VacationOut])
def list_vacations(_: User = Depends(current_user), db: Session = Depends(get_db)):
    since = today_berlin() - timedelta(days=7)
    q = select(Vacation).where(Vacation.end_date >= since).order_by(Vacation.start_date,
                                                                       Vacation.id)
    return [_out(v) for v in db.scalars(q)]


@router.post("", response_model=VacationOut, status_code=201)
def create(body: VacationIn, request: Request, user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    is_boss = user.role == Role.gesellschafter
    target_id = body.user_id or user.id
    if target_id != user.id and not is_boss:
        raise HTTPException(403, "Du darfst nur deinen eigenen Urlaub eintragen.")
    if body.end_date < today_berlin() and not is_boss:
        raise HTTPException(403, PAST)
    target = db.get(User, target_id)
    if not target or not target.is_trainer or not target.active:
        raise HTTPException(422, "Nur aktive Trainer können Urlaub eintragen.")
    start, end = body.start_date, body.end_date
    near = db.scalars(select(Vacation).where(
        Vacation.user_id == target_id, Vacation.source == VacationSource.base,
        Vacation.start_date <= end + timedelta(days=1),
        Vacation.end_date >= start - timedelta(days=1))).all()
    for v in near:  # merge into the new range; ponytail: base entries only, see plan ruling
        start, end = min(start, v.start_date), max(end, v.end_date)
    keep = near[0] if near else Vacation(user_id=target_id, source=VacationSource.base)
    for v in near[1:]:
        db.delete(v)
    keep.start_date, keep.end_date = start, end
    db.add(keep)
    db.commit()
    changed(request)
    return _out(keep)


@router.delete("/{vacation_id}", status_code=204)
def delete(vacation_id: int, request: Request, user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    v = db.get(Vacation, vacation_id)
    if not v:
        raise HTTPException(404, "Nicht gefunden.")
    is_boss = user.role == Role.gesellschafter
    if v.user_id != user.id and not is_boss:
        raise HTTPException(403, "Du darfst nur deinen eigenen Urlaub löschen.")
    if v.end_date < today_berlin() and not is_boss:
        raise HTTPException(403, PAST)
    if v.source == VacationSource.calendar:
        raise HTTPException(409, "Dieser Eintrag kommt aus dem Kalender. Bitte dort löschen.")
    db.delete(v)
    db.commit()
    changed(request)
    return Response(status_code=204)
