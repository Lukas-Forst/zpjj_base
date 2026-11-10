-- Schema at head of the former FastAPI/Alembic app (0001-0006). Dates YYYY-MM-DD, timestamps ISO-8601 UTC, booleans 0/1.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gesellschafter', 'trainer')),
  is_trainer INTEGER NOT NULL DEFAULT 0 CHECK (is_trainer IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE slots (
  id INTEGER PRIMARY KEY,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('no_gi', 'gi', 'open_mat')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  UNIQUE (weekday, start_time, kind)
);

CREATE TABLE slot_trainers (
  slot_id INTEGER NOT NULL REFERENCES slots (id),
  user_id INTEGER NOT NULL REFERENCES users (id),
  PRIMARY KEY (slot_id, user_id)
);

CREATE TABLE timer_presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('rounds', 'countdown', 'stopwatch')),
  config TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE vacations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('base', 'calendar')),
  gcal_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE substitutes (
  slot_id INTEGER NOT NULL REFERENCES slots (id),
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id),
  PRIMARY KEY (slot_id, date, user_id)
);

CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY,
  last_ok_at TEXT,
  error_since TEXT,
  error TEXT,
  unmatched TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE attendance (
  date TEXT PRIMARY KEY,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  total INTEGER,
  trials INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  open_mat INTEGER,
  beginner INTEGER,
  updated_by INTEGER REFERENCES users (id),
  updated_at TEXT NOT NULL,
  CHECK (total IS NULL OR trials + guests <= total),
  CHECK (
    (total IS NULL OR total >= 0) AND trials >= 0 AND guests >= 0
    AND (open_mat IS NULL OR open_mat >= 0) AND (beginner IS NULL OR beginner >= 0)
  )
);

CREATE TABLE trials (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  first_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'mitglied', 'zahlt_pro_besuch')),
  member_since TEXT
);

CREATE TABLE trial_attendance (
  trial_id INTEGER NOT NULL REFERENCES trials (id),
  date TEXT NOT NULL REFERENCES attendance (date),
  PRIMARY KEY (trial_id, date)
);
