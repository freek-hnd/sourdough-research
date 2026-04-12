"""Reads Inkbird 4-probe thermometer via BLE on each aligned tick.

Stub: returns 4 None values until the BLE pairing helper is written.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

import config
import db

log = logging.getLogger(__name__)


def _read_probes() -> tuple[float | None, float | None, float | None, float | None]:
    # TODO: BLE read (e.g. via bleak) for IBS-P01B or similar.
    return (None, None, None, None)


def run(conn, stop: threading.Event) -> None:
    log.info("inkbird_reader thread started")
    interval = config.MEASUREMENT_INTERVAL_SEC
    while not stop.is_set():
        now = time.time()
        next_tick = (int(now) // interval + 1) * interval
        while time.time() < next_tick:
            if stop.wait(timeout=min(1.0, next_tick - time.time())):
                log.info("inkbird_reader stopped")
                return
        try:
            p1, p2, p3, p4 = _read_probes()
            if any(v is not None for v in (p1, p2, p3, p4)):
                measured_at = datetime.fromtimestamp(next_tick, tz=timezone.utc).isoformat()
                db.insert_inkbird_reading(conn, measured_at, p1, p2, p3, p4)
        except Exception:
            log.exception("inkbird read failed")
