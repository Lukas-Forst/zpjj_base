from datetime import datetime

from openpyxl import Workbook
from sqlalchemy import func, select

from app.import_excel import import_workbook
from app.models import Attendance, Trial, TrialAttendance


def _wb(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Trainingseinheiten"
    ws.append(["Datum", "", "", "", "Kursart", "", "Gesamt", "Probe", "", "", "Namen"])
    ws.append([datetime(2025, 1, 7), None, None, None, "BJJ", None, 10, 1, None, None, "Nathan"])
    ws.append([datetime(2025, 1, 12), None, None, None, "Open Mat", None, 6, None])
    ws.append([datetime(2025, 1, 14), None, None, None, "BJJ", None, None, None])
    pt = wb.create_sheet("Probetrainings")
    pt.append(["Name", "Erstes", "Zweites"])
    pt.append(["nathan", datetime(2025, 1, 7), datetime(2025, 1, 20)])
    wb.save(path)


def test_import_is_idempotent(app, tmp_path):
    p = tmp_path / "x.xlsx"
    _wb(p)
    with app.state.session_factory() as db:
        assert import_workbook(db, p) == {"days": 2, "skipped": 1, "trials": 1}
        again = import_workbook(db, p)
        assert again == {"days": 0, "skipped": 1, "trials": 0}
        om = db.get(Attendance, datetime(2025, 1, 12).date())
        assert om.open_mat == 6 and om.total is None and om.updated_by is None
        assert db.get(Attendance, datetime(2025, 1, 14).date()) is None
        assert db.get(Attendance, datetime(2025, 1, 7).date()).trials == 1
        assert db.scalar(select(func.count()).select_from(TrialAttendance)) == 1
        assert db.scalar(select(Trial.first_date)).isoformat() == "2025-01-07"


def test_existing_day_untouched(app, tmp_path):
    p = tmp_path / "x.xlsx"
    _wb(p)
    d = datetime(2025, 1, 7).date()
    with app.state.session_factory() as db:
        db.add(Attendance(date=d, total=99, trials=0))
        db.commit()
        assert import_workbook(db, p)["days"] == 1
        assert db.get(Attendance, d).total == 99
        assert db.scalar(select(func.count()).select_from(TrialAttendance)) == 0
