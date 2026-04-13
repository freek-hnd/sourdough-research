"""Reads station #1 (RPi) own sensors at NTP-aligned intervals.

Hardware:
  - SCD41 CO2/temp/humidity via I2C (/dev/i2c-1)
  - VL53L5CX 8x8 ToF distance sensor via I2C
  - DS18B20 1-Wire probe (optional, reads if present)

IMPORTANT: init_sensors() MUST be called from the main thread. The
VL53L5CX ctypes driver segfaults if initialized from a spawned thread.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from statistics import median

import config
import db

log = logging.getLogger(__name__)

# ---------- Sensor constants ----------

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


# ---------- Sensor initialization (MUST run in main thread) ----------

def init_sensors() -> dict:
    """Initialize all I2C sensors. Call from the MAIN thread only.

    Returns a dict with 'i2c', 'scd41', 'tof' keys (any may be None on
    failure). Matches the exact init order from the proven old logger:
    1. I2C bus (busio.I2C) — required by VL53L5CX ctypes
    2. SCD41 (stop + sleep + start periodic measurement)
    3. VL53L5CX (only after I2C bus and SCD41 are ready)
    """
    sensors: dict = {"i2c": None, "scd41": None, "tof": None}

    # 1. I2C bus — must be first
    try:
        import board
        import busio
        sensors["i2c"] = busio.I2C(board.SCL, board.SDA)
        log.info("I2C bus initialized")
    except Exception:
        log.exception("I2C bus init failed — ToF will not work")

    # 2. SCD41
    try:
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
        sensors["scd41"] = scd41
        log.info("SCD41 initialized and measuring")
    except Exception:
        log.exception("SCD41 init failed")

    # 3. VL53L5CX — only if I2C bus succeeded
    if sensors["i2c"] is not None:
        try:
            import vl53l5cx_ctypes
            tof = vl53l5cx_ctypes.VL53L5CX()
            tof.set_resolution(vl53l5cx_ctypes.RESOLUTION_8X8)
            tof.set_ranging_frequency_hz(TOF_FREQUENCY_HZ)
            tof.start_ranging()
            sensors["tof"] = tof
            log.info("VL53L5CX initialized and ranging")
        except Exception:
            log.exception("VL53L5CX init failed")
    else:
        log.warning("Skipping VL53L5CX init — I2C bus not available")

    return sensors


# ---------- Sensor read helpers ----------

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


# ---------- Main loop (runs in spawned thread) ----------

def run(sensors: dict, stop: threading.Event) -> None:
    log.info("local_sensors thread started (interval=%ss)", config.MEASUREMENT_INTERVAL_SEC)

    conn = db.connect(config.DB_PATH)

    scd41 = sensors.get("scd41")
    tof = sensors.get("tof")

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
                data.update(_read_scd41(scd41))

            # ToF
            if tof is not None:
                data.update(_read_tof(tof))

            # DS18B20 (optional)
            data.update(_read_ds18b20())

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
