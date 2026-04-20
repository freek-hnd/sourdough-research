"""MQTT subscriber: receives ESP32 sensor payloads and writes to local SQLite.

Topics:
  sourdough/station/<id>/measurements  -> stored in `measurements`
  sourdough/station/<id>/status        -> logged as heartbeat event
  sourdough/station/<id>/diag          -> logged as diag_<reason> event,
                                          full JSON stored in notes for
                                          post-mortem debugging of clock /
                                          NTP / network issues.

Payload contract (JSON): station_id (int) and ts (ISO-8601 UTC) are required.
Any of the known sensor keys may be included; unknown keys are ignored.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

import config
import db

log = logging.getLogger(__name__)

TOPIC_MEASUREMENTS = "sourdough/station/+/measurements"
TOPIC_STATUS = "sourdough/station/+/status"
TOPIC_DIAG = "sourdough/station/+/diag"

_KNOWN_SENSOR_KEYS = {
    "tof_median_mm", "tof_min_mm", "tof_max_mm", "tof_grid",
    "co2_ppm", "scd_temp_c", "scd_humidity_pct",
    "ds18b20_temp_c", "ir_surface_temp_c", "load_cell_g",
}


def _normalize_ts(ts: str | int | float) -> str:
    """Accept ISO string or epoch seconds; return ISO-8601 UTC."""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    # Accept "Z" suffix as UTC.
    return ts.replace("Z", "+00:00") if ts.endswith("Z") else ts


class MqttSubscriber:
    def __init__(
        self,
        broker: str = "localhost",
        port: int = 1883,
        client_id: str = "rpi-collector",
    ) -> None:
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._client = mqtt.Client(client_id=client_id, clean_session=True)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._broker = broker
        self._port = port

    # ---- lifecycle ----

    def start(self) -> None:
        self._conn = db.connect(config.DB_PATH)
        log.info("connecting to MQTT %s:%s", self._broker, self._port)
        self._client.connect(self._broker, self._port, keepalive=60)
        self._client.loop_start()

    def stop(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # ---- callbacks ----

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc != 0:
            log.error("MQTT connect failed rc=%s", rc)
            return
        client.subscribe([
            (TOPIC_MEASUREMENTS, 1),
            (TOPIC_STATUS, 1),
            (TOPIC_DIAG, 1),
        ])
        log.info("subscribed: %s, %s, %s",
                 TOPIC_MEASUREMENTS, TOPIC_STATUS, TOPIC_DIAG)

    def _on_message(self, client: mqtt.Client, userdata, msg: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            log.warning("bad payload on %s: %s", msg.topic, e)
            return

        try:
            if msg.topic.endswith("/measurements"):
                self._handle_measurement(payload)
            elif msg.topic.endswith("/status"):
                self._handle_status(payload)
            elif msg.topic.endswith("/diag"):
                self._handle_diag(payload)
        except Exception:  # never crash the loop
            log.exception("handler error on topic %s", msg.topic)

    # ---- handlers ----

    def _handle_measurement(self, p: dict) -> None:
        station_id = p.get("station_id")
        ts = p.get("ts")
        if station_id is None or ts is None:
            log.warning("measurement missing station_id/ts: %s", p)
            return

        sensors = {k: v for k, v in p.items() if k in _KNOWN_SENSOR_KEYS}
        with self._lock:
            db.insert_measurement(
                self._conn, int(station_id), _normalize_ts(ts), **sensors
            )

    def _handle_status(self, p: dict) -> None:
        station_id = p.get("station_id")
        if station_id is None:
            return
        with self._lock:
            db.insert_event(
                self._conn,
                event_name="heartbeat",
                station_id=int(station_id),
                value=p.get("state"),
                notes=p.get("note"),
                occurred_at=_normalize_ts(p["ts"]) if p.get("ts") else None,
            )

    def _handle_diag(self, p: dict) -> None:
        """Store ESP32 diagnostic events in the events table.

        Each diag payload has a `reason` (periodic, time_stuck,
        time_backwards, alignment_wedged, ntp_resync, fallback_triggered,
        wifi_reconnect, mqtt_reconnect, boot, ...). We store the full JSON
        in `notes` so post-mortem analysis can see all clock/network state
        at the moment of the anomaly.
        """
        station_id = p.get("station_id")
        if station_id is None:
            return
        reason = str(p.get("reason", "unknown"))
        event_name = f"diag_{reason}"
        # Derive an occurred_at. Use the ESP32's time_t if it looks valid;
        # otherwise fall back to "now" on the Pi. That way diag events are
        # still timestamped sanely even when the ESP32's clock is broken.
        esp_time_t = p.get("time_t")
        if isinstance(esp_time_t, (int, float)) and esp_time_t > 1704067200:
            occurred_at = _normalize_ts(esp_time_t)
        else:
            occurred_at = datetime.now(timezone.utc).isoformat()
        notes = json.dumps(p, separators=(",", ":"))
        with self._lock:
            db.insert_event(
                self._conn,
                event_name=event_name,
                station_id=int(station_id),
                value=str(p.get("seq", "")),
                notes=notes,
                occurred_at=occurred_at,
            )
        # Also log anomalies (not plain "periodic") so they show up in
        # journalctl when watching live.
        if reason != "periodic":
            log.warning("station %s diag: %s (seq=%s, time=%s, lastMeas=%s)",
                        station_id, reason, p.get("seq"),
                        p.get("time_t"), p.get("lastMeasurementEpoch"))
