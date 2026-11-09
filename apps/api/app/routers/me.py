from fastapi import APIRouter, Depends

from app.auth import current_user
from app.models import User
from app.schemas import MeOut

router = APIRouter()


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return user
