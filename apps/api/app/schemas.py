from datetime import time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Role, SlotKind, TimerMode


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    role: Role
    is_trainer: bool


class UserOut(MeOut):
    email: str
    active: bool


def _email(v: str) -> str:
    v = v.strip().lower()
    if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
        raise ValueError("ungültige E-Mail-Adresse")
    return v


def _name(v: str) -> str:
    v = v.strip()
    if not v or len(v) > 100:
        raise ValueError("Name erforderlich (max. 100 Zeichen)")
    return v


class UserCreate(BaseModel):
    email: str
    display_name: str
    role: Role = Role.trainer
    is_trainer: bool = True

    _e = field_validator("email")(_email)
    _n = field_validator("display_name")(_name)


class UserPatch(BaseModel):
    display_name: str | None = None
    role: Role | None = None
    is_trainer: bool | None = None
    active: bool | None = None

    _n = field_validator("display_name")(lambda v: v if v is None else _name(v))


class TrainerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str


class SlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    weekday: int
    start_time: time
    end_time: time
    kind: SlotKind
    active: bool
    sort_order: int
    trainers: list[TrainerOut]


class SlotCreate(BaseModel):
    weekday: int
    start_time: time
    end_time: time
    kind: SlotKind
    sort_order: int = 0

    @model_validator(mode="after")
    def _check(self):
        if not 1 <= self.weekday <= 7:
            raise ValueError("weekday muss 1..7 sein")
        if self.end_time <= self.start_time:
            raise ValueError("Ende muss nach dem Beginn liegen")
        return self


class SlotPatch(BaseModel):
    weekday: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    kind: SlotKind | None = None
    active: bool | None = None
    sort_order: int | None = None

    @field_validator("weekday")
    @classmethod
    def _wd(cls, v):
        if v is not None and not 1 <= v <= 7:
            raise ValueError("weekday muss 1..7 sein")
        return v


class TrainerIds(BaseModel):
    user_ids: list[int]


# --- timer presets (M1). Times in seconds. ---
MAX_SECONDS = 99 * 60 + 59  # 99:59


class RoundsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rounds: int = Field(ge=1, le=99)
    work: int = Field(ge=1, le=MAX_SECONDS)
    rest: int = Field(ge=0, le=MAX_SECONDS)
    prep: int = Field(default=10, ge=0, le=MAX_SECONDS)


class CountdownConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration: int = Field(ge=1, le=MAX_SECONDS)


class StopwatchConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


_CONFIG = {
    TimerMode.rounds: RoundsConfig,
    TimerMode.countdown: CountdownConfig,
    TimerMode.stopwatch: StopwatchConfig,
}


def _validated(mode: TimerMode, config: dict) -> dict:
    return _CONFIG[mode].model_validate(config).model_dump()


class PresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    mode: TimerMode
    config: dict
    sort_order: int


class PresetCreate(BaseModel):
    name: str
    mode: TimerMode
    config: dict
    sort_order: int = 0

    _n = field_validator("name")(_name)

    @model_validator(mode="after")
    def _cfg(self):
        self.config = _validated(self.mode, self.config)
        return self


class PresetPatch(BaseModel):
    name: str | None = None
    mode: TimerMode | None = None
    config: dict | None = None
    sort_order: int | None = None

    _n = field_validator("name")(lambda v: v if v is None else _name(v))
