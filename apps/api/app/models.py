import enum
from datetime import UTC, datetime, time

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
