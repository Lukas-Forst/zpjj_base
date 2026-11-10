import pytest

from app.attendance_parse import parse_line


def test_weekday_total_only():
    p = parse_line("10", 2)
    assert (p.total, p.trials, p.names, p.open_mat, p.beginner) == (10, 0, [], None, None)


def test_weekday_with_name():
    p = parse_line("10 1 (David)", 2)
    assert (p.total, p.trials, p.names, p.warnings) == (10, 1, ["David"], [])


def test_weekday_two_names():
    assert parse_line("8 2 (Mathias, Anthony)", 4).names == ["Mathias", "Anthony"]


def test_sunday_with_beginner():
    p = parse_line("0 0 4 (15)", 7)
    assert (p.total, p.trials, p.open_mat, p.beginner) == (0, 0, 4, 15)


def test_sunday_no_beginner_is_none():
    p = parse_line("5 0 4", 7)
    assert (p.total, p.open_mat, p.beginner) == (5, 4, None)


def test_sunday_total_is_members_plus_trials():
    p = parse_line("3 1 4 (Tom)", 7)
    assert (p.total, p.trials, p.names) == (4, 1, ["Tom"])


def test_name_count_mismatch_warns():
    assert len(parse_line("10 2 (David)", 2).warnings) == 1


@pytest.mark.parametrize(
    "text,weekday",
    [
        ("", 2), ("  ", 2), ("abc", 2), ("1 5", 2), ("0 0 4 (15)", 3),
        ("5 0", 7), ("10 1 (David 2)", 2), ("-3", 2), ("10 1 (David", 2),
        ("10 1 David)", 2), ("10 (A) (B)", 2), ("5 0 4 (1) (2)", 7),
        ("10 (3)", 2), ("10 1 2", 2),
    ],
)
def test_rejected(text, weekday):
    with pytest.raises(ValueError):
        parse_line(text, weekday)
