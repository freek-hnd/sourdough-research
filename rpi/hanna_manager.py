"""Manages the Hanna pH meter(s) over Bluetooth.

State machine per device:
  IDLE -> CONNECTING -> MEASURING -> IDLE
  (on failure) -> ERROR -> IDLE

Trigger conditions are set by the web app writing a row to `events` with
event_name='ph_start' / 'ph_stop'. This thread polls those events.
For now this is a stub that idles — to be filled in when the HI98XX SDK
helper is ready.
"""

from __future__ import annotations

import logging
import threading

log = logging.getLogger(__name__)


def run(_conn, stop: threading.Event) -> None:
    log.info("hanna_manager thread started (stub)")
    while not stop.wait(timeout=30.0):
        # TODO: poll events table / BLE scan, manage per-device state.
        pass
    log.info("hanna_manager thread stopped")
