"""Two-way vacation sync. Base entries are authoritative; calendar-origin entries follow the
calendar, but only after a *successful* fetch (a failed fetch changes nothing)."""
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gcal import CalendarClient, first_word, match_user
from app.models import SyncState, User, Vacation, VacationSource


def _state(db: Session) -> SyncState:
    st = db.get(SyncState, 1)
    if st is None:
        st = SyncState(id=1, unmatched=[])
        db.add(st)
    return st


def sync(db: Session, client: CalendarClient, today: date, now: datetime) -> None:
    lo, hi = today - timedelta(days=30), today + timedelta(days=365)
    try:
        events = client.list_events(lo, hi)
        _apply(db, client, events, lo, hi)
        st = _state(db)
        st.last_ok_at, st.error, st.error_since = now, None, None
        db.commit()
    except Exception as exc:  # any failure: undo local changes, flag, never touch data
        db.rollback()
        st = _state(db)
        st.error = f"{type(exc).__name__}: {exc}"[:500]
        st.error_since = st.error_since or now
        db.commit()


def _apply(db: Session, client: CalendarClient, events, lo: date, hi: date) -> None:
    users = list(db.scalars(select(User).where(User.active.is_(True))))
    vacs = list(db.scalars(select(Vacation).where(Vacation.end_date >= lo,
                                                  Vacation.start_date <= hi)))
    by_id = {e.id: e for e in events}
    by_base = {e.private_base_id: e for e in events if e.private_base_id}
    base_ids = {str(v.id) for v in vacs if v.source == VacationSource.base}

    for v in (v for v in vacs if v.source == VacationSource.base):
        ev = by_id.get(v.gcal_event_id) or by_base.get(str(v.id))  # adopt after half-failed run
        if ev is None:
            v.gcal_event_id = client.create(f"{first_word(v.user.display_name).capitalize()} Urlaub",
                                            v.start_date, v.end_date, v.id)
        else:
            v.gcal_event_id = ev.id
            if (ev.start, ev.end_inclusive) != (v.start_date, v.end_date):
                client.update(ev.id, v.start_date, v.end_date)

    for ev in events:  # events made by the Base whose vacation is gone
        if ev.private_base_id and ev.private_base_id not in base_ids:
            client.delete(ev.id)

    unmatched: set[str] = set()
    seen: set[str] = set()
    known = {v.gcal_event_id: v for v in vacs if v.source == VacationSource.calendar}
    for ev in (e for e in events if not e.private_base_id):
        u = match_user(ev.title, users)
        if u is None or u == "ambiguous":
            unmatched.add(ev.title)
            continue
        seen.add(ev.id)
        v = known.get(ev.id)
        if v is None:
            db.add(Vacation(user_id=u.id, start_date=ev.start, end_date=ev.end_inclusive,
                            source=VacationSource.calendar, gcal_event_id=ev.id))
        else:
            v.user_id, v.start_date, v.end_date = u.id, ev.start, ev.end_inclusive

    for eid, v in known.items():
        if eid not in seen:
            db.delete(v)
    _state(db).unmatched = sorted(unmatched)
