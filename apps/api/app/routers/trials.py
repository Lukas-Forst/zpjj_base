from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import current_user, get_db
from app.dates import today_berlin
from app.models import Trial, TrialAttendance, TrialStatus, User
from app.schemas import TrialOut, TrialPatch

router = APIRouter(prefix="/trials")


def _rows(db: Session, trial_id: int | None = None) -> list[TrialOut]:
    q = (select(Trial, func.count(TrialAttendance.date), func.max(TrialAttendance.date))
         .outerjoin(TrialAttendance, TrialAttendance.trial_id == Trial.id).group_by(Trial.id))
    if trial_id is not None:
        q = q.where(Trial.id == trial_id)
    today = today_berlin()
    out = [TrialOut(
        id=t.id, name=t.name, status=t.status.value, first_date=t.first_date,
        member_since=t.member_since, visits=n, last_visit=last,
        due=t.status == TrialStatus.offen and n >= 2,
        recent=last is not None and today - timedelta(days=28) <= last <= today,
    ) for t, n, last in db.execute(q)]
    out.sort(key=lambda o: (not o.due, -(o.last_visit.toordinal() if o.last_visit else 0),
                            o.name.casefold()))
    return out


@router.get("", response_model=list[TrialOut])
def list_trials(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return _rows(db)


@router.patch("/{trial_id}", response_model=TrialOut)
def patch_trial(trial_id: int, body: TrialPatch, _: User = Depends(current_user),
                db: Session = Depends(get_db)):
    t = db.get(Trial, trial_id)
    if not t:
        raise HTTPException(404, "Person nicht gefunden.")
    t.status = body.status
    t.member_since = ((body.member_since or today_berlin())
                      if body.status == TrialStatus.mitglied else None)
    db.commit()
    return _rows(db, trial_id)[0]
