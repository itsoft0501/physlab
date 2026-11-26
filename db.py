"""Өгөгдлийн сан: локалд SQLite, hosting (Vercel) дээр Postgres.

`DATABASE_URL` / `POSTGRES_URL` орчны хувьсагч байвал Postgres, үгүй бол `data/physlab.db` (SQLite).
Код бүхэлдээ SQLite хэлбэрийн SQL (`?` placeholder) бичдэг; Postgres-д энд хөрвүүлнэ.
"""
from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(os.getenv("APP_TZ", "Asia/Ulaanbaatar"))
except Exception:  # noqa: BLE001 — tzdata байхгүй бол серверийн цаг
    TZ = None

PG_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or ""
IS_PG = PG_URL.startswith(("postgres://", "postgresql://"))

DATA = Path(os.getenv("DATA_DIR") or Path(__file__).parent / "data")
if not IS_PG:
    DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / "physlab.db"


def now() -> datetime:
    return datetime.now(TZ).replace(tzinfo=None) if TZ else datetime.now()


def now_str() -> str:
    return now().isoformat(sep=" ", timespec="seconds")


def today_str() -> str:
    return now().date().isoformat()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id {PK},
  email TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  grade INTEGER,
  avatar TEXT DEFAULT '🚀',
  role TEXT NOT NULL DEFAULT 'student',
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_active TEXT,
  current_level_id INTEGER,
  placed_at TEXT,
  access_mode TEXT NOT NULL DEFAULT 'all',
  created_at TEXT DEFAULT {NOW}
);
CREATE TABLE IF NOT EXISTS levels (
  id {PK},
  ord INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  pass_pct INTEGER NOT NULL DEFAULT 70,
  color TEXT DEFAULT '#38bdf8',
  icon TEXT DEFAULT '🪐'
);
CREATE TABLE IF NOT EXISTS lessons (
  id {PK},
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  youtube_url TEXT DEFAULT '',
  body_md TEXT DEFAULT '',
  sim_key TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS questions (
  id {PK},
  kind TEXT NOT NULL,
  level_id INTEGER REFERENCES levels(id) ON DELETE CASCADE,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  section TEXT DEFAULT '',
  qtype TEXT NOT NULL DEFAULT 'mcq',
  text TEXT NOT NULL,
  opt_a TEXT, opt_b TEXT, opt_c TEXT, opt_d TEXT,
  answer TEXT NOT NULL,
  tolerance {REAL},
  explanation TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  points INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS attempts (
  id {PK},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  level_id INTEGER,
  lesson_id INTEGER,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT {NOW}
);
CREATE TABLE IF NOT EXISTS answers (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  given TEXT,
  correct INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS user_lessons (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS import_jobs (
  token TEXT PRIMARY KEY,
  created_at {REAL} NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_q_kind ON questions(kind, level_id);
CREATE INDEX IF NOT EXISTS ix_q_lesson ON questions(lesson_id);
CREATE INDEX IF NOT EXISTS ix_att_user ON attempts(user_id);
"""

if IS_PG:
    # Зарим Postgres-д цагийн бүсийн нэр байхгүй тул UTC + тогтмол зөрүү (Монгол: +8)
    _off = int((datetime.now(TZ).utcoffset().total_seconds() if TZ else 0) // 60)
    SCHEMA = _SCHEMA.format(PK="SERIAL PRIMARY KEY", REAL="DOUBLE PRECISION",
                            NOW=f"(to_char(now() AT TIME ZONE 'UTC' + interval '{_off} minutes', 'YYYY-MM-DD HH24:MI:SS'))")
else:
    SCHEMA = _SCHEMA.format(PK="INTEGER PRIMARY KEY AUTOINCREMENT", REAL="REAL", NOW="(datetime('now','localtime'))")


# ---------------- Postgres adapter (sqlite3-тэй ижил интерфэйс) ----------------
class Row(dict):
    """dict + r[0] индексээр хандах (sqlite3.Row шиг)."""

    def __getitem__(self, k):
        if isinstance(k, int):
            return list(self.values())[k]
        return super().__getitem__(k)


_ID_TABLES = {"users", "levels", "lessons", "questions", "attempts"}
_INSERT_RE = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.I)


def _pg_sql(sql: str) -> tuple[str, bool]:
    s = sql.replace("%", "%%").replace("?", "%s")
    s = re.sub(r"\bLIKE\b", "ILIKE", s)
    m = _INSERT_RE.match(s)
    want_id = bool(m and m.group(1).lower() in _ID_TABLES and "RETURNING" not in s.upper())
    if want_id:
        s = s.rstrip().rstrip(";") + " RETURNING id"
    return s, want_id


class PgCursor:
    def __init__(self, cur, want_id):
        self._cur = cur
        self.lastrowid = None
        self.rowcount = cur.rowcount
        if want_id:
            r = cur.fetchone()
            self.lastrowid = r["id"] if r else None

    def _wrap(self, r):
        return Row(r) if r is not None else None

    def fetchone(self):
        return self._wrap(self._cur.fetchone()) if self._cur.description else None

    def fetchall(self):
        return [Row(r) for r in self._cur.fetchall()] if self._cur.description else []

    def __iter__(self):
        return iter(self.fetchall())


class PgConn:
    def __init__(self):
        import psycopg
        from psycopg.rows import dict_row
        # prepare_threshold=None — Neon/pgbouncer pooled холболттой зөрчилдөхгүй
        self._c = psycopg.connect(PG_URL, row_factory=dict_row, prepare_threshold=None, connect_timeout=15)

    def execute(self, sql, args=()):
        s, want_id = _pg_sql(sql)
        cur = self._c.cursor()
        cur.execute(s, tuple(args))
        return PgCursor(cur, want_id)

    def executemany(self, sql, seq):
        s, _ = _pg_sql(sql)
        with self._c.cursor() as cur:
            cur.executemany(s, [tuple(a) for a in seq])

    def executescript(self, script):
        with self._c.cursor() as cur:
            cur.execute(script)

    def commit(self):
        self._c.commit()

    def rollback(self):
        self._c.rollback()

    def close(self):
        self._c.close()


def connect():
    if IS_PG:
        return PgConn()
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


@contextmanager
def tx():
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init() -> None:
    with tx() as con:
        if IS_PG:
            con.execute("SELECT pg_advisory_xact_lock(474747)")  # олон instance зэрэг үүсгэхээс сэргийлнэ
            con.executescript(SCHEMA)
        else:
            con.executescript(SCHEMA)
            cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
            if "access_mode" not in cols:  # хуучин локал DB-д багана нэмэх
                con.execute("ALTER TABLE users ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'all'")


def claim(key: str) -> bool:
    """Нэг удаа хийх ажил (seed г.м.)-ыг зөвхөн нэг instance авна."""
    with tx() as con:
        cur = con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING", (key, now_str()))
        return cur.rowcount == 1


def get_setting(key: str):
    with tx() as con:
        r = row(con, "SELECT value FROM settings WHERE key=?", (key,))
    return r["value"] if r else None


def rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def row(con, sql, args=()):
    r = con.execute(sql, args).fetchone()
    return dict(r) if r else None
