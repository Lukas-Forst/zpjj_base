from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, get_db, require_gesellschafter
from app.models import TimerPreset, User
from app.schemas import PresetCreate, PresetOut, PresetPatch, _validated

router = APIRouter(prefix="/timer-presets")


@router.get("", response_model=list[PresetOut])
def list_presets(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(TimerPreset).order_by(TimerPreset.sort_order, TimerPreset.id)).all()


@router.post("", response_model=PresetOut, status_code=201)
def create_preset(body: PresetCreate, user: User = Depends(require_gesellschafter),
                  db: Session = Depends(get_db)):
    p = TimerPreset(**body.model_dump(), created_by=user.id)
    db.add(p)
    db.commit()
    return p


def _get(db: Session, preset_id: int) -> TimerPreset:
    p = db.get(TimerPreset, preset_id)
    if p is None:
        raise HTTPException(404, "Preset nicht gefunden.")
    return p


@router.patch("/{preset_id}", response_model=PresetOut, dependencies=[Depends(require_gesellschafter)])
def patch_preset(preset_id: int, body: PresetPatch, db: Session = Depends(get_db)):
    p = _get(db, preset_id)
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(422, "Felder dürfen nicht null sein.")
    for k, v in changes.items():
        setattr(p, k, v)
    try:
        p.config = _validated(p.mode, p.config)  # mode and config must stay consistent
    except ValidationError as e:
        db.rollback()
        raise HTTPException(422, "Konfiguration passt nicht zum Modus.") from e
    db.commit()
    return p


@router.delete("/{preset_id}", status_code=204, dependencies=[Depends(require_gesellschafter)])
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, preset_id))
    db.commit()
