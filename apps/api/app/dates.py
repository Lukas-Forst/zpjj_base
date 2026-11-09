from datetime import date, datetime
from zoneinfo import ZoneInfo


def today_berlin() -> date:
    return datetime.now(ZoneInfo("Europe/Berlin")).date()
