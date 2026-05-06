#!/usr/bin/env python3
"""
build_seed_calibration.py — emit calibration seed SQL from raw flat
snapshot JSONL files.

Reads station calibration JSONLs, fits / extracts the per-pixel model,
and writes seed_calibration.sql that the Supabase project can run after
migration 003.

  python calibration/build_seed_calibration.py \
      --station-2 calibration/data/NEW_calibration_station_2.jsonl \
      --station-3 calibration/data/NEW_calibration_station_3.jsonl \
      --jar-area-cm2 26.1 \
      > calibration/seed_calibration.sql

Algorithms match calibration/model_baseline_2.py:
  - Theil-Sen per-pixel linear fit (multi-height, station 2)
  - Single-height median grid baseline (station 3)
  - wall_pixel_mask = 1 where slope > wall_slope_thresh (default -0.3)

Outputs valid SQL that's idempotent (UPDATE … WHERE id = 2|3 + UPSERT
on the jars row), so re-running the migration + seed is safe.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

VALID_MIN_MM = 50
VALID_MAX_MM = 400
WALL_SLOPE_THRESH = -0.3


# ── Data loading ────────────────────────────────────────────────────────────

def _load(path: Path) -> list[dict]:
    """Return list of snapshot dicts with px (8x8 list), h, type."""
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue

            grids = s.get("grids", [])
            if grids:
                # Multiple grids per snapshot — take the median per pixel.
                stacks = [[v if VALID_MIN_MM <= v <= VALID_MAX_MM else None
                           for v in g] for g in grids]
                px = []
                for i in range(64):
                    vals = [stk[i] for stk in stacks if stk[i] is not None]
                    px.append(_median(vals) if vals else None)
            else:
                avg = s.get("avg_grid", [None] * 64)
                px = [v if (v is not None and VALID_MIN_MM <= v <= VALID_MAX_MM)
                      else None for v in avg]

            flags = str(s.get("flags", "")).lower()
            t = "flat" if "flat" in flags else "jar" if "jar" in flags else "?"
            out.append({"px": px, "h": float(s.get("h", 0)),
                        "v": float(s.get("v", 0)), "type": t})
    return out


def _median(xs: Iterable[float]) -> float:
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return float("nan")
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


# ── Theil-Sen per-pixel linear fit ──────────────────────────────────────────

def _theil_sen(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Slope = median pairwise slope, intercept = median(y - slope*x)."""
    if len(xs) < 3:
        return (float("nan"), float("nan"))
    slopes = []
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            dx = xs[j] - xs[i]
            if dx != 0:
                slopes.append((ys[j] - ys[i]) / dx)
    if not slopes:
        return (float("nan"), float("nan"))
    slope = _median(slopes)
    intercept = _median([y - slope * x for x, y in zip(xs, ys)])
    return slope, intercept


def fit_station2(snaps: list[dict]) -> tuple[list[float], list[float], list[int]]:
    """Per-pixel slope, intercept, wall_mask (64 each)."""
    flats = [s for s in snaps if s["type"] == "flat"]
    slope, intercept, wall = [0.0] * 64, [0.0] * 64, [0] * 64

    for px in range(64):
        xs, ys = [], []
        for s in flats:
            v = s["px"][px]
            if v is not None:
                xs.append(s["h"])
                ys.append(v)
        sl, ic = _theil_sen(xs, ys)
        if sl != sl:  # NaN
            slope[px] = 0.0
            intercept[px] = 0.0
            wall[px] = 1
        else:
            slope[px] = sl
            intercept[px] = ic
            wall[px] = 1 if sl > WALL_SLOPE_THRESH else 0

    return slope, intercept, wall


def baseline_station3(snaps: list[dict]) -> tuple[list[float | None], float, list[int]]:
    """Pick the most populated (h) bucket as the calibration height; return
       per-pixel median across those flat snaps, the height, and a wall
       mask derived from pixels with no valid reading at that height."""
    flats = [s for s in snaps if s["type"] == "flat"]
    by_h: dict[float, list[dict]] = defaultdict(list)
    for s in flats:
        by_h[s["h"]].append(s)
    if not by_h:
        return [None] * 64, 0.0, [1] * 64
    # Pick the height with the most snapshots; fall back to lowest h.
    cal_h = max(by_h.keys(), key=lambda h: (len(by_h[h]), -h))
    bucket = by_h[cal_h]

    grid: list[float | None] = [None] * 64
    for px in range(64):
        vals = [s["px"][px] for s in bucket if s["px"][px] is not None]
        grid[px] = _median(vals) if vals else None
    wall = [1 if grid[i] is None else 0 for i in range(64)]
    return grid, float(cal_h), wall


# ── SQL emission ────────────────────────────────────────────────────────────

def _fmt_int_array(xs: list[int]) -> str:
    return "ARRAY[" + ",".join(str(v) for v in xs) + "]::integer[]"


def _fmt_real_array(xs: list[float | None]) -> str:
    parts = []
    for v in xs:
        if v is None or v != v:  # None or NaN
            parts.append("NULL")
        else:
            parts.append(f"{v:.4f}")
    return "ARRAY[" + ",".join(parts) + "]::real[]"


def emit_sql(
    s2_slopes: list[float] | None,
    s2_intercepts: list[float] | None,
    s2_wall: list[int] | None,
    s3_baseline: list[float | None] | None,
    s3_height: float | None,
    s3_wall: list[int] | None,
    jar_area_cm2: float,
) -> str:
    out = []
    out.append("-- Generated by calibration/build_seed_calibration.py")
    out.append("-- Run AFTER supabase/migrations/003_calibration_storage.sql.\n")

    out.append("INSERT INTO jars (id, name, type, cross_section_area_cm2, calibration_notes)")
    out.append("VALUES (")
    out.append("  '11111111-1111-1111-1111-111111111111',")
    out.append("  '55x55mm rounded glass jar',")
    out.append("  '55x55mm_rounded_glass',")
    out.append(f"  {jar_area_cm2},")
    out.append("  'Effective area from station 3 inner-6x6 fit (RMS 0.481 mm).'")
    out.append(")")
    out.append("ON CONFLICT (id) DO UPDATE SET")
    out.append("  name                   = EXCLUDED.name,")
    out.append("  type                   = EXCLUDED.type,")
    out.append("  cross_section_area_cm2 = EXCLUDED.cross_section_area_cm2,")
    out.append("  calibration_notes      = EXCLUDED.calibration_notes;\n")

    if s2_slopes is not None:
        out.append("-- Station 2: multi-height Theil-Sen linear model")
        out.append("UPDATE stations SET")
        out.append(f"  wall_pixel_mask    = {_fmt_int_array(s2_wall or [0]*64)},")
        out.append(f"  pixel_slope        = {_fmt_real_array(s2_slopes)},")
        out.append(f"  pixel_intercept    = {_fmt_real_array(s2_intercepts or [None]*64)},")
        out.append("  baseline_grid      = NULL,")
        out.append("  baseline_height_mm = NULL,")
        out.append("  calibration_notes  = 'Theil-Sen per-pixel fit, wall slope > -0.3'")
        out.append("WHERE id = 2;\n")

    if s3_baseline is not None and s3_height is not None:
        out.append("-- Station 3: single-height baseline grid")
        out.append("UPDATE stations SET")
        out.append(f"  wall_pixel_mask    = {_fmt_int_array(s3_wall or [0]*64)},")
        out.append("  pixel_slope        = NULL,")
        out.append("  pixel_intercept    = NULL,")
        out.append(f"  baseline_grid      = {_fmt_real_array(s3_baseline)},")
        out.append(f"  baseline_height_mm = {s3_height:.1f},")
        out.append(f"  calibration_notes  = 'Single-height calibration at h={s3_height:.0f}mm'")
        out.append("WHERE id = 3;\n")

    return "\n".join(out)


# ── CLI ─────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--station-2", type=Path,
                   help="JSONL with multi-height flat snapshots for station 2")
    p.add_argument("--station-3", type=Path,
                   help="JSONL with flat snapshots for station 3 (single height)")
    p.add_argument("--jar-area-cm2", type=float, default=26.1,
                   help="Cross-section area of the 55x55 jar in cm² (default 26.1)")
    args = p.parse_args()

    s2_slopes = s2_intercepts = s2_wall = None
    s3_baseline = s3_height = s3_wall = None

    if args.station_2:
        snaps = _load(args.station_2)
        print(f"-- Station 2: loaded {len(snaps)} snapshots from {args.station_2}",
              file=sys.stderr)
        s2_slopes, s2_intercepts, s2_wall = fit_station2(snaps)

    if args.station_3:
        snaps = _load(args.station_3)
        print(f"-- Station 3: loaded {len(snaps)} snapshots from {args.station_3}",
              file=sys.stderr)
        s3_baseline, s3_height, s3_wall = baseline_station3(snaps)

    print(emit_sql(
        s2_slopes, s2_intercepts, s2_wall,
        s3_baseline, s3_height, s3_wall,
        args.jar_area_cm2,
    ))


if __name__ == "__main__":
    main()
