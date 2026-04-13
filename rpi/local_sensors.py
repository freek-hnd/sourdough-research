"""Reads station #1 (RPi) own sensors at NTP-aligned intervals.

Hardware:
  - SCD41 CO2/temp/humidity via I2C (/dev/i2c-1)
  - VL53L5CX 8x8 ToF distance sensor via I2C
  - DS18B20 1-Wire probe (optional, reads if present)
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from statistics import median

import config
import db

log = logging.getLogger(__name__)

# ---------- Sensor constants ----------

TOF_RESOLUTION_8X8 = 64  # vl53l5cx_ctypes.RESOLUTION_8X8
TOF_FREQUENCY_HZ = 1
STARTUP_WARMUP_SECONDS = 10
FIRST_RETRY_SECONDS = 10


def _wait_until_next_aligned(interval: int, stop: threading.Event) -> float | None:
    now = time.time()
    next_tick = (int(now) // interval + 1) * interval
    while time.time() < next_tick:
        if stop.wait(timeout=min(1.0, next_tick - time.time())):
            return None
    return next_tick


def _init_scd41():
    """Initialize the SCD41 CO2/temp/humidity sensor over I2C."""
    from sensirion_i2c_driver import I2cConnection
    from sensirion_i2c_driver.linux_i2c_transceiver import LinuxI2cTransceiver
    from sensirion_i2c_scd.scd4x.device import Scd4xI2cDevice

    connection = I2cConnection(LinuxI2cTransceiver("/dev/i2c-1"))
    scd41 = Scd4xI2cDevice(connection)

    try:
        scd41.stop_periodic_measurement()
        time.sleep(1)
    except Exception:
        pass

    scd41.start_periodic_measurement()
    log.info("SCD41 initialized and measuring")
    return scd41


def _init_tof():
    """Initialize the VL53L5CX 8x8 Time-of-Flight sensor."""
    import vl53l5cx_ctypes

    tof = vl53l5cx_ctypes.VL53L5CX()
    tof.set_resolution(vl53l5cx_ctypes.RESOLUTION_8X8)
    tof.set_ranging_frequency_hz(TOF_FREQUENCY_HZ)
    tof.start_ranging()
    log.info("VL53L5CX initialized and ranging")
    return tof


def _read_scd41(scd41) -> dict[str, float | None]:
    """Read CO2, temperature, humidity from SCD41."""
    try:
        co2, temperature, humidity = scd41.read_measurement()
        return {
            "co2_ppm": int(co2.co2),
            "scd_temp_c": round(float(temperature.degrees_celsius), 2),
            "scd_humidity_pct": round(float(humidity.percent_rh), 2),
        }
    except Exception as e:
        log.warning("SCD41 read failed: %s", e)
        return {"co2_ppm": None, "scd_temp_c": None, "scd_humidity_pct": None}


def _read_tof(tof) -> dict[str, float | int | list | None]:
    """Read the 8x8 ToF distance grid and compute summary stats."""
    try:
        if not tof.data_ready():
            log.debug("ToF data not ready")
            return {
                "tof_median_mm": None, "tof_min_mm": None,
                "tof_max_mm": None, "tof_grid": None,
            }

        data = tof.get_data()
        distances = list(data.distance_mm[0])
        valid = [d for d in distances if d is not None and d > 0]

        if not valid:
            log.debug("ToF returned no valid (>0) distances")
            return {
                "tof_median_mm": None, "tof_min_mm": None,
                "tof_max_mm": None, "tof_grid": distances,
            }

        return {
            "tof_median_mm": median(valid),
            "tof_min_mm": min(valid),
            "tof_max_mm": max(valid),
            "tof_grid": distances,
        }
    except Exception as e:
        log.warning("ToF read failed: %s", e)
        return {
            "tof_median_mm": None, "tof_min_mm": None,
            "tof_max_mm": None, "tof_grid": None,
        }


def _read_ds18b20() -> dict[str, float | None]:
    """Read DS18B20 1-Wire temperature probe if available."""
    import glob
    try:
        devices = glob.glob("/sys/bus/w1/devices/28-*/w1_slave")
        if not devices:
            return {"ds18b20_temp_c": None}

        with open(devices[0], "r") as f:
            lines = f.readlines()

        if len(lines) < 2 or "YES" not in lines[0]:
            return {"ds18b20_temp_c": None}

        pos = lines[1].find("t=")
        if pos == -1:
            return {"ds18b20_temp_c": None}

        temp_c = float(lines[1][pos + 2:]) / 1000.0
        return {"ds18b20_temp_c": round(temp_c, 2)}
    except Exception as e:
        log.debug("DS18B20 read failed (may not be connected): %s", e)
        return {"ds18b20_temp_c": None}


def run(stop: threading.Event) -> None:
    log.info("local_sensors thread started (interval=%ss)", config.MEASUREMENT_INTERVAL_SEC)

    conn = db.connect(config.DB_PATH)

    # Initialize sensors
    scd41 = None
    tof = None

    try:
        scd41 = _init_scd41()
    except Exception:
        log.exception("SCD41 init failed — will retry reads but expect None values")

    try:
        tof = _init_tof()
    except Exception:
        log.exception("VL53L5CX init failed — will retry reads but expect None values")

    # Warm-up period
    log.info("Warming up sensors for %ds...", STARTUP_WARMUP_SECONDS)
    if stop.wait(timeout=STARTUP_WARMUP_SECONDS):
        return

    first_successful = False

    while not stop.is_set():
        interval = config.MEASUREMENT_INTERVAL_SEC if first_successful else FIRST_RETRY_SECONDS
        tick = _wait_until_next_aligned(interval, stop)
        if tick is None:
            break
        try:
            measured_at = datetime.fromtimestamp(tick, tz=timezone.utc).isoformat()

            data: dict[str, float | int | list | None] = {}

            # SCD41
            if scd41 is not None:
                scd_data = _read_scd41(scd41)
                data.update(scd_data)

            # ToF
            if tof is not None:
                tof_data = _read_tof(tof)
                data.update(tof_data)

            # DS18B20 (optional)
            ds_data = _read_ds18b20()
            data.update(ds_data)

            db.insert_measurement(conn, station_id=config.STATION_ID, measured_at=measured_at, **data)

            scd_ok = data.get("co2_ppm") is not None
            tof_ok = data.get("tof_median_mm") is not None
            if scd_ok and tof_ok:
                first_successful = True

            log.info(
                "measurement @ %s  CO2=%s  T=%s  RH=%s  ToF=%s  DS=%s",
                measured_at,
                data.get("co2_ppm"),
                data.get("scd_temp_c"),
                data.get("scd_humidity_pct"),
                data.get("tof_median_mm"),
                data.get("ds18b20_temp_c"),
            )
        except Exception:
            log.exception("local_sensors read failed")

    # Cleanup
    log.info("local_sensors shutting down...")
    if scd41 is not None:
        try:
            scd41.stop_periodic_measurement()
        except Exception:
            pass
    if tof is not None:
        try:
            tof.stop_ranging()
        except Exception:
            pass

    conn.close()
    log.info("local_sensors thread stopped")
