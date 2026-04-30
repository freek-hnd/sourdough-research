/**
 * Interactive panel for picking which 8x8 ToF pixels are tracking the
 * dough surface, vs. wall / rim / air / noise. Once you've got the
 * right mask, the median across just those pixels is the clean "dough
 * height" signal usable for modelling.
 *
 * Three methods, switchable via tabs:
 *   1. First-frame flat surface — thresholds against the median of
 *      the very first measurements (when the dough is flat).
 *   2. Relevance score threshold — uses the A×B score from
 *      tofAnalysis, with optional 4-connectivity post-filter.
 *   3. RANSAC circle fit — assumes the dough region is roughly
 *      circular, fits to high-scoring candidates.
 *
 * Layout (top to bottom):
 *   tabs · sliders · 2D minimap · clean signal plot · stats
 *
 * The 3D bar chart's "hide non-dough pixels" toggle lives in
 * SessionPlots and consumes the selected set produced here, via the
 * `onSelectionChange` callback.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  buildPixelMetas,
  firstFrameSelection,
  scoreThresholdSelection,
  ransacCircleSelection,
  medianOverPixels,
  pixelScoreCss,
} from "@/lib/tofAnalysis";

interface Frame {
  measured_at: string;
  ts_num: number;
  tof_grid: number[];
}

export interface DoughSelectionState {
  selected: Set<number>;
  /** Method-specific extras for downstream rendering. */
  circle?: { cx: number; cy: number; r: number } | null;
  method: "first_frame" | "score" | "ransac";
}

interface Props {
  /** All frames in the visible window — used for plot data. */
  frames: Frame[];
  /** All session frames (whole session) — used for first-frame selection. */
  sessionFrames: Frame[];
  /** Per-pixel A×B relevance scores (length 64). */
  pixelScores: number[];
  /** Session-start grid for "rise" calculations on the clean signal. */
  baselineGrid: number[] | null;
  /** Notify parent so it can hide non-selected bars in the 3D chart. */
  onSelectionChange?: (state: DoughSelectionState) => void;
}

type MethodKey = "first_frame" | "score" | "ransac";

export function DoughPixelSelection({
  frames,
  sessionFrames,
  pixelScores,
  baselineGrid,
  onSelectionChange,
}: Props) {
  const [method, setMethod] = useState<MethodKey>("first_frame");

  // Method 1 sliders
  const [numFrames, setNumFrames] = useState(3);
  const [tolerance, setTolerance] = useState(4);

  // Method 2 sliders
  const [scoreThreshold, setScoreThreshold] = useState(0.3);
  const [minNeighbors, setMinNeighbors] = useState(0);

  // Method 3 sliders
  const [ransacScoreThreshold, setRansacScoreThreshold] = useState(0.25);
  const [inlierTolerance, setInlierTolerance] = useState(1.5);
  const [ransacIterations, setRansacIterations] = useState(200);
  const [minInliers, setMinInliers] = useState(5);
  // RANSAC is non-deterministic — bump this seed to re-run.
  const [ransacSeed, setRansacSeed] = useState(0);

  const pixels = useMemo(() => buildPixelMetas(pixelScores), [pixelScores]);

  // Compute the active selection for the chosen method.
  const result = useMemo(() => {
    if (method === "first_frame") {
      const selected = firstFrameSelection(
        pixels,
        sessionFrames,
        numFrames,
        tolerance,
      );
      return { selected, circle: null as null | { cx: number; cy: number; r: number } };
    }
    if (method === "score") {
      const selected = scoreThresholdSelection(
        pixels,
        scoreThreshold,
        minNeighbors,
      );
      return { selected, circle: null as null | { cx: number; cy: number; r: number } };
    }
    // ransac
    void ransacSeed; // included in deps so Re-run button forces a recompute
    return ransacCircleSelection(
      pixels,
      ransacScoreThreshold,
      inlierTolerance,
      ransacIterations,
      minInliers,
    );
  }, [
    method,
    pixels,
    sessionFrames,
    numFrames,
    tolerance,
    scoreThreshold,
    minNeighbors,
    ransacScoreThreshold,
    inlierTolerance,
    ransacIterations,
    minInliers,
    ransacSeed,
  ]);

  // Bubble selection to parent so the 3D chart can use it.
  useEffect(() => {
    onSelectionChange?.({
      selected: result.selected,
      circle: result.circle ?? null,
      method,
    });
  }, [result, method, onSelectionChange]);

  // Clean signal: median of selected pixels per visible frame.
  const cleanSignal = useMemo(
    () => medianOverPixels(frames, result.selected),
    [frames, result.selected],
  );
  const allPixelsSet = useMemo(
    () => new Set<number>(Array.from({ length: 64 }, (_, i) => i)),
    [],
  );
  const allMedian = useMemo(
    () => medianOverPixels(frames, allPixelsSet),
    [frames, allPixelsSet],
  );

  // Chart data — combine both medians per frame.
  const chartData = useMemo(
    () =>
      frames.map((f, i) => ({
        ts_num: f.ts_num,
        clean_mm: cleanSignal[i],
        all_mm: allMedian[i],
      })),
    [frames, cleanSignal, allMedian],
  );

  // Summary stats based on the clean signal.
  const stats = useMemo(() => {
    const cleanValid = cleanSignal
      .map((v, i) => ({ v, ts: frames[i]?.ts_num }))
      .filter(
        (x): x is { v: number; ts: number } =>
          typeof x.v === "number" && typeof x.ts === "number",
      );
    if (cleanValid.length === 0) {
      return null;
    }
    const baselineMm = cleanValid[0].v;
    const peak = cleanValid.reduce(
      (best, cur) => (cur.v < best.v ? cur : best),
      cleanValid[0],
    );
    const totalRiseMm = baselineMm - peak.v;
    const sessionStartMs = sessionFrames[0]?.ts_num ?? frames[0]?.ts_num ?? peak.ts;
    const timeToPeakMs = peak.ts - sessionStartMs;
    return {
      totalRiseMm,
      timeToPeakHours: timeToPeakMs / 3600_000,
      n: cleanValid.length,
    };
  }, [cleanSignal, frames, sessionFrames]);

  return (
    <div className="space-y-3 p-3">
      <Tabs value={method} onValueChange={(v) => setMethod(v as MethodKey)}>
        <TabsList>
          <TabsTrigger value="first_frame">First-frame</TabsTrigger>
          <TabsTrigger value="score">Score threshold</TabsTrigger>
          <TabsTrigger value="ransac">RANSAC circle</TabsTrigger>
        </TabsList>

        {/* Sliders + minimap side by side. Stack on narrow screens. */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr]">
          <Minimap
            pixels={pixels}
            selected={result.selected}
            circle={result.circle}
          />
          <div className="space-y-3">
            <TabsContent value="first_frame" className="m-0 space-y-3">
              <Slider
                label="First frames to use"
                min={1}
                max={10}
                step={1}
                value={numFrames}
                onChange={setNumFrames}
                help="Average distance across the first N frames; pixels close to the median count as flat dough."
              />
              <Slider
                label="Tolerance (mm)"
                min={1}
                max={30}
                step={1}
                value={tolerance}
                onChange={setTolerance}
                help="Max deviation from the first-frame median to be included."
              />
            </TabsContent>

            <TabsContent value="score" className="m-0 space-y-3">
              <Slider
                label="Score threshold"
                min={0}
                max={1}
                step={0.01}
                value={scoreThreshold}
                onChange={setScoreThreshold}
                format={(v) => v.toFixed(2)}
                help="Minimum A×B relevance score to include the pixel."
              />
              <Slider
                label="Min connected neighbors"
                min={0}
                max={4}
                step={1}
                value={minNeighbors}
                onChange={setMinNeighbors}
                help="Drop pixels with fewer than N selected 4-neighbors. 0 = disabled."
              />
            </TabsContent>

            <TabsContent value="ransac" className="m-0 space-y-3">
              <Slider
                label="Score threshold (candidates)"
                min={0}
                max={1}
                step={0.01}
                value={ransacScoreThreshold}
                onChange={setRansacScoreThreshold}
                format={(v) => v.toFixed(2)}
                help="Pixels above this score become candidates for the circle fit."
              />
              <Slider
                label="Inlier tolerance (cells)"
                min={0.5}
                max={3}
                step={0.1}
                value={inlierTolerance}
                onChange={setInlierTolerance}
                format={(v) => v.toFixed(1)}
                help="Max distance from the fitted circle to count as an inlier."
              />
              <Slider
                label="RANSAC iterations"
                min={50}
                max={500}
                step={50}
                value={ransacIterations}
                onChange={setRansacIterations}
                help="Number of random 3-point samples to try."
              />
              <Slider
                label="Min inliers"
                min={3}
                max={20}
                step={1}
                value={minInliers}
                onChange={setMinInliers}
                help="Minimum inlier count to accept a fitted circle."
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRansacSeed((s) => s + 1)}
              >
                Re-run RANSAC
              </Button>
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        {result.selected.size} / 64 pixels selected
      </p>

      {/* Clean signal plot */}
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Dough signal — selected pixels only
        </div>
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts_num"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => {
                  const d = new Date(v as number);
                  return `${String(d.getHours()).padStart(2, "0")}:${String(
                    d.getMinutes(),
                  ).padStart(2, "0")}`;
                }}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v) => new Date(v as number).toLocaleString()}
                formatter={(v, name) =>
                  typeof v === "number"
                    ? [`${v.toFixed(0)} mm`, name === "clean_mm" ? "selected" : "all"]
                    : [v, name]
                }
              />
              <Line
                type="monotone"
                dataKey="all_mm"
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="clean_mm"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
              />
              {baselineGrid && (
                <ReferenceLine
                  y={getBaselineMedian(baselineGrid)}
                  stroke="hsl(var(--border))"
                  strokeDasharray="2 2"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-muted-foreground">Total rise</div>
          <div className="font-mono text-sm font-medium">
            {stats ? `${(stats.totalRiseMm / 10).toFixed(1)} cm` : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-muted-foreground">Time to peak</div>
          <div className="font-mono text-sm font-medium">
            {stats
              ? `${stats.timeToPeakHours.toFixed(1)} h`
              : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-muted-foreground">N (frames)</div>
          <div className="font-mono text-sm font-medium">
            {stats ? stats.n : 0}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 2D minimap -------------------------------------------------------------

function Minimap({
  pixels,
  selected,
  circle,
}: {
  pixels: ReturnType<typeof buildPixelMetas>;
  selected: Set<number>;
  circle?: { cx: number; cy: number; r: number } | null;
}) {
  // 8x8 cells, 22px each, with 1px gap. Total inner = 8*22 + 7*1 = 183.
  const CELL = 22;
  const GAP = 1;
  const INNER = 8 * CELL + 7 * GAP;
  const PAD = 16; // for side labels
  const TOTAL = INNER + 2 * PAD;
  // Convert (col, row) → pixel center (x, y) on the SVG.
  const cellX = (col: number) => PAD + col * (CELL + GAP) + CELL / 2;
  const cellY = (row: number) => PAD + row * (CELL + GAP) + CELL / 2;
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${TOTAL} ${TOTAL}`}
        className="w-full max-w-[220px]"
        aria-label="ToF dough mask minimap"
      >
        {/* Side labels — row 0 = physical BACK rendered at top,
            row 7 = physical FRONT (operator side) at bottom. */}
        <text
          x={TOTAL / 2}
          y={PAD - 4}
          fontSize="9"
          textAnchor="middle"
          fill="currentColor"
          className="text-muted-foreground"
        >
          Back
        </text>
        <text
          x={TOTAL / 2}
          y={TOTAL - 4}
          fontSize="9"
          textAnchor="middle"
          fill="currentColor"
          className="text-muted-foreground"
        >
          Front
        </text>
        <text
          x={4}
          y={TOTAL / 2}
          fontSize="9"
          textAnchor="start"
          dominantBaseline="middle"
          fill="currentColor"
          className="text-muted-foreground"
        >
          L
        </text>
        <text
          x={TOTAL - 4}
          y={TOTAL / 2}
          fontSize="9"
          textAnchor="end"
          dominantBaseline="middle"
          fill="currentColor"
          className="text-muted-foreground"
        >
          R
        </text>

        {pixels.map((p) => {
          const x = PAD + p.col * (CELL + GAP);
          const y = PAD + p.row * (CELL + GAP);
          const isSelected = selected.has(p.index);
          return (
            <g key={p.index}>
              <rect
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                fill={pixelScoreCss(p.score)}
                opacity={isSelected ? 1 : 0.45}
                rx={2}
              />
              {isSelected && (
                <rect
                  x={x + 0.5}
                  y={y + 0.5}
                  width={CELL - 1}
                  height={CELL - 1}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  rx={2}
                />
              )}
            </g>
          );
        })}

        {circle && (
          <circle
            cx={cellX(circle.cx)}
            cy={cellY(circle.cy)}
            // Convert circle radius (in cell units) to SVG units.
            r={circle.r * (CELL + GAP)}
            fill="none"
            stroke="#10b981"
            strokeOpacity={0.7}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
      </svg>
      <div className="text-center text-[10px] text-muted-foreground">
        green border = selected
      </div>
    </div>
  );
}

// --- Slider primitive (native range input, kept tiny on purpose) -----------

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
  help,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  help?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {help && <p className="text-[10px] text-muted-foreground">{help}</p>}
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function getBaselineMedian(grid: number[]): number {
  const valid = grid.filter((v) => typeof v === "number" && v > 0 && v < 4000);
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
