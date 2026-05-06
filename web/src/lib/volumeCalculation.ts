/**
 * Volume estimation from a raw 8x8 ToF grid.
 *
 * Inputs come from three orthogonal sources:
 *
 *   station — sensor geometry. The empty-baseline grid the sensor sees
 *             when nothing is there:
 *               • multi-height linear model:  pixel_slope + pixel_intercept
 *               • single-height fallback:     baseline_grid + baseline_height_mm
 *             plus wall_pixel_mask telling us which pixels never see the jar.
 *
 *   jar     — container geometry. cross_section_area_cm² turns mm rise
 *             into ml.
 *
 *   session — physical setup. Which jar, setup_height_mm above the
 *             station's reference plane, and pixel_subset selecting
 *             which of the 64 pixels actually sit over the jar.
 *
 * The function returns null volumes when any required input is missing,
 * and 0 (clamped) when the surface is below baseline. We intentionally
 * compute at render time so improvements to calibration land
 * retroactively across the entire historical dataset.
 */

const FOV_HALF_DEG = 16.0;
const PIXELS = 8;

// Pre-computed cosine of viewing angle for each of the 64 pixels.
// Pixels far from sensor center see the surface obliquely; multiplying
// the apparent vertical distance by cos(angle) gives the true vertical
// component.
const COS_GRID: number[] = (() => {
  const step = FOV_HALF_DEG / (PIXELS / 2);
  return Array.from({ length: 64 }, (_, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    const deg = Math.sqrt(((r - 3.5) * step) ** 2 + ((c - 3.5) * step) ** 2);
    return Math.cos((deg * Math.PI) / 180);
  });
})();

export type CalibStation = {
  wall_pixel_mask: number[] | null;
  pixel_slope: number[] | null;
  pixel_intercept: number[] | null;
  baseline_grid: number[] | null;
  baseline_height_mm: number | null;
};

export type CalibJar = {
  cross_section_area_cm2: number | null;
};

export type CalibSession = {
  setup_height_mm: number | null;
  pixel_subset: string | null;
  manual_pixel_mask: number[] | null;
};

export type VolumeResult = {
  volume_mean_ml: number | null;
  volume_median_ml: number | null;
  n_active_pixels: number;
  mean_delta_mm: number | null;
  median_delta_mm: number | null;
};

const EMPTY: VolumeResult = {
  volume_mean_ml: null,
  volume_median_ml: null,
  n_active_pixels: 0,
  mean_delta_mm: null,
  median_delta_mm: null,
};

/** Returns a 64-element boolean mask: true = include this pixel. */
export function getPixelSubsetMask(session: CalibSession): boolean[] {
  if (session.pixel_subset === "manual" && session.manual_pixel_mask) {
    return session.manual_pixel_mask.map((v) => v === 1);
  }
  if (session.pixel_subset === "4x4_center") {
    // rows 2-5, cols 2-5
    return Array.from({ length: 64 }, (_, i) => {
      const r = Math.floor(i / 8);
      const c = i % 8;
      return r >= 2 && r <= 5 && c >= 2 && c <= 5;
    });
  }
  if (session.pixel_subset === "8x8_all") {
    return Array.from({ length: 64 }, () => true);
  }
  // default: '6x6_inner' — drop the outer ring of pixels.
  return Array.from({ length: 64 }, (_, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    return r >= 1 && r <= 6 && c >= 1 && c <= 6;
  });
}

/**
 * Predicted empty-baseline grid for the given setup height.
 * Returns null if the station can't predict at that height.
 */
export function getExpectedBaseline(
  station: CalibStation,
  setupHeightMm: number,
): number[] | null {
  // Multi-height linear model takes priority — it can predict at any height.
  if (
    station.pixel_slope &&
    station.pixel_intercept &&
    station.pixel_slope.length === 64 &&
    station.pixel_intercept.length === 64
  ) {
    return station.pixel_slope.map(
      (s, i) => station.pixel_intercept![i] + s * setupHeightMm,
    );
  }
  // Single-height calibration: only valid at the height it was captured at.
  if (
    station.baseline_grid &&
    station.baseline_height_mm !== null &&
    station.baseline_height_mm !== undefined &&
    Math.abs(station.baseline_height_mm - setupHeightMm) < 1.0
  ) {
    return station.baseline_grid;
  }
  return null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Compute volume (mean + median) from a raw 8x8 distance grid in mm.
 *
 * deltaThreshold is the noise floor in mm: pixels whose delta from
 * baseline is below this don't count as "liquid present" and are
 * dropped before averaging.
 */
export function computeVolume(
  tofGrid: number[],
  station: CalibStation,
  jar: CalibJar,
  session: CalibSession,
  deltaThreshold = 3.0,
): VolumeResult {
  // Hard preconditions.
  if (
    !station.wall_pixel_mask ||
    station.wall_pixel_mask.length !== 64 ||
    jar.cross_section_area_cm2 == null ||
    session.setup_height_mm == null
  ) {
    return EMPTY;
  }

  const expected = getExpectedBaseline(station, session.setup_height_mm);
  if (!expected || expected.length !== 64) return EMPTY;

  if (!Array.isArray(tofGrid) || tofGrid.length !== 64) return EMPTY;

  const subsetMask = getPixelSubsetMask(session);

  const deltas: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (station.wall_pixel_mask[i] === 1) continue;
    if (!subsetMask[i]) continue;
    const raw = tofGrid[i];
    // Per the spec: drop sentinel zeros and out-of-band readings.
    // 400mm matches the spec literally; the firmware sends mm so
    // anything wildly larger than expected jar setups is junk.
    if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 400) {
      continue;
    }
    const delta = (expected[i] - raw) * COS_GRID[i];
    if (delta > deltaThreshold) deltas.push(delta);
  }

  if (deltas.length === 0) return EMPTY;

  const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const medianDelta = median(deltas);
  const factor = jar.cross_section_area_cm2 / 10; // ml per mm

  return {
    volume_mean_ml: Math.max(0, meanDelta * factor),
    volume_median_ml: Math.max(0, medianDelta * factor),
    n_active_pixels: deltas.length,
    mean_delta_mm: meanDelta,
    median_delta_mm: medianDelta,
  };
}
