"""Manages the Hanna pH meter over Bluetooth LE (UART service).

The Hanna HI9810382 exposes a Nordic UART Service. Sending "meas" triggers
a measurement; the response arrives as a CSV notification on the TX
characteristic:  M, status, code, value, pH, value, mV, value, unit

State machine per connection:
  IDLE -> SCANNING -> CONNECTING -> MEASURING -> IDLE
  (on failure) -> ERROR -> IDLE

The pH meter is toggled on/off by events in the DB (event_name='ph_start'
/ 'ph_stop') or by the `enabled` flag set from main.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from bleak import BleakClient, BleakScanner

import config
import db

log = logging.getLogger(__name__)

# ---------- BLE constants ----------

HANNA_TARGET_NAME = config.HANNA_TARGET_NAME
HANNA_UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # Write to this
HANNA_UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # Notifications from this

HANNA_SCAN_CHUNK_SECONDS = 3.0
HANNA_CONNECT_WINDOW_SECONDS = 30.0
HANNA_CONNECT_TIMEOUT = 20.0
HANNA_RECONNECT_DELAY_SECONDS = 5.0
HANNA_MEASURE_EVERY_SECONDS = 60.0
HANNA_STALE_AFTER_SECONDS = 180.0
HANNA_MAX_CONNECT_WINDOWS = 2


# ---------- Packet parsing ----------

def _parse_hanna_line(text: str) -> dict | None:
    """Parse a Hanna CSV measurement line.

    Format: M, status, code, value, pH, value, mV, value, unit
    Returns dict with ph, mv, temp_c, temp_f, status, code, or None.
    """
    text = text.strip()
    if not text:
        return None

    parts = [p.strip() for p in text.split(",")]
    if not parts or parts[0] != "M":
        return None

    out = {
        "raw": text,
        "status": parts[1] if len(parts) > 1 else None,
        "code": parts[2] if len(parts) > 2 else None,
        "ph": None,
        "mv": None,
        "temp_f": None,
        "temp_c": None,
        "temp_unit": None,
    }

    try:
        if len(parts) >= 5 and parts[4] == "pH":
            out["ph"] = float(parts[3])
        if len(parts) >= 7 and parts[6] == "mV":
            out["mv"] = float(parts[5])
        if len(parts) >= 9:
            out["temp_f"] = float(parts[7])
            out["temp_unit"] = parts[8]
            out["temp_c"] = (out["temp_f"] - 32.0) * 5.0 / 9.0
    except Exception:
        pass

    return out


# ---------- Shared state ----------

@dataclass
class _HannaState:
    enabled: bool = False
    connected: bool = False
    status: str = "disabled"
    latest_measurement: dict | None = None
    last_measurement_monotonic: float | None = None


class _HannaBLEManager:
    """Background async BLE manager for the Hanna pH meter."""

    def __init__(self):
        self._state = _HannaState()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread is not None and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run_thread, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def set_enabled(self, enabled: bool):
        with self._lock:
            self._state.enabled = bool(enabled)
            if not self._state.enabled:
                self._state.latest_measurement = None
                self._state.last_measurement_monotonic = None
                self._state.status = "disabled"
        log.info("HANNA: mode %s", "ON" if enabled else "OFF")

    def is_enabled(self) -> bool:
        with self._lock:
            return self._state.enabled

    def get_latest_measurement(self) -> dict | None:
        with self._lock:
            measurement = (
                None if self._state.latest_measurement is None
                else dict(self._state.latest_measurement)
            )
            last = self._state.last_measurement_monotonic

        if measurement is None or last is None:
            return None

        age = time.monotonic() - last
        if age > HANNA_STALE_AFTER_SECONDS:
            return None

        return measurement

    def _set_status(self, *, connected: bool | None = None, status: str | None = None):
        with self._lock:
            if connected is not None:
                self._state.connected = connected
            if status is not None:
                self._state.status = status

    def _set_measurement(self, measurement: dict):
        with self._lock:
            self._state.latest_measurement = dict(measurement)
            self._state.last_measurement_monotonic = time.monotonic()

    def _run_thread(self):
        try:
            asyncio.run(self._run_forever())
        except Exception as e:
            log.error("HANNA thread stopped unexpectedly: %s", e)

    async def _find_device(self, total_timeout: float):
        rounds = max(1, int(total_timeout / HANNA_SCAN_CHUNK_SECONDS))
        self._set_status(status="scanning")
        log.debug("HANNA: scanning for pH meter")

        for _ in range(rounds):
            if self._stop_event.is_set() or not self.is_enabled():
                return None

            devices = await BleakScanner.discover(
                timeout=HANNA_SCAN_CHUNK_SECONDS, return_adv=True
            )
            for _, (device, adv) in devices.items():
                name = device.name or adv.local_name or ""
                if HANNA_TARGET_NAME in name:
                    log.info("HANNA: found %s at %s", name, device.address)
                    return device

        return None

    async def _disconnect_client(self, client: BleakClient | None):
        if client is None:
            return
        try:
            try:
                await client.stop_notify(HANNA_UART_TX)
            except Exception:
                pass
            await asyncio.sleep(0.2)
            if client.is_connected:
                await client.disconnect()
        except Exception:
            pass
        await asyncio.sleep(0.5)

    async def _request_measurement(
        self, client: BleakClient, measurement_event: asyncio.Event
    ) -> bool:
        measurement_event.clear()
        await client.write_gatt_char(HANNA_UART_RX, b"meas", response=False)
        try:
            await asyncio.wait_for(measurement_event.wait(), timeout=10.0)
            return True
        except asyncio.TimeoutError:
            return False

    async def _run_forever(self):
        client: BleakClient | None = None
        measurement_event = asyncio.Event()
        failed_connect_windows = 0

        while not self._stop_event.is_set():
            # Wait while disabled
            if not self.is_enabled():
                failed_connect_windows = 0
                self._set_status(connected=False, status="disabled")
                if client is not None:
                    await self._disconnect_client(client)
                    client = None
                    log.info("HANNA: disconnected (disabled)")
                await asyncio.sleep(1.0)
                continue

            try:
                # Connect if needed
                if client is None or not client.is_connected:
                    device = await self._find_device(HANNA_CONNECT_WINDOW_SECONDS)

                    if device is None:
                        failed_connect_windows += 1

                        if failed_connect_windows < HANNA_MAX_CONNECT_WINDOWS:
                            self._set_status(
                                connected=False, status="not found - try again"
                            )
                            log.warning(
                                "HANNA: no connection within %ds, will try once more",
                                int(HANNA_CONNECT_WINDOW_SECONDS),
                            )
                            await asyncio.sleep(1.0)
                            continue
                        else:
                            # Auto-disable after repeated failures
                            self._set_status(
                                connected=False,
                                status="auto-off after failed connect",
                            )
                            with self._lock:
                                self._state.enabled = False
                                self._state.latest_measurement = None
                                self._state.last_measurement_monotonic = None
                            log.warning(
                                "HANNA: no connection again, turning OFF automatically"
                            )
                            failed_connect_windows = 0
                            await asyncio.sleep(1.0)
                            continue

                    failed_connect_windows = 0
                    self._set_status(
                        connected=False,
                        status=f"connecting to {device.address}",
                    )
                    log.info("HANNA: connecting to %s", device.address)
                    client = BleakClient(device, timeout=HANNA_CONNECT_TIMEOUT)

                    def notification_handler(_sender, data):
                        text = data.decode("utf-8", errors="replace").strip()
                        measurement = _parse_hanna_line(text)
                        if measurement is not None:
                            self._set_measurement(measurement)
                            measurement_event.set()

                    await client.connect()
                    await client.start_notify(HANNA_UART_TX, notification_handler)
                    self._set_status(connected=True, status="connected")
                    log.info("HANNA: connected")

                # Request a measurement
                ok = await self._request_measurement(client, measurement_event)
                if ok:
                    self._set_status(connected=True, status="measuring")
                    m = self.get_latest_measurement()
                    if m is not None:
                        log.info(
                            "HANNA: pH=%s mV=%s T=%s",
                            m.get("ph"), m.get("mv"), m.get("temp_c"),
                        )
                else:
                    raise RuntimeError("timeout waiting for Hanna measurement")

                # Wait before next measurement
                waited = 0.0
                while (
                    waited < HANNA_MEASURE_EVERY_SECONDS
                    and not self._stop_event.is_set()
                    and self.is_enabled()
                ):
                    await asyncio.sleep(1.0)
                    waited += 1.0

            except Exception as e:
                self._set_status(connected=False, status=f"error: {e}")
                log.warning("HANNA: connection/measurement error: %s", e)
                if client is not None:
                    await self._disconnect_client(client)
                    client = None
                if not self._stop_event.is_set() and self.is_enabled():
                    await asyncio.sleep(HANNA_RECONNECT_DELAY_SECONDS)

        # Final cleanup
        if client is not None:
            await self._disconnect_client(client)


# ---------- Module-level manager ----------

_manager: _HannaBLEManager | None = None


def _poll_enable_events(conn, station_id: int):
    """Check the events table for ph_start/ph_stop events to toggle the manager."""
    if _manager is None:
        return

    try:
        row = conn.execute(
            "SELECT event_name FROM events "
            "WHERE station_id = ? AND event_name IN ('ph_start', 'ph_stop') "
            "ORDER BY occurred_at DESC LIMIT 1",
            (station_id,),
        ).fetchone()

        if row is None:
            return

        event_name = row["event_name"]
        should_enable = event_name == "ph_start"
        if should_enable != _manager.is_enabled():
            _manager.set_enabled(should_enable)
    except Exception:
        log.debug("failed to poll ph enable events", exc_info=True)


def run(stop: threading.Event) -> None:
    global _manager

    log.info("hanna_manager thread started")

    conn = db.connect(config.DB_PATH)
    _manager = _HannaBLEManager()
    _manager.start()

    try:
        while not stop.wait(timeout=10.0):
            # Poll events table for ph_start/ph_stop
            _poll_enable_events(conn, config.STATION_ID)

            # If we have a fresh measurement, write it to the DB
            if _manager is not None and _manager.is_enabled():
                m = _manager.get_latest_measurement()
                if m is not None:
                    try:
                        measured_at = datetime.now(timezone.utc).isoformat()
                        db.insert_ph_reading(
                            conn,
                            station_id=config.STATION_ID,
                            hanna_device_id=1,
                            measured_at=measured_at,
                            ph=m.get("ph"),
                            mv=m.get("mv"),
                            temp_c=m.get("temp_c"),
                            status=m.get("status"),
                            hanna_code=m.get("code"),
                        )
                        log.debug("hanna ph_reading inserted @ %s", measured_at)
                    except Exception:
                        log.exception("failed to insert ph_reading")
    finally:
        if _manager is not None:
            _manager.stop()
        _manager = None
        conn.close()
        log.info("hanna_manager thread stopped")
