from datetime import datetime

from openpyxl import Workbook
from sqlalchemy import func, select

from app.import_excel import import_workbook
from app.models import Attendance, Trial, TrialAttendance, TrialStatus


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


def test_import_maps_member_status(app, tmp_path):
    from openpyxl import load_workbook
    p = tmp_path / "x.xlsx"
    _wb(p)
    wb = load_workbook(p)
    pt = wb["Probetrainings"]
    pt.delete_rows(1, 10)
    pt.append(["Name", "Erstes", "Zweites", "Angemeldet?", "Anmeldedatum", "Q", "T", "Status"])
    pt.append(["Ana", datetime(2025, 1, 7), None, None, datetime(2025, 2, 1), None, None,
               "Mitglied geworden"])
    pt.append(["Ben", datetime(2025, 1, 8), None, "Ja", None])
    pt.append(["Cem", datetime(2025, 1, 9), None, "Nein", None, None, None, "Offen"])
    wb.save(p)
    with app.state.session_factory() as db:
        import_workbook(db, p)
        t = {x.name: x for x in db.scalars(select(Trial))}
        assert t["Ana"].status == TrialStatus.mitglied
        assert t["Ana"].member_since.isoformat() == "2025-02-01"
        assert t["Ben"].status == TrialStatus.mitglied
        assert t["Ben"].member_since.isoformat() == "2025-01-08"
        assert t["Cem"].status == TrialStatus.offen and t["Cem"].member_since is None
        import_workbook(db, p)  # idempotent
        assert {x.name: x.status for x in db.scalars(select(Trial))} == {
            k: v.status for k, v in t.items()}
        t["Cem"].status = TrialStatus.zahlt_pro_besuch
        db.commit()
        import_workbook(db, p)
        assert db.scalar(select(Trial.status).where(Trial.name == "Cem")) == \
            TrialStatus.zahlt_pro_besuch
