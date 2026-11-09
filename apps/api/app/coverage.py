from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

CHECKED_KINDS = {"no_gi", "gi"}


@dataclass(frozen=True)
class Gap:
    date: date
    slot_id: int
    level: Literal["unbesetzt", "teilweise"]
    absent_user_ids: tuple[int, ...]


def compute_gaps(slots: Sequence, vacations: Sequence, substitutes: Sequence, today: date,
                 days: int = 28) -> list[Gap]:
    gaps: list[Gap] = []
    for offset in range(days):
        d = today + timedelta(days=offset)
        off = {v.user_id for v in vacations if v.start_date <= d <= v.end_date}
        for s in slots:
            if not s.active or str(s.kind) not in CHECKED_KINDS or s.weekday != d.isoweekday():
                continue
            trainers = [t.id for t in s.trainers if t.active and t.is_trainer]
            absent = tuple(t for t in trainers if t in off)
            if not absent:
                continue
            if any(x.slot_id == s.id and x.date == d and x.user_id not in off for x in substitutes):
                continue
            level = "unbesetzt" if len(absent) == len(trainers) else "teilweise"
            gaps.append(Gap(d, s.id, level, absent))
    start = {s.id: s.start_time for s in slots}
    gaps.sort(key=lambda g: (g.date, start[g.slot_id]))
    return gaps
