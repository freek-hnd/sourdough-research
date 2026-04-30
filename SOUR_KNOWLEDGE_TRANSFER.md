# Sourdough research — knowledge transfer

Living notes that need to outlive any individual session. Things that
took an hour to figure out, gotchas that aren't obvious from the code,
and ground truths that the rest of the system relies on.

## Key learnings & principles

- **ToF grid orientation confirmed.** The VL53L5CX 8×8 sensor stores
  its 64 readings in row-major order in `measurements.tof_grid`:
  - row 0 (indices 0–7)   = physical **BACK** of the setup
  - row 7 (indices 56–63) = physical **FRONT** (operator side)
  - col 0 = **LEFT**, col 7 = **RIGHT**

  The data path firmware → MQTT → Pi SQLite → Supabase preserves order
  at every step (verified 2026-04-30):
    - `esp32/src/main.cpp` writes `tofData.distance_mm[i]` straight
      into `tofGrid[i]` and serializes the array in order.
    - `rpi/db.py::insert_measurement` stores it as JSON-encoded text;
      `_row_to_remote` JSON-decodes it back into a list before pushing.
    - Supabase column `tof_grid int[64]` round-trips the list as-is.

  Heatmap labels in the web app are pinned to this mapping (Back at top,
  Front at bottom, Left/Right on the sides) in:
    - `web/src/components/TofHeatmap.tsx` (latest-frame 2D heatmap)
    - `web/src/components/charts/ToFStdDevGrid.tsx` (3D bar chart)
    - `web/src/components/charts/DoughPixelSelection.tsx` (minimap)

  **Don't reorder the array anywhere.** If you ever need to flip
  the visual rendering, change only the labels — the row/col indices
  must stay aligned with the firmware so existing data stays
  interpretable.
