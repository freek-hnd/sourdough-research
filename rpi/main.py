"""Orchestrator: runs MQTT subscriber, local sensor reads, Inkbird, Hanna
state machine, and periodic Supabase sync as daemon threads.

Each worker owns its try/except so one failing sensor never takes down the
service. SIGINT/SIGTERM triggers a graceful shutdown via a single
threading.Event.
"""

from __future__ import annotations

import logging
import signal
import threading
import time

import config
import db
import hanna_manager
import inkbird_reader
import local_sensors
import sync_to_supabase
from mqtt_subscriber import MqttSubscriber

log = logging.getLogger(__name__)


def _sync_loop(stop: threading.Event) -> None:
    log.info("sync_loop started (interval=%ss, enabled=%s)",
             config.SYNC_INTERVAL_SEC, config.sync_enabled())
    while not stop.is_set():
        if config.sync_enabled():
            try:
                results = sync_to_supabase.sync_all()
                log.info("sync ok: %s", results)
            except Exception:
                log.exception("sync failed")
        if stop.wait(timeout=config.SYNC_INTERVAL_SEC):
            break
    log.info("sync_loop stopped")


def _spawn(target, name: str, *args) -> threading.Thread:
    t = threading.Thread(target=target, name=name, args=args, daemon=True)
    t.start()
    return t


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    log.info("sourdough collector starting; db=%s", config.DB_PATH)

    # Init DB schema once from main thread, then close — each worker opens
    # its own connection (SQLite objects can't cross threads).
    init_conn = db.init_db(config.DB_PATH)
    init_conn.close()

    stop = threading.Event()

    mqtt = MqttSubscriber(broker=config.MQTT_BROKER, port=config.MQTT_PORT)
    try:
        mqtt.start()
    except Exception:
        log.exception("MQTT start failed — continuing without it")

    threads = [
        _spawn(local_sensors.run, "local_sensors", stop),
        _spawn(inkbird_reader.run, "inkbird", stop),
        _spawn(hanna_manager.run, "hanna", stop),
        _spawn(_sync_loop, "sync", stop),
    ]

    def _shutdown(signum, _frame):
        log.info("signal %s — shutting down", signum)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        while not stop.is_set():
            time.sleep(1)
    finally:
        stop.set()
        try:
            mqtt.stop()
        except Exception:
            log.exception("MQTT stop failed")
        for t in threads:
            t.join(timeout=5)
        log.info("shutdown complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
