from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth import current_user, get_db
from app.models import SyncState, User
from app.schemas import SyncOut

router = APIRouter(prefix="/sync-status")


@router.get("", response_model=SyncOut)
def status(request: Request, _: User = Depends(current_user), db: Session = Depends(get_db)):
    st = db.get(SyncState, 1)
    return SyncOut(enabled=request.app.state.calendar_client is not None,
                   ok=st is None or st.error is None,
                   error_since=st and st.error_since, last_ok_at=st and st.last_ok_at,
                   unmatched=(st.unmatched if st else []))
