-- Calibration storage for ToF volume estimation.
--
-- Three orthogonal pieces:
--   stations  — sensor geometry (where the sensor is, what it sees empty)
--   jars      — container geometry (cross-section area)
--   sessions  — physical setup (which jar, setup height, pixel subset)
--
-- Volume itself is NOT stored — it's computed at render time from the
-- raw tof_grid using web/src/lib/volumeCalculation.ts. That keeps the
-- measurements table immutable and lets calibration improvements take
-- effect retroactively without re-processing historical data.

-- ── jars ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jars (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  type                    text,
  cross_section_area_cm2  real,
  calibration_notes       text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jars_anon_read"          ON jars;
DROP POLICY IF EXISTS "jars_authenticated_read" ON jars;
DROP POLICY IF EXISTS "jars_service_write"      ON jars;

CREATE POLICY "jars_anon_read"
  ON jars FOR SELECT TO anon USING (true);
CREATE POLICY "jars_authenticated_read"
  ON jars FOR SELECT TO authenticated USING (true);
CREATE POLICY "jars_service_write"
  ON jars FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Without a service-role policy, the anon client can also write — keep
-- this matching the existing permissive single-user pattern for now.
DROP POLICY IF EXISTS "jars_anon_write" ON jars;
CREATE POLICY "jars_anon_write"
  ON jars FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ── stations: calibration columns ──────────────────────────────────────────
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS wall_pixel_mask    integer[],   -- 64 ints, 1=wall, 0=usable
  ADD COLUMN IF NOT EXISTS pixel_slope        real[],      -- 64 floats, mm/mm. NULL if single-height calibration.
  ADD COLUMN IF NOT EXISTS pixel_intercept    real[],      -- 64 floats, mm. NULL if single-height calibration.
  ADD COLUMN IF NOT EXISTS baseline_grid      real[],      -- 64 floats, mm. Used when slopes are NULL.
  ADD COLUMN IF NOT EXISTS baseline_height_mm real,        -- Height the baseline_grid was captured at.
  ADD COLUMN IF NOT EXISTS calibration_notes  text;

-- ── sessions: per-session physical setup ───────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS jar_id            uuid REFERENCES jars(id),
  ADD COLUMN IF NOT EXISTS setup_height_mm   real,
  ADD COLUMN IF NOT EXISTS pixel_subset      text DEFAULT '6x6_inner',
  ADD COLUMN IF NOT EXISTS manual_pixel_mask integer[];

-- Drop and re-add to allow re-running this migration cleanly.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS pixel_subset_valid;
ALTER TABLE sessions
  ADD CONSTRAINT pixel_subset_valid
  CHECK (pixel_subset IN ('6x6_inner', '4x4_center', '8x8_all', 'manual'));
