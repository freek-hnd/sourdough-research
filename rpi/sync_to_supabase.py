"""Batch sync local SQLite rows to Supabase via the REST API.

Cursor-based: each synced table keeps a `last_synced_id` in `sync_log`. On
each run we pull the next batch > cursor, POST to `/rest/v1/<table>` with
`Prefer: resolution=merge-duplicates`, and advance the cursor only on HTTP
success. Failures are logged and retried next cycle.

Uses `requests` directly — supabase-py is too heavy for a Pi Zero.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Any

import requests

import config
import db

log = logging.getLogger(__name__)

_TIMEOUT = 30.0


def _headers() -> dict[str, str]:
    return {
        "apikey": config.SUPABASE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _post_rows(table: str, rows: list[dict[str, Any]]) -> None:
    url = f"{config.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
    resp = requests.post(url, json=rows, headers=_headers(), timeout=_TIMEOUT)
    resp.raise_for_status()


def sync_table(conn: sqlite3.Connection, table: str, batch_size: int) -> int:
    """Sync one batch for a table. Returns number of rows synced."""
    local_rows = db.fetch_unsynced_local(conn, table, batch_size)
    if not local_rows:
        return 0

    remote_rows = [
        db._row_to_remote(table, {k: v for k, v in r.items() if k != "_rowid"})
        for r in local_rows
    ]
    _post_rows(table, remote_rows)
    db.mark_synced_by_local_id(conn, table, local_rows)
    return len(local_rows)


def sync_all(conn: sqlite3.Connection) -> dict[str, int]:
    """Sync every registered table once. Logs per-table failures, never raises."""
    if not config.sync_enabled():
        log.info("sync disabled (SUPABASE_URL/KEY not set)")
        return {}

    results: dict[str, int] = {}
    for table in db.SYNC_TABLES:
        try:
            n = sync_table(conn, table, config.SYNC_BATCH_SIZE)
            results[table] = n
            if n:
                log.info("synced %d rows -> %s", n, table)
        except requests.HTTPError as e:
            log.error("sync %s HTTP %s: %s", table, e.response.status_code, e.response.text[:300])
        except requests.RequestException as e:
            log.error("sync %s network error: %s", table, e)
        except Exception:
            log.exception("sync %s unexpected error", table)
    return results
