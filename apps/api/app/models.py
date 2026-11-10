import datetime as dt
import enum
from datetime import UTC, date, datetime, time

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _enum(e: type[enum.Enum], name: str) -> sa.Enum:
    return sa.Enum(
        e, name=name, native_enum=False, create_constraint=True,
        values_callable=lambda x: [m.value for m in x],
    )


class Role(enum.StrEnum):
    gesellschafter = "gesellschafter"
    trainer = "trainer"


class SlotKind(enum.StrEnum):
    no_gi = "no_gi"
    gi = "gi"
    open_mat = "open_mat"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(sa.String(255), unique=True)  # always lowercase
    display_name: Mapped[str] = mapped_column(sa.String(100))
    role: Mapped[Role] = mapped_column(_enum(Role, "role"))
    is_trainer: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now, onupdate=_now)


class SlotTrainer(Base):
    __tablename__ = "slot_trainers"
    slot_id: Mapped[int] = mapped_column(sa.ForeignKey("slots.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id"), primary_key=True)


class Slot(Base):
    __tablename__ = "slots"
    __table_args__ = (
        sa.UniqueConstraint("weekday", "start_time", "kind"),
        sa.CheckConstraint("weekday BETWEEN 1 AND 7"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    weekday: Mapped[int]  # 1 = Monday ... 7 = Sunday
    start_time: Mapped[time]  # local gym time (Europe/Berlin)
    end_time: Mapped[time]
    kind: Mapped[SlotKind] = mapped_column(_enum(SlotKind, "slot_kind"))
    active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    location: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)  # None = home gym
    trainers: Mapped[list[User]] = relationship(secondary="slot_trainers", order_by=User.id)


class TimerMode(enum.StrEnum):
    rounds = "rounds"
    countdown = "countdown"
    stopwatch = "stopwatch"


class TimerPreset(Base):
    __tablename__ = "timer_presets"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(100))
    mode: Mapped[TimerMode] = mapped_column(_enum(TimerMode, "timer_mode"))
    config: Mapped[dict] = mapped_column(sa.JSON)  # seconds; shape depends on mode
    sort_order: Mapped[int] = mapped_column(default=0)
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now, onupdate=_now)


class VacationSource(enum.StrEnum):
    base = "base"
    calendar = "calendar"


class Vacation(Base):
    __tablename__ = "vacations"
    __table_args__ = (sa.CheckConstraint("end_date >= start_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id"))
    start_date: Mapped[date]
    end_date: Mapped[date]  # inclusive
    source: Mapped[VacationSource] = mapped_column(_enum(VacationSource, "vacation_source"))
    gcal_event_id: Mapped[str | None] = mapped_column(sa.String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now, onupdate=_now)
    user: Mapped[User] = relationship()


class Substitute(Base):
    __tablename__ = "substitutes"
    slot_id: Mapped[int] = mapped_column(sa.ForeignKey("slots.id"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id"), primary_key=True)


class SyncState(Base):
    __tablename__ = "sync_state"
    id: Mapped[int] = mapped_column(primary_key=True)  # always 1
    last_ok_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    error_since: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    unmatched: Mapped[list] = mapped_column(sa.JSON, default=list)


class TrialStatus(enum.StrEnum):
    offen = "offen"
    mitglied = "mitglied"
    zahlt_pro_besuch = "zahlt_pro_besuch"


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        sa.CheckConstraint("total IS NULL OR trials + guests <= total"),
        sa.CheckConstraint(
            "(total IS NULL OR total >= 0) AND trials >= 0 AND guests >= 0"
            " AND (open_mat IS NULL OR open_mat >= 0) AND (beginner IS NULL OR beginner >= 0)"
        ),
    )
    date: Mapped[dt.date] = mapped_column(primary_key=True)
    cancelled: Mapped[bool] = mapped_column(default=False)
    total: Mapped[int | None] = mapped_column(nullable=True)
    trials: Mapped[int] = mapped_column(default=0)
    guests: Mapped[int] = mapped_column(default=0, server_default="0")
    open_mat: Mapped[int | None] = mapped_column(nullable=True)
    beginner: Mapped[int | None] = mapped_column(nullable=True)
    updated_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default=_now, onupdate=_now)


class Trial(Base):
    __tablename__ = "trials"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(100))
    name_key: Mapped[str] = mapped_column(sa.String(100), unique=True)  # casefolded name
    first_date: Mapped[dt.date]
    status: Mapped[TrialStatus] = mapped_column(
        _enum(TrialStatus, "trial_status"), default=TrialStatus.offen,
        server_default=TrialStatus.offen.value,
    )
    member_since: Mapped[dt.date | None] = mapped_column(nullable=True)


class TrialAttendance(Base):
    __tablename__ = "trial_attendance"
    trial_id: Mapped[int] = mapped_column(sa.ForeignKey("trials.id"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(sa.ForeignKey("attendance.date"), primary_key=True)
