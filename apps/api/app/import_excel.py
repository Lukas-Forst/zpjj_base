from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attendance, Trial, TrialAttendance


def _d(v) -> date | None:
    return v.date() if isinstance(v, datetime) else v if isinstance(v, date) else None


def import_workbook(db: Session, path: Path) -> dict[str, int]:
    """One-off history import. Existing days stay untouched; safe to re-run."""
    wb = load_workbook(path, data_only=True, read_only=True)
    days = skipped = 0
    new_days: set[date] = set()
    seen: dict[str, tuple[str, date]] = {}  # name_key -> (name, earliest date)
    links: set[tuple[str, date]] = set()

    def see(name: str, d: date, link: bool) -> None:
        name = name.strip()
        if not name:
            return
        k = name.casefold()
        seen[k] = (seen[k][0], min(seen[k][1], d)) if k in seen else (name, d)
        if link:
            links.add((k, d))

    for r in list(wb["Trainingseinheiten"].iter_rows(min_row=2, values_only=True)):
        r = (list(r) + [None] * 11)[:11]
        d, kind, g, h, names = _d(r[0]), r[4], r[6], r[7], r[10]
        if d is None or not isinstance(g, (int, float)):
            skipped += 1
            continue
        g = int(g)
        if db.get(Attendance, d) is None and d not in new_days:
            if str(kind or "").strip().casefold() == "open mat":
                row = Attendance(date=d, total=None, open_mat=g)
            else:
                row = Attendance(date=d, total=g, trials=min(int(h or 0), g))
            db.add(row)
            new_days.add(d)
            days += 1
        for n in str(names or "").split(","):
            see(n, d, True)
    for r in wb["Probetrainings"].iter_rows(min_row=2, values_only=True):
        for v in r[1:3]:
            if r[0] and _d(v):
                see(str(r[0]), _d(v), True)
    db.flush()
    trials = 0
    ids: dict[str, int] = {}
    for k, (name, first) in seen.items():
        t = db.scalar(select(Trial).where(Trial.name_key == k))
        if t is None:
            t = Trial(name=name, name_key=k, first_date=first)
            db.add(t)
            trials += 1
        else:
            t.first_date = min(t.first_date, first)
        db.flush()
        ids[k] = t.id
    for k, d in links:
        if d in new_days and db.get(TrialAttendance, (ids[k], d)) is None:
            db.add(TrialAttendance(trial_id=ids[k], date=d))
    db.commit()
    return {"days": days, "skipped": skipped, "trials": trials}
