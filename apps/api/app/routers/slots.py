from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import current_user, get_db, require_gesellschafter
from app.models import Role, Slot, User
from app.schemas import SlotCreate, SlotOut, SlotPatch, TrainerIds

router = APIRouter(prefix="/slots")
DUP = "Dieser Slot existiert bereits."


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUP) from None


@router.get("", response_model=list[SlotOut])
def list_slots(include_inactive: bool = False, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    q = select(Slot).order_by(Slot.weekday, Slot.start_time, Slot.sort_order, Slot.id)
    if not (include_inactive and user.role == Role.gesellschafter):
        q = q.where(Slot.active.is_(True))
    return db.scalars(q).all()


@router.post("", response_model=SlotOut, status_code=201, dependencies=[Depends(require_gesellschafter)])
def create_slot(body: SlotCreate, db: Session = Depends(get_db)):
    slot = Slot(**body.model_dump())
    db.add(slot)
    _commit(db)
    return slot


def _get(db: Session, slot_id: int) -> Slot:
    slot = db.get(Slot, slot_id)
    if slot is None:
        raise HTTPException(404, "Slot nicht gefunden.")
    return slot


@router.patch("/{slot_id}", response_model=SlotOut, dependencies=[Depends(require_gesellschafter)])
def patch_slot(slot_id: int, body: SlotPatch, db: Session = Depends(get_db)):
    slot = _get(db, slot_id)
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(422, "Felder dürfen nicht null sein.")
    for k, v in changes.items():
        setattr(slot, k, v)
    if slot.end_time <= slot.start_time:
        db.rollback()
        raise HTTPException(422, "Ende muss nach dem Beginn liegen.")
    _commit(db)
    return slot


@router.put("/{slot_id}/trainers", response_model=SlotOut, dependencies=[Depends(require_gesellschafter)])
def set_trainers(slot_id: int, body: TrainerIds, db: Session = Depends(get_db)):
    slot = _get(db, slot_id)
    ids = set(body.user_ids)
    users = db.scalars(select(User).where(User.id.in_(ids))).all() if ids else []
    bad = ids - {u.id for u in users if u.active and u.is_trainer}
    if bad:
        raise HTTPException(422, f"Keine aktiven Trainer: {sorted(bad)}")
    slot.trainers = sorted(users, key=lambda u: u.id)
    db.commit()
    return slot
