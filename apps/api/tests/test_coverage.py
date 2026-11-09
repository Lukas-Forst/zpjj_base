from datetime import date, time
from types import SimpleNamespace as NS

from app.coverage import compute_gaps

TODAY = date(2026, 11, 9)  # Montag


def u(i, active=True, trainer=True):
    return NS(id=i, display_name=f"u{i}", active=active, is_trainer=trainer)


def slot(trainers, weekday=2, kind="no_gi", active=True, sid=1, start=time(18)):
    return NS(id=sid, weekday=weekday, kind=kind, active=active, trainers=trainers, start_time=start)


def vac(uid, a, b):
    return NS(user_id=uid, start_date=a, end_date=b)


DI = date(2026, 11, 10)


def test_all_trainers_absent_is_unbesetzt():
    g = compute_gaps([slot([u(1), u(2)])], [vac(1, DI, DI), vac(2, DI, DI)], [], TODAY)
    assert [(x.date, x.level, x.absent_user_ids) for x in g] == [(DI, "unbesetzt", (1, 2))]


def test_one_of_two_is_teilweise():
    g = compute_gaps([slot([u(1), u(2)])], [vac(1, DI, DI)], [], TODAY)
    assert [x.level for x in g] == ["teilweise"]


def test_substitute_makes_besetzt():
    s = NS(slot_id=1, date=DI, user_id=3)
    both = [vac(1, DI, DI), vac(2, DI, DI)]
    assert compute_gaps([slot([u(1), u(2)])], both, [s], TODAY) == []
    assert compute_gaps([slot([u(1)])], [vac(1, DI, DI)], [s], TODAY) == []


def test_open_mat_never_checked():
    assert compute_gaps([slot([u(1)], kind="open_mat")], [vac(1, DI, DI)], [], TODAY) == []


def test_slot_without_trainers_never_checked():
    assert compute_gaps([slot([])], [], [], TODAY) == []


def test_inactive_trainer_ignored():
    assert compute_gaps([slot([u(1, active=False), u(2, trainer=False)])],
                        [vac(1, DI, DI), vac(2, DI, DI)], [], TODAY) == []


def test_inactive_slot_ignored():
    assert compute_gaps([slot([u(1)], active=False)], [vac(1, DI, DI)], [], TODAY) == []


def test_year_boundary():
    today = date(2026, 12, 29)
    freitag = date(2027, 1, 1)
    g = compute_gaps([slot([u(1)], weekday=5)], [vac(1, date(2026, 12, 30), date(2027, 1, 2))],
                     [], today)
    assert [(x.date, x.level) for x in g] == [(freitag, "unbesetzt")]


def test_single_day():
    g = compute_gaps([slot([u(1)])], [vac(1, DI, DI)], [], TODAY)
    assert len(g) == 1


def test_window_is_28_days():
    outside = date(2026, 12, 7)  # Montag, today + 28
    inside = date(2026, 11, 30)  # Montag, today + 21
    mo = slot([u(1)], weekday=1)
    assert compute_gaps([mo], [vac(1, outside, outside)], [], TODAY) == []
    assert len(compute_gaps([mo], [vac(1, inside, inside)], [], TODAY)) == 1


def test_substitute_who_is_on_vacation_does_not_count():
    s = NS(slot_id=1, date=DI, user_id=3)
    g = compute_gaps([slot([u(1)])], [vac(1, DI, DI), vac(3, DI, DI)], [s], TODAY)
    assert [x.level for x in g] == ["unbesetzt"]
