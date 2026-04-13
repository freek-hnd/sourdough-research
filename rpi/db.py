"""Local SQLite store for the RPi collector.

Mirrors the Supabase schema so rows can be synced 1:1 via REST.
Timestamps are stored as ISO-8601 UTC strings (matching timestamptz on the
wire). JSON/array fields are stored as TEXT and serialized with json.dumps.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), isolation_level=None, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS root_starters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  description TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('esp32','rpi')),
  has_load_cell INTEGER NOT NULL DEFAULT 0,
  has_ir_sensor INTEGER NOT NULL DEFAULT 0,
  mac_address TEXT,
  ip_address TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('starter','dough')),
  parent_item_id TEXT,
  root_starter_id TEXT NOT NULL REFERENCES root_starters(id),
  flour_g REAL NOT NULL,
  water_g REAL NOT NULL,
  starter_g REAL,
  salt_g REAL,
  extras_json TEXT,
  total_weight_g REAL NOT NULL,
  num_children INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  mixed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  type TEXT NOT NULL CHECK (type IN ('starter','dough')),
  container_type TEXT NOT NULL DEFAULT 'default',
  weight_g REAL NOT NULL,
  station_id INTEGER REFERENCES stations(id),
  inkbird_probe INTEGER CHECK (inkbird_probe BETWEEN 1 AND 4),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  station_id INTEGER NOT NULL REFERENCES stations(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  measured_at TEXT NOT NULL,
  tof_median_mm REAL,
  tof_min_mm REAL,
  tof_max_mm REAL,
  tof_grid TEXT,            -- JSON array of ints (64)
  co2_ppm REAL,
  scd_temp_c REAL,
  scd_humidity_pct REAL,
  ds18b20_temp_c REAL,
  ir_surface_temp_c REAL,
  load_cell_g REAL,
  UNIQUE (station_id, measured_at)
);

CREATE TABLE IF NOT EXISTS ph_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  hanna_device_id INTEGER NOT NULL DEFAULT 1,
  measured_at TEXT NOT NULL,
  ph REAL,
  mv REAL,
  temp_c REAL,
  status TEXT,
  hanna_code TEXT,
  is_manual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inkbird_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_at TEXT NOT NULL,
  probe1_c REAL,
  probe2_c REAL,
  probe3_c REAL,
  probe4_c REAL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  station_id INTEGER REFERENCES stations(id),
  event_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  value TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  loaf_weight_g REAL,
  bake_temp_c REAL,
  bake_duration_min REAL,
  internal_temp_c REAL,
  notes TEXT,
  baked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  rater_name TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  notes TEXT,
  rated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  storage_url TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  caption TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
  table_name TEXT PRIMARY KEY,
  last_synced_id TEXT,
  last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_measurements_station_time ON measurements (station_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_ph_readings_station_time ON ph_readings (station_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_inkbird_readings_time ON inkbird_readings (measured_at);
CREATE INDEX IF NOT EXISTS idx_events_station_time ON events (station_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sessions_station_time ON sessions (station_id, started_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_items_batch ON items (batch_id);
"""


def init_db(db_path: str | Path, station_id: int = 1) -> sqlite3.Connection:
    conn = connect(db_path)
    conn.executescript(SCHEMA)
    # Ensure this station exists so FK constraints on measurements etc. pass.
    conn.execute(
        "INSERT OR IGNORE INTO stations (id, label, device_type) VALUES (?, ?, ?)",
        (station_id, f"station-{station_id}", "rpi"),
    )
    return conn


# Sync-relevant tables in dependency order (parents before children).
SYNC_TABLES: tuple[str, ...] = (
    "measurements",
    "ph_readings",
    "inkbird_readings",
    "events",
)


# ---------- Inserts ----------

_MEASUREMENT_COLS = (
    "tof_median_mm", "tof_min_mm", "tof_max_mm", "tof_grid",
    "co2_ppm", "scd_temp_c", "scd_humidity_pct",
    "ds18b20_temp_c", "ir_surface_temp_c", "load_cell_g",
)


def insert_measurement(
    db: sqlite3.Connection,
    station_id: int,
    measured_at: str,
    **sensor_data: Any,
) -> None:
    """Upsert a measurement row on (station_id, measured_at).

    Unknown sensor keys are silently ignored. `tof_grid` may be a list; it
    will be JSON-encoded.
    """
    payload: dict[str, Any] = {k: sensor_data.get(k) for k in _MEASUREMENT_COLS}
    if isinstance(payload["tof_grid"], (list, tuple)):
        payload["tof_grid"] = json.dumps(list(payload["tof_grid"]))

    cols = ["station_id", "measured_at", *_MEASUREMENT_COLS]
    placeholders = ",".join("?" for _ in cols)
    updates = ",".join(f"{c}=excluded.{c}" for c in _MEASUREMENT_COLS)
    values = [station_id, measured_at, *[payload[k] for k in _MEASUREMENT_COLS]]

    db.execute(
        f"INSERT INTO measurements ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(station_id, measured_at) DO UPDATE SET {updates}",
        values,
    )


def insert_ph_reading(
    db: sqlite3.Connection,
    station_id: int,
    hanna_device_id: int,
    measured_at: str,
    ph: float | None = None,
    mv: float | None = None,
    temp_c: float | None = None,
    status: str | None = None,
    hanna_code: str | None = None,
    is_manual: bool = False,
) -> None:
    db.execute(
        "INSERT INTO ph_readings "
        "(station_id, hanna_device_id, measured_at, ph, mv, temp_c, status, hanna_code, is_manual) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (station_id, hanna_device_id, measured_at, ph, mv, temp_c,
         status, hanna_code, 1 if is_manual else 0),
    )


def insert_inkbird_reading(
    db: sqlite3.Connection,
    measured_at: str,
    probe1: float | None,
    probe2: float | None,
    probe3: float | None,
    probe4: float | None,
) -> None:
    db.execute(
        "INSERT INTO inkbird_readings "
        "(measured_at, probe1_c, probe2_c, probe3_c, probe4_c) VALUES (?, ?, ?, ?, ?)",
        (measured_at, probe1, probe2, probe3, probe4),
    )


def insert_event(
    db: sqlite3.Connection,
    event_name: str,
    station_id: int | None = None,
    session_id: str | None = None,
    value: str | None = None,
    notes: str | None = None,
    occurred_at: str | None = None,
    event_id: str | None = None,
) -> str:
    import uuid
    eid = event_id or str(uuid.uuid4())
    db.execute(
        "INSERT INTO events (id, session_id, station_id, event_name, occurred_at, value, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (eid, session_id, station_id, event_name, occurred_at or _utcnow_iso(), value, notes),
    )
    return eid


# ---------- Sync helpers ----------

def fetch_unsynced_local(
    db: sqlite3.Connection,
    table_name: str,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Return local rows with rowid > last_synced cursor, including rowid."""
    if table_name not in SYNC_TABLES:
        raise ValueError(f"unknown sync table: {table_name}")

    cur = db.execute(
        "SELECT last_synced_id FROM sync_log WHERE table_name = ?",
        (table_name,),
    )
    row = cur.fetchone()
    last = int(row["last_synced_id"]) if row and row["last_synced_id"] else 0

    rows = db.execute(
        f"SELECT rowid AS _rowid, * FROM {table_name} "
        f"WHERE rowid > ? ORDER BY rowid ASC LIMIT ?",
        (last, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def get_unsynced_rows(
    db: sqlite3.Connection,
    table_name: str,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Return remote-shaped rows pending sync (for tests / inspection)."""
    return [
        _row_to_remote(table_name, {k: v for k, v in r.items() if k != "_rowid"})
        for r in fetch_unsynced_local(db, table_name, limit)
    ]


def update_sync_cursor(
    db: sqlite3.Connection,
    table_name: str,
    last_id: int | str,
) -> None:
    db.execute(
        "INSERT INTO sync_log (table_name, last_synced_id, last_synced_at) "
        "VALUES (?, ?, ?) "
        "ON CONFLICT(table_name) DO UPDATE SET "
        "last_synced_id=excluded.last_synced_id, last_synced_at=excluded.last_synced_at",
        (table_name, str(last_id), _utcnow_iso()),
    )


def _row_to_remote(table_name: str, row: dict[str, Any]) -> dict[str, Any]:
    """Transform a local SQLite row into the Supabase REST payload shape."""
    # Drop the local autoincrement id — Supabase generates its own.
    row.pop("id", None)

    if table_name == "measurements" and row.get("tof_grid"):
        try:
            row["tof_grid"] = json.loads(row["tof_grid"])
        except (TypeError, ValueError):
            row["tof_grid"] = None

    if table_name == "ph_readings":
        row["is_manual"] = bool(row.get("is_manual"))

    return row


def mark_synced_by_local_id(
    db: sqlite3.Connection,
    table_name: str,
    local_rows: Iterable[dict[str, Any]],
) -> None:
    """Advance the cursor to the highest rowid in a synced batch."""
    max_rowid = 0
    for r in local_rows:
        rid = r.get("_rowid") or r.get("id")
        if isinstance(rid, int) and rid > max_rowid:
            max_rowid = rid
    if max_rowid:
        update_sync_cursor(db, table_name, max_rowid)
