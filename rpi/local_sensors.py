"""Reads station #1 (RPi) own sensors at NTP-aligned intervals.

Hardware wiring is not yet fixed — this is a stub that logs each aligned
tick and inserts a row with only the timestamp. Replace the `_read()` body
once the SCD41/DS18B20/HX711/ToF boards are connected.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

import config
import db

log = logging.getLogger(__name__)


def _wait_until_next_aligned(interval: int, stop: threading.Event) -> float | None:
    now = time.time()
    next_tick = (int(now) // interval + 1) * interval
    while time.time() < next_tick:
        if stop.wait(timeout=min(1.0, next_tick - time.time())):
            return None
    return next_tick


def _read() -> dict[str, float | None]:
    # TODO: real sensor reads. Returns dict of measurement columns.
    return {}


def run(conn, stop: threading.Event) -> None:
    log.info("local_sensors thread started (interval=%ss)", config.MEASUREMENT_INTERVAL_SEC)
    while not stop.is_set():
        tick = _wait_until_next_aligned(config.MEASUREMENT_INTERVAL_SEC, stop)
        if tick is None:
            break
        try:
            measured_at = datetime.fromtimestamp(tick, tz=timezone.utc).isoformat()
            data = _read()
            db.insert_measurement(conn, station_id=config.STATION_ID, measured_at=measured_at, **data)
            log.debug("local_sensors measurement @ %s", measured_at)
        except Exception:
            log.exception("local_sensors read failed")
    log.info("local_sensors thread stopped")
