-- Calibration seed data — run AFTER supabase/migrations/003_calibration_storage.sql.
--
-- The integer / real arrays below are placeholders. Generate the real
-- numbers by running:
--
--   python calibration/build_seed_calibration.py \
--       --station-2 calibration/data/NEW_calibration_station_2.jsonl \
--       --station-3 calibration/data/NEW_calibration_station_3.jsonl \
--       > calibration/seed_calibration.sql
--
-- The script fits the per-pixel Theil-Sen linear model for station 2,
-- captures the single-height baseline grid for station 3, computes the
-- 55x55mm jar's effective area from station 3's inner-6×6 fit (RMS
-- 0.481 mm, area = 26.1 cm²), and emits a fresh version of THIS file.
--
-- The placeholders below are valid SQL, just not useful calibration —
-- they let the schema / RLS / FK constraints apply cleanly while you
-- generate the real values.

-- ── Jar ───────────────────────────────────────────────────────────────────
INSERT INTO jars (id, name, type, cross_section_area_cm2, calibration_notes)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '55x55mm rounded glass jar',
  '55x55mm_rounded_glass',
  26.1,
  'Effective area from station 3 inner-6×6 fit (RMS 0.481 mm). Same jar used across stations.'
)
ON CONFLICT (id) DO UPDATE SET
  name                   = EXCLUDED.name,
  type                   = EXCLUDED.type,
  cross_section_area_cm2 = EXCLUDED.cross_section_area_cm2,
  calibration_notes      = EXCLUDED.calibration_notes;

-- ── Station 2 — multi-height linear model ────────────────────────────────
-- Replace pixel_slope and pixel_intercept with the real arrays from the
-- Theil-Sen fit. wall_pixel_mask: 1 = wall (slope flatter than -0.3).
UPDATE stations
   SET wall_pixel_mask    = ARRAY[
         /* row 0 */ 1,1,1,1,1,1,1,1,
         /* row 1 */ 1,1,1,1,1,1,1,1,
         /* row 2 */ 0,0,0,0,0,0,0,1,
         /* row 3 */ 0,0,0,0,0,0,0,1,
         /* row 4 */ 0,0,0,0,0,0,0,1,
         /* row 5 */ 0,0,0,0,0,0,0,1,
         /* row 6 */ 0,0,0,0,0,0,0,1,
         /* row 7 */ 0,0,0,0,0,0,0,1
       ]::integer[],
       pixel_slope        = NULL,                      -- TODO: 64 reals from build_seed_calibration.py
       pixel_intercept    = NULL,                      -- TODO: 64 reals from build_seed_calibration.py
       baseline_grid      = NULL,
       baseline_height_mm = NULL,
       calibration_notes  = 'PLACEHOLDER — run build_seed_calibration.py to fill in slopes/intercepts.'
 WHERE id = 2;

-- ── Station 3 — single-height baseline ────────────────────────────────────
UPDATE stations
   SET wall_pixel_mask    = ARRAY[
         /* row 0 */ 1,0,0,0,0,0,0,1,
         /* row 1 */ 1,0,0,0,0,0,0,0,
         /* row 2 */ 1,0,0,0,0,0,0,0,
         /* row 3 */ 1,0,0,0,0,0,0,0,
         /* row 4 */ 1,0,0,0,0,0,0,0,
         /* row 5 */ 1,0,0,0,0,0,0,0,
         /* row 6 */ 1,0,0,0,0,0,0,0,
         /* row 7 */ 1,0,0,0,0,0,0,1
       ]::integer[],
       pixel_slope        = NULL,
       pixel_intercept    = NULL,
       baseline_grid      = NULL,                      -- TODO: 64 reals (median of flat snapshots @ h=152)
       baseline_height_mm = 152,
       calibration_notes  = 'PLACEHOLDER — run build_seed_calibration.py to fill in baseline_grid.'
 WHERE id = 3;
