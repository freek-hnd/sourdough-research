"""Runtime configuration for the RPi collector.

All values come from environment variables with sensible defaults so the
service can boot on a fresh Pi without a config file.
"""

from __future__ import annotations

import os

MEASUREMENT_INTERVAL_SEC = int(os.getenv("MEASUREMENT_INTERVAL", "300"))
STATION_ID = int(os.getenv("STATION_ID", "1"))

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SYNC_INTERVAL_SEC = int(os.getenv("SYNC_INTERVAL", "900"))
SYNC_BATCH_SIZE = int(os.getenv("SYNC_BATCH_SIZE", "500"))

DB_PATH = os.getenv("DB_PATH", "/home/pi/sourdough/data/sourdough.db")

# ---------- BLE: Inkbird thermometer ----------
# MAC address or UUID of the Inkbird xBBQ / IBT-4XS / similar
INKBIRD_TARGET_ADDRESS = os.getenv(
    "INKBIRD_TARGET_ADDRESS", "1ABE5072-FEB4-A181-A88C-1323F11A9793"
)
# Advertised names to match (comma-separated in env)
INKBIRD_TARGET_NAMES: set[str] = set(
    os.getenv("INKBIRD_TARGET_NAMES", "xBBQ,PhyRawAdv").split(",")
)

# ---------- BLE: Hanna pH meter ----------
HANNA_TARGET_NAME = os.getenv("HANNA_TARGET_NAME", "HI9810382")


def sync_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)
