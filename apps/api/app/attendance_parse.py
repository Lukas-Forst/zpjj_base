import re
from dataclasses import dataclass

_GROUP = re.compile(r"\(([^()]*)\)")


@dataclass(frozen=True)
class Parsed:
    total: int  # Gesamt (weekday) or members+trials (Sunday)
    trials: int
    open_mat: int | None  # Sunday only
    beginner: int | None  # Sunday only, None = no course
    names: list[str]
    warnings: list[str]


def _num(s: str) -> bool:
    return s.isascii() and s.isdigit()


def parse_line(text: str, weekday: int) -> Parsed:
    """weekday: date.isoweekday(), 1=Mon..7=Sun. Raises ValueError (German)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Bitte eine Eingabe machen.")
    groups = [g.strip() for g in _GROUP.findall(text)]
    rest = _GROUP.sub(" ", text)
    if "(" in rest or ")" in rest:
        raise ValueError("Klammern sind nicht richtig geschlossen.")
    sunday = weekday == 7

    beginners = [g for g in groups if _num(g)]
    name_groups = [g for g in groups if not _num(g)]
    if beginners and not sunday:
        raise ValueError("Ein Anfängerkurs ist nur sonntags möglich.")
    if len(beginners) > 1:
        raise ValueError("Nur eine Zahl in Klammern (Anfängerkurs) erlaubt.")
    if len(name_groups) > 1:
        raise ValueError("Nur eine Klammer mit Namen erlaubt.")

    names: list[str] = []
    if name_groups:
        names = [n.strip() for n in name_groups[0].split(",")]
        if any(not n or any(c.isdigit() for c in n) for n in names):
            raise ValueError("Namen dürfen nicht leer sein und keine Zahlen enthalten.")
        if len(names) > 30:
            raise ValueError("Maximal 30 Namen erlaubt.")
        if any(len(n) > 100 for n in names):
            raise ValueError("Ein Name darf höchstens 100 Zeichen lang sein.")

    tokens = rest.split()
    if not tokens or not all(_num(t) for t in tokens):
        raise ValueError("Es sind nur Zahlen ohne Minus erlaubt, Namen in Klammern.")
    nums = [int(t) for t in tokens]
    if sunday:
        if len(nums) != 3:
            raise ValueError("Sonntag: drei Zahlen nötig: Mitglieder Probetrainings Openmat.")
        members, trials, open_mat = nums
        total = members + trials
        beginner = int(beginners[0]) if beginners else None
    else:
        if len(nums) > 2:
            raise ValueError("Maximal zwei Zahlen: Gesamt und Probetrainings.")
        total, trials = nums[0], nums[1] if len(nums) == 2 else 0
        if trials > total:
            raise ValueError("Probetrainings können nicht mehr sein als Gesamt.")
        open_mat = beginner = None

    warnings = []
    if len(names) != trials:
        warnings.append(f"{len(names)} Namen für {trials} Probetrainings.")
    return Parsed(total, trials, open_mat, beginner, names, warnings)
