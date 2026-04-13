"""Reads Inkbird 4-probe thermometer via BLE (persistent connection).

Runs an async BLE manager in a background thread that maintains a persistent
connection to the Inkbird xBBQ thermometer. The main tick-aligned loop reads
the latest cached temperatures on each interval.

BLE protocol: pair via FFF2, enable realtime via FFF5, receive temp packets
on FFF4 notifications.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from bleak import BleakClient, BleakScanner

import config
import db

log = logging.getLogger(__name__)

# ---------- BLE protocol constants ----------

# Device identification — match by address or name
INKBIRD_TARGET_ADDRESS = config.INKBIRD_TARGET_ADDRESS
INKBIRD_TARGET_NAMES = config.INKBIRD_TARGET_NAMES

# GATT characteristic UUIDs
UUID_FFF1 = "0000fff1-0000-1000-8000-00805f9b34fb"
UUID_FFF2 = "0000fff2-0000-1000-8000-00805f9b34fb"
UUID_FFF3 = "0000fff3-0000-1000-8000-00805f9b34fb"
UUID_FFF4 = "0000fff4-0000-1000-8000-00805f9b34fb"
UUID_FFF5 = "0000fff5-0000-1000-8000-00805f9b34fb"

# Pairing and control commands
PAIRING_KEY = bytes([0x21, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
                     0xB8, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00])
ENABLE_REALTIME = bytes([0x0B, 0x01, 0x00, 0x00, 0x00, 0x00])
SET_CELSIUS = bytes([0x02, 0x00, 0x00, 0x00, 0x00, 0x00])

# Timing constants
BLE_SCAN_TIMEOUT = 15.0
BLE_CONNECT_TIMEOUT = 35.0
BLE_LIVE_PACKET_TIMEOUT = 45.0
BLE_RECONNECT_DELAY_SECONDS = 10.0
BLE_STALE_AFTER_SECONDS = 90.0


# ---------- Packet decoding ----------

def _decode_temp_packet(data: bytearray) -> list[float | None] | None:
    """Decode a 4-probe temperature packet from Inkbird FFF4 notifications."""
    if len(data) < 8:
        return None

    probes: list[float | None] = []
    for i in range(0, 8, 2):
        raw = int.from_bytes(data[i:i + 2], byteorder="little", signed=False)
        if raw == 0xFFFF or raw >= 60000:
            probes.append(None)
        else:
            probes.append(raw / 10.0)
    return probes


# ---------- Shared state ----------

@dataclass
class _BLEState:
    latest_temps: list[float | None] = field(
        default_factory=lambda: [None, None, None, None]
    )
    last_packet_monotonic: float | None = None
    connected: bool = False
    status: str = "not started"


class _InkbirdBLEManager:
    """Background async BLE manager that maintains a persistent connection."""

    def __init__(self):
        self._state = _BLEState()
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

    def get_latest_temps(self) -> list[float | None]:
        with self._lock:
            temps = list(self._state.latest_temps)
            last_packet = self._state.last_packet_monotonic

        if last_packet is None:
            return [None, None, None, None]

        age = time.monotonic() - last_packet
        if age > BLE_STALE_AFTER_SECONDS:
            return [None, None, None, None]

        return temps

    def _set_status(self, *, connected: bool | None = None, status: str | None = None):
        with self._lock:
            if connected is not None:
                self._state.connected = connected
            if status is not None:
                self._state.status = status

    def _set_temps(self, temps: list[float | None]):
        with self._lock:
            self._state.latest_temps = list(temps)
            self._state.last_packet_monotonic = time.monotonic()

    def _run_thread(self):
        try:
            asyncio.run(self._run_forever())
        except Exception as e:
            log.error("BLE thread stopped unexpectedly: %s", e)

    async def _find_device(self):
        self._set_status(status="scanning")
        log.debug("BLE: scanning for Inkbird thermometer")
        devices = await BleakScanner.discover(timeout=BLE_SCAN_TIMEOUT)

        for d in devices:
            name = d.name or ""
            if d.address == INKBIRD_TARGET_ADDRESS or name in INKBIRD_TARGET_NAMES:
                return d
        return None

    async def _run_forever(self):
        while not self._stop_event.is_set():
            client = None
            live_packet_event = asyncio.Event()

            try:
                device = await self._find_device()
                if device is None:
                    self._set_status(connected=False, status="not found")
                    log.debug("BLE: Inkbird not found, retrying in %ss", BLE_RECONNECT_DELAY_SECONDS)
                    await asyncio.sleep(BLE_RECONNECT_DELAY_SECONDS)
                    continue

                self._set_status(connected=False, status=f"connecting to {device.address}")
                log.info("BLE: connecting to %s", device.address)
                client = BleakClient(device, timeout=BLE_CONNECT_TIMEOUT)

                def notification_handler(sender, data):
                    sender_str = str(sender)
                    if UUID_FFF4 in sender_str:
                        temps = _decode_temp_packet(data)
                        if temps is not None:
                            self._set_temps(temps)
                            live_packet_event.set()

                await client.connect()
                self._set_status(connected=True, status="connected, subscribing")
                log.info("BLE: connected to Inkbird")

                await client.start_notify(UUID_FFF1, notification_handler)
                await client.start_notify(UUID_FFF3, notification_handler)
                await client.start_notify(UUID_FFF4, notification_handler)

                await asyncio.sleep(1.0)
                await client.write_gatt_char(UUID_FFF2, PAIRING_KEY, response=False)
                await asyncio.sleep(0.5)
                await client.write_gatt_char(UUID_FFF5, ENABLE_REALTIME, response=False)
                await asyncio.sleep(0.5)
                await client.write_gatt_char(UUID_FFF5, SET_CELSIUS, response=False)

                self._set_status(connected=True, status="waiting for live packets")

                await asyncio.wait_for(
                    live_packet_event.wait(), timeout=BLE_LIVE_PACKET_TIMEOUT
                )
                self._set_status(connected=True, status="streaming live packets")
                log.info("BLE: live stream detected")

                # Stay connected, monitoring for staleness
                while client.is_connected and not self._stop_event.is_set():
                    await asyncio.sleep(5.0)
                    with self._lock:
                        last_packet = self._state.last_packet_monotonic
                    if last_packet is not None:
                        age = time.monotonic() - last_packet
                        if age > BLE_STALE_AFTER_SECONDS:
                            raise RuntimeError(f"no live BLE packet for {age:.1f}s")

            except asyncio.TimeoutError:
                self._set_status(connected=False, status="timeout")
                log.warning("BLE: timeout waiting for Inkbird connection/data")
            except Exception as e:
                self._set_status(connected=False, status=f"error: {e}")
                log.warning("BLE: Inkbird connection error: %s", e)
            finally:
                self._set_status(connected=False)
                if client is not None:
                    for uuid in [UUID_FFF4, UUID_FFF3, UUID_FFF1]:
                        try:
                            await client.stop_notify(uuid)
                        except Exception:
                            pass
                    await asyncio.sleep(1.0)
                    try:
                        await client.disconnect()
                    except Exception:
                        pass
                    await asyncio.sleep(2.0)

            if not self._stop_event.is_set():
                await asyncio.sleep(BLE_RECONNECT_DELAY_SECONDS)


# ---------- Module-level manager ----------

_manager: _InkbirdBLEManager | None = None


def _read_probes() -> tuple[float | None, float | None, float | None, float | None]:
    """Read the latest cached temperatures from the BLE manager."""
    if _manager is None:
        return (None, None, None, None)
    temps = _manager.get_latest_temps()
    return (temps[0], temps[1], temps[2], temps[3])


def run(stop: threading.Event) -> None:
    global _manager

    log.info("inkbird_reader thread started")

    conn = db.connect(config.DB_PATH)
    _manager = _InkbirdBLEManager()
    _manager.start()

    interval = config.MEASUREMENT_INTERVAL_SEC

    try:
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
                    measured_at = datetime.fromtimestamp(
                        next_tick, tz=timezone.utc
                    ).isoformat()
                    db.insert_inkbird_reading(conn, measured_at, p1, p2, p3, p4)
                    log.info(
                        "inkbird @ %s  P1=%s P2=%s P3=%s P4=%s",
                        measured_at, p1, p2, p3, p4,
                    )
            except Exception:
                log.exception("inkbird read failed")
    finally:
        _manager.stop()
        _manager = None
        conn.close()
        log.info("inkbird_reader thread stopped")
