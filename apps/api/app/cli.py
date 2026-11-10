"""CLI: python -m app.cli {seed-schedule,seed-presets,import-excel,export}"""
import argparse
import json
import sys
from datetime import time
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import Base, make_engine, make_session_factory
from app.models import Role, Slot, SlotKind, TimerMode, TimerPreset, User

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
D = {"Di": 2, "Mi": 3, "Do": 4, "Fr": 5, "Sa": 6, "So": 7}
NG, G, OM = SlotKind.no_gi, SlotKind.gi, SlotKind.open_mat
# Source: https://zpjj.de/schedule (Monday is closed)
SCHEDULE = [
    ("Di", "18:00", "20:00", NG, ["Nico", "Can"]),
    ("Mi", "20:00", "22:00", NG, ["Tim", "Chris"]),
    ("Do", "18:00", "20:00", NG, ["Nico", "Lukas"]),
    ("Fr", "19:00", "20:30", NG, ["Tim", "Can"]),
    ("Fr", "20:30", "22:00", G, ["Tim", "Can"]),
    ("Sa", "16:00", "17:30", NG, ["Nico", "Chris"]),
    ("Sa", "17:30", "19:00", G, ["Nico", "Chris"]),
    ("So", "10:00", "10:45", NG, ["Tim", "Lukas"]),
    ("So", "10:45", "11:30", G, ["Tim", "Lukas"]),
    ("So", "11:30", "13:00", OM, []),
]


def _t(s: str) -> time:
    return time.fromisoformat(s)


def seed_schedule(db: Session, users_file: Path) -> None:
    if not users_file.exists():
        raise SystemExit(f"Missing {users_file}. Copy users.example.yaml to users.local.yaml and edit.")
    entries = (yaml.safe_load(users_file.read_text()) or {}).get("users", [])
    for e in entries:
        email = e["email"].strip().lower()
        if not db.scalar(select(User).where(User.email == email)):
            db.add(User(email=email, display_name=e["display_name"], role=Role(e["role"]),
                        is_trainer=bool(e.get("is_trainer", False))))
    db.flush()
    by_name = {u.display_name.casefold(): u for u in db.scalars(select(User))}
    needed = {n for *_, names in SCHEDULE for n in names}
    missing = sorted(n for n in needed if n.casefold() not in by_name)
    if missing:
        db.rollback()
        raise SystemExit(f"No user (display_name) for trainer(s): {', '.join(missing)}")
    for i, (day, start, end, kind, names) in enumerate(SCHEDULE):
        wd, st = D[day], _t(start)
        if db.scalar(select(Slot).where(Slot.weekday == wd, Slot.start_time == st, Slot.kind == kind)):
            continue  # keep existing slots (and admin-edited trainers) untouched
        db.add(Slot(weekday=wd, start_time=st, end_time=_t(end), kind=kind, sort_order=i,
                    trainers=[by_name[n.casefold()] for n in names]))
    db.commit()


# Examples only: the team adapts these in the app. Marked "(Beispiel)" in the name.
EXAMPLE_PRESETS = [
    ("Rolling (Beispiel)", TimerMode.rounds, {"rounds": 5, "work": 300, "rest": 30, "prep": 10}),
    ("Drill (Beispiel)", TimerMode.rounds, {"rounds": 3, "work": 180, "rest": 20, "prep": 10}),
    ("Tabata (Beispiel)", TimerMode.rounds, {"rounds": 8, "work": 20, "rest": 10, "prep": 10}),
    ("Wettkampf (Beispiel)", TimerMode.countdown, {"duration": 300}),
]


def seed_presets(db: Session) -> None:
    for i, (name, mode, config) in enumerate(EXAMPLE_PRESETS):
        if not db.scalar(select(TimerPreset).where(TimerPreset.name == name)):
            db.add(TimerPreset(name=name, mode=mode, config=config, sort_order=i))
    db.commit()


def export_json(engine) -> str:
    out = {}
    with engine.connect() as c:
        for t in Base.metadata.sorted_tables:
            out[t.name] = [dict(r._mapping) for r in c.execute(t.select())]
    return json.dumps(out, default=str, ensure_ascii=False, indent=2)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed-schedule")
    s.add_argument("--users-file", type=Path, default=SEED_DIR / "users.local.yaml")
    sub.add_parser("seed-presets")
    sub.add_parser("export")
    sub.add_parser("import-excel").add_argument("path", type=Path)
    a = ap.parse_args(argv)
    engine = make_engine(Settings.from_env().database_url)
    if a.cmd == "export":
        sys.stdout.write(export_json(engine) + "\n")
    else:
        with make_session_factory(engine)() as db:
            if a.cmd == "seed-presets":
                seed_presets(db)
            elif a.cmd == "import-excel":
                from app.import_excel import import_workbook
                print(import_workbook(db, a.path))
            else:
                seed_schedule(db, a.users_file)


if __name__ == "__main__":
    main()
