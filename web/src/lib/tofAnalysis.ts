/**
 * Pixel-relevance scoring for the 8x8 ToF sensor over a fermentation
 * session. Replaces the earlier std-dev approach which incorrectly
 * rewarded glitchy border pixels that bounced randomly.
 *
 * Two metrics multiplied together:
 *   A — Pearson correlation between the pixel and the per-timestamp
 *       median across all valid pixels. A pixel that follows the
 *       overall dough trend scores high; a constant or unrelated
 *       pixel scores 0.
 *   B — Unimodality. The dough should drop (rise toward sensor) and
 *       optionally come back up. A single direction change scores
 *       high; jittery/random pixels score low.
 *
 * Final score = max(0, A) × B in [0,1].
 *
 * The functions live in lib/ so they can be reused outside of
 * SessionPlots — calibration tools, batch analysis scripts, etc.
 */

const VALID_MIN_MM = 0;
const VALID_MAX_MM = 4000;

// --- Cleaning ---------------------------------------------------------------

/**
 * Mark glitches in a per-pixel time series. A reading is a glitch if:
 *   - it falls outside [0, 4000] mm
 *   - it jumps more than `glitchThreshold` mm from the previous valid reading
 *   - its measurement timestamp falls within `eventMaskMs` of any event
 *     in `eventTimestamps` (e.g. station_adjusted_*)
 *
 * Returns a same-length array with `null` where the reading was filtered
 * out. The same-length array preserves alignment so multiple per-pixel
 * series can be paired up timestep-by-timestep (needed for correlation).
 */
export function cleanSeriesAligned(
  series: ReadonlyArray<number | null | undefined>,
  eventTimestamps: ReadonlyArray<number>,
  measurementTimestamps: ReadonlyArray<number>,
  glitchThreshold = 80,
  eventMaskMs = 300_000,
): (number | null)[] {
  // Pass 1: range and event-window filters.
  const filtered: (number | null)[] = series.map((v, i) => {
    if (v == null || !Number.isFinite(v) || v <= VALID_MIN_MM || v >= VALID_MAX_MM) {
      return null;
    }
    const t = measurementTimestamps[i];
    if (eventTimestamps.some((et) => Math.abs(t - et) < eventMaskMs)) {
      return null;
    }
    return v;
  });

  // Pass 2: jump detection vs the most recent valid reading.
  let prev: number | null = null;
  return filtered.map((v) => {
    if (v == null) return null;
    if (prev != null && Math.abs(v - prev) > glitchThreshold) {
      // Don't update prev — sustained jumps thus get continuously dropped,
      // which is what we want for a station that was knocked out of
      // alignment.
      return null;
    }
    prev = v;
    return v;
  });
}

/** Convenience: drop nulls. Loses alignment. */
export function compactSeries(series: ReadonlyArray<number | null>): number[] {
  return series.filter((v): v is number => v != null);
}

// --- Metric A: Pearson correlation -----------------------------------------

export function pearsonCorrelation(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// --- Metric B: Unimodality --------------------------------------------------

/**
 * Score how well a series matches a single "rise then optional fall"
 * trajectory, ignoring small jitters via a 3-point moving average.
 *
 * Score is the weighted fraction of monotone pairs in the two halves
 * of the series, split at the minimum.  A perfectly clean dough rise
 * scores ~1; random jitter scores ~0.5; constant or noise scores
 * lower.
 */
export function unimodalityScore(series: ReadonlyArray<number>): number {
  if (series.length < 4) return 0;

  // 3-point moving average smooth.
  const smoothed = series.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(series.length, i + 2);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += series[j];
    return sum / (hi - lo);
  });

  // Index of minimum = peak dough height (closest to sensor).
  let minIdx = 0;
  let minVal = smoothed[0];
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] < minVal) {
      minVal = smoothed[i];
      minIdx = i;
    }
  }

  // Before min: should be monotonically decreasing (distance shrinking
  // = dough rising).
  const before = smoothed.slice(0, minIdx + 1);
  let beforeScore = 1;
  if (before.length > 1) {
    let dec = 0;
    for (let i = 1; i < before.length; i++) {
      if (before[i] <= before[i - 1]) dec++;
    }
    beforeScore = dec / (before.length - 1);
  }

  // After min: should be monotonically increasing.
  const after = smoothed.slice(minIdx);
  let afterScore = 1;
  if (after.length > 1) {
    let inc = 0;
    for (let i = 1; i < after.length; i++) {
      if (after[i] >= after[i - 1]) inc++;
    }
    afterScore = inc / (after.length - 1);
  }

  // Weight by the fraction of the series each half covers — a series
  // whose minimum is right at the start is essentially "all increasing"
  // and shouldn't earn full credit just because the trivially short
  // before-half scores 1.
  const w = minIdx / smoothed.length;
  return w * beforeScore + (1 - w) * afterScore;
}

// --- Combined scoring -------------------------------------------------------

export interface FrameForScoring {
  ts_num: number;
  tof_grid: number[];
}

/**
 * Returns a length-64 array of pixel relevance scores in [0, 1].
 * Higher = more likely tracking the dough surface.
 *
 * Uses ALL provided frames for scoring (intended to be fed the entire
 * session, not just a visible window — scores should be a stable
 * property of the pixel within the session).
 */
export function computePixelScores(
  frames: ReadonlyArray<FrameForScoring>,
  eventTimestamps: ReadonlyArray<number>,
): number[] {
  if (frames.length < 4) return new Array(64).fill(0);

  const measurementTimestamps = frames.map((f) => f.ts_num);

  // Per-timestamp median across valid pixels — used as the "expected
  // dough trajectory" reference for Pearson correlation.
  const medianRaw: (number | null)[] = frames.map((f) => {
    const valid = f.tof_grid.filter(
      (v) => typeof v === "number" && v > VALID_MIN_MM && v < VALID_MAX_MM,
    );
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });

  // Apply the event-mask filter to the median series too — we don't
  // want correlation with adjustments. Don't apply jump detection
  // because the median across 64 pixels is already robust.
  const medianClean: (number | null)[] = medianRaw.map((v, i) => {
    if (v == null) return null;
    const t = measurementTimestamps[i];
    if (eventTimestamps.some((et) => Math.abs(t - et) < 300_000)) return null;
    return v;
  });

  return Array.from({ length: 64 }, (_, p) => {
    const rawPixel = frames.map((f) => {
      const v = f.tof_grid[p];
      return typeof v === "number" ? v : null;
    });
    const cleanedAligned = cleanSeriesAligned(
      rawPixel,
      eventTimestamps,
      measurementTimestamps,
    );

    // Metric A — Pearson with the median, on indexes where both are valid.
    const pixVals: number[] = [];
    const medVals: number[] = [];
    for (let i = 0; i < cleanedAligned.length; i++) {
      const px = cleanedAligned[i];
      const md = medianClean[i];
      if (px != null && md != null) {
        pixVals.push(px);
        medVals.push(md);
      }
    }
    const scoreA = Math.max(0, pearsonCorrelation(pixVals, medVals));

    // Metric B — unimodality of the compacted clean series.
    const compactPixel = compactSeries(cleanedAligned);
    const scoreB = unimodalityScore(compactPixel);

    return scoreA * scoreB;
  });
}

// --- Color mapping ----------------------------------------------------------

/**
 * 0..1 score → linear-RGB color anchored at #1e3a5f (dark blue,
 * not tracking dough) and #f97316 (orange, likely tracking dough).
 * Returns floats in [0,1] for direct use with three.js.
 */
export function pixelScoreColor(score: number): { r: number; g: number; b: number } {
  const t = Math.max(0, Math.min(1, score));
  const r0 = 0x1e / 255;
  const g0 = 0x3a / 255;
  const b0 = 0x5f / 255;
  const r1 = 0xf9 / 255;
  const g1 = 0x73 / 255;
  const b1 = 0x16 / 255;
  return {
    r: r0 + (r1 - r0) * t,
    g: g0 + (g1 - g0) * t,
    b: b0 + (b1 - b0) * t,
  };
}

/** Same gradient as pixelScoreColor but as a CSS rgb() string. */
export function pixelScoreCss(score: number): string {
  const { r, g, b } = pixelScoreColor(score);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ===========================================================================
// Dough pixel selection — three methods for picking which 8x8 pixels are
// actually tracking the dough surface (vs. wall, rim, air, or noise).
// ===========================================================================

export interface PixelMeta {
  index: number;
  row: number;
  col: number;
  score: number;
}

/** Build PixelMeta[] from a length-64 array of pixel relevance scores. */
export function buildPixelMetas(scores: ReadonlyArray<number>): PixelMeta[] {
  return Array.from({ length: 64 }, (_, i) => ({
    index: i,
    row: Math.floor(i / 8),
    col: i % 8,
    score: scores[i] ?? 0,
  }));
}

// --- Method 1 — first-frame flat surface -----------------------------------

/**
 * Fresh mixed dough is approximately flat. In the first few frames, pixels
 * above the dough read approximately the same distance. Pixels that deviate
 * more than `toleranceMm` from the median of those first frames are likely
 * hitting walls / rim / air.
 */
export function firstFrameSelection(
  pixels: ReadonlyArray<PixelMeta>,
  frames: ReadonlyArray<{ tof_grid: number[] }>,
  numFrames: number,
  toleranceMm: number,
): Set<number> {
  const window = frames.slice(0, Math.max(1, numFrames));
  if (window.length === 0) return new Set();

  // Per-pixel mean over the first N frames (ignoring out-of-range readings).
  const pixelMeans: (number | null)[] = pixels.map((p) => {
    const vals: number[] = [];
    for (const f of window) {
      const v = f.tof_grid[p.index];
      if (typeof v === "number" && v > 0 && v < 4000) vals.push(v);
    }
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  // Robust median across pixel means (so the "expected dough surface"
  // distance doesn't get pulled by a few wall pixels).
  const valid = pixelMeans.filter((v): v is number => v != null);
  if (valid.length === 0) return new Set();
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  return new Set(
    pixels
      .filter((_, i) => {
        const m = pixelMeans[i];
        return m != null && Math.abs(m - median) <= toleranceMm;
      })
      .map((p) => p.index),
  );
}

// --- Method 2 — relevance score threshold + connectivity --------------------

/**
 * Threshold by A×B relevance score. Optionally drop isolated high-scoring
 * pixels that don't have enough selected 4-neighbors (one pass, not iterative).
 */
export function scoreThresholdSelection(
  pixels: ReadonlyArray<PixelMeta>,
  threshold: number,
  minNeighbors: number,
): Set<number> {
  const initial = new Set(
    pixels.filter((p) => p.score >= threshold).map((p) => p.index),
  );

  if (minNeighbors <= 0) return initial;

  const filtered = new Set<number>();
  for (const idx of initial) {
    const row = Math.floor(idx / 8);
    const col = idx % 8;
    const candidates = [
      row > 0 ? (row - 1) * 8 + col : -1,
      row < 7 ? (row + 1) * 8 + col : -1,
      col > 0 ? row * 8 + (col - 1) : -1,
      col < 7 ? row * 8 + (col + 1) : -1,
    ];
    let count = 0;
    for (const n of candidates) {
      if (n >= 0 && initial.has(n)) count++;
    }
    if (count >= minNeighbors) filtered.add(idx);
  }
  return filtered;
}

// --- Method 3 — RANSAC circle fit -------------------------------------------

interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Standard 3-point circle fit. Null if collinear. */
export function fitCircleThrough3Points(
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
): Circle | null {
  const [ax, ay] = p1;
  const [bx, by] = p2;
  const [cx, cy] = p3;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-6) return null;
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    D;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    D;
  const r = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));
  return { cx: ux, cy: uy, r };
}

/**
 * Fit a circle through high-scoring pixels (RANSAC), then select all pixels
 * inside the fitted circle. Returns the fitted circle alongside so the UI
 * can draw it as an overlay.
 *
 * Note: pixel coordinates use (row, col), so the returned circle's `cy` is
 * the row coord and `cx` is the column coord. Render order matters in the
 * minimap.
 */
export function ransacCircleSelection(
  pixels: ReadonlyArray<PixelMeta>,
  scoreThreshold: number,
  inlierTolerance: number,
  iterations: number,
  minInliers: number,
): { selected: Set<number>; circle: Circle | null } {
  const candidates = pixels.filter((p) => p.score >= scoreThreshold);
  if (candidates.length < 3) return { selected: new Set(), circle: null };

  let bestInlierCount = 0;
  let bestCircle: Circle | null = null;

  for (let i = 0; i < iterations; i++) {
    // Pick three distinct candidates randomly.
    const a = candidates[Math.floor(Math.random() * candidates.length)];
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    if (a.index === b.index || a.index === c.index || b.index === c.index) continue;

    const circle = fitCircleThrough3Points(
      [a.row, a.col],
      [b.row, b.col],
      [c.row, c.col],
    );
    if (!circle) continue;
    // Reject degenerate circles that don't fit on an 8x8 grid sensibly.
    if (circle.r < 0.5 || circle.r > 8) continue;

    let count = 0;
    for (const p of candidates) {
      const d = Math.sqrt(
        (p.row - circle.cy) ** 2 + (p.col - circle.cx) ** 2,
      );
      if (Math.abs(d - circle.r) <= inlierTolerance) count++;
    }
    if (count > bestInlierCount && count >= minInliers) {
      bestInlierCount = count;
      bestCircle = circle;
    }
  }

  if (!bestCircle) return { selected: new Set(), circle: null };

  // Select EVERY pixel inside the circle (not just candidates) so the
  // dough mask includes pixels whose score happens to be low — what
  // matters once we've located the dough region geometrically.
  const c = bestCircle;
  const selected = new Set(
    pixels
      .filter((p) => {
        const d = Math.sqrt((p.row - c.cy) ** 2 + (p.col - c.cx) ** 2);
        return d <= c.r + inlierTolerance;
      })
      .map((p) => p.index),
  );

  return { selected, circle: bestCircle };
}

// --- Median dough signal helper --------------------------------------------

/**
 * For a given set of selected pixel indices and a series of frames,
 * return per-frame median distance across the selected pixels.
 * Output is aligned with the input frames; null where every selected
 * pixel was invalid at that timestep.
 */
export function medianOverPixels(
  frames: ReadonlyArray<{ tof_grid: number[] }>,
  selected: ReadonlySet<number>,
): (number | null)[] {
  if (selected.size === 0) return frames.map(() => null);
  return frames.map((f) => {
    const vals: number[] = [];
    for (const idx of selected) {
      const v = f.tof_grid[idx];
      if (typeof v === "number" && v > 0 && v < 4000) vals.push(v);
    }
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
}
