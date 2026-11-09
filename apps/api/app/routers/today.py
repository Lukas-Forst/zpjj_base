from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request

from app import trello
from app.auth import current_user
from app.models import User
from app.schemas import TodayOut

router = APIRouter(prefix="/today")


@router.get("", response_model=TodayOut)
def today(request: Request, _: User = Depends(current_user)):
    s = request.app.state.settings
    now = datetime.now(ZoneInfo("Europe/Berlin")).date()
    if not (s.trello_key and s.trello_token and s.trello_board):
        return TodayOut(status="unconfigured", week=now.isocalendar().week, weekday=now.weekday(),
                        days=[], next_week=None)
    fetch = getattr(request.app.state, "trello_fetch", None) or (
        lambda: trello.fetch_lists(s.trello_key, s.trello_token, s.trello_board))
    return TodayOut(weekday=now.weekday(), **trello.week_data(fetch, now))
