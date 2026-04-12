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


def sync_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)
