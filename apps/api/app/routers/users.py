import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_db, require_gesellschafter
from app.models import Role, User
from app.schemas import UserCreate, UserOut, UserPatch

log = logging.getLogger("hub.users")
router = APIRouter(prefix="/users", dependencies=[Depends(require_gesellschafter)])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.display_name, User.id)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "E-Mail-Adresse existiert bereits.") from None
    log.info("user %s created", user.id)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(user_id: int, body: UserPatch, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Nutzer nicht gefunden.")
    changes = body.model_dump(exclude_unset=True)
    if "role" in changes and changes["role"] is None or "active" in changes and changes["active"] is None:
        raise HTTPException(422, "role/active dürfen nicht null sein.")
    loses_admin = user.active and user.role == Role.gesellschafter and (
        changes.get("active") is False
        or ("role" in changes and changes["role"] != Role.gesellschafter)
    )
    if loses_admin:
        others = db.scalar(
            select(func.count()).select_from(User).where(
                User.role == Role.gesellschafter, User.active.is_(True), User.id != user.id
            )
        )
        if not others:
            raise HTTPException(
                409, "Der letzte aktive Gesellschafter kann nicht deaktiviert oder herabgestuft werden."
            )
    for k, v in changes.items():
        setattr(user, k, v)
    db.commit()
    return user
