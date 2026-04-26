/**
 * 8x8 ToF grid rendered as 3D bars.
 *
 * Default mode: "rise from baseline".
 *   - The first frame in the dataset is the baseline.
 *   - Bar HEIGHT = how much the dough has risen at that pixel since
 *     baseline (positive when dough rose; clamped to 0 when it sank).
 *     Tall bar = grew taller; flat bar = no movement / dropped.
 *   - At session start every bar sits at the floor — exactly as the
 *     user asked for ("starting point should be zero").
 *
 * Optional toggle flips into "absolute distance" mode: bar height
 * proportional to raw distance reading (taller bar = bigger distance =
 * sensor far from surface).
 *
 * Bar COLOR = std-dev of that pixel across ALL frames (computed once,
 * never updated by the scrubber). High std-dev → orange (likely the
 * dough surface that moves over time). Low std-dev → dark blue
 * (stable: wall or empty air).
 *
 * Fixed isometric camera, no orbit.
 *
 * Props:
 *   selectedTs / onSelectTs synchronize the scrubber with the parent's
 *   click-pinned timestamp. Clicking a chart upstream sets selectedTs
 *   here; dragging the scrubber here calls onSelectTs upstream.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const GRID = 8;
const CELL_SIZE = 0.4;
const GAP = 0.05;
const MAX_HEIGHT = 4;

const COLOR_LOW = new THREE.Color(0x1e3a5f);
const COLOR_HIGH = new THREE.Color(0xf97316);

/**
 * `heights` is per-pixel display height in [0, 1] (already normalized).
 * `stdDevs` colors are also per-pixel. Both arrays length 64.
 */
function BarMesh({ heights, stdDevs, stdDevMax }: {
  heights: number[];
  stdDevs: number[];
  stdDevMax: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const obj = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    const colors: number[] = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const norm = heights[idx] ?? 0;
        const h = Math.max(0.05, norm * MAX_HEIGHT);
        const x = (c - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        const z = (r - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        obj.position.set(x, h / 2, z);
        obj.scale.set(1, h / CELL_SIZE, 1);
        obj.updateMatrix();
        meshRef.current.setMatrixAt(idx, obj.matrix);

        const sd = stdDevs[idx] ?? 0;
        const t = stdDevMax > 0 ? Math.min(1, sd / stdDevMax) : 0;
        tmpColor.copy(COLOR_LOW).lerp(COLOR_HIGH, t);
        colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    meshRef.current.geometry.setAttribute("color", colorAttr);
  }, [heights, stdDevs, stdDevMax, obj, tmpColor]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, GRID * GRID]}>
      <boxGeometry args={[CELL_SIZE, CELL_SIZE, CELL_SIZE]} />
      <meshStandardMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

interface ToFStdDevGridProps {
  /** Frames must already be filtered to those with a valid 64-length grid. */
  frames: Array<{ measured_at: string; ts_num: number; tof_grid: number[] }>;
  /** Click-pinned timestamp from the parent — scrubber jumps to nearest frame. */
  selectedTs?: number | null;
  /** Called when the user drags the scrubber so the parent can sync the
   *  vertical line on its line charts. */
  onSelectTs?: (ts: number | null) => void;
}

export function ToFStdDevGrid({
  frames,
  selectedTs,
  onSelectTs,
}: ToFStdDevGridProps) {
  const [frameIdx, setFrameIdx] = useState(0);
  // Default to RISE mode — that's what the user asked for. Toggle off
  // to fall back to absolute distance heights.
  const [mode, setMode] = useState<"rise" | "absolute">("rise");

  // Keep the slider valid if the underlying data shrinks.
  useEffect(() => {
    if (frameIdx >= frames.length) setFrameIdx(Math.max(0, frames.length - 1));
  }, [frames.length, frameIdx]);

  // Sync to parent's selectedTs — find nearest frame.
  useEffect(() => {
    if (selectedTs == null || frames.length === 0) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const d = Math.abs(frames[i].ts_num - selectedTs);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    setFrameIdx(best);
  }, [selectedTs, frames]);

  // Per-pixel std-dev across the whole session (computed once).
  const stdDevs = useMemo(() => {
    return Array.from({ length: 64 }, (_, pixelIdx) => {
      const values: number[] = [];
      for (const f of frames) {
        const v = f.tof_grid[pixelIdx];
        if (typeof v === "number" && v > 0 && v < 4000) values.push(v);
      }
      if (values.length < 2) return 0;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      return Math.sqrt(variance);
    });
  }, [frames]);
  const stdDevMax = useMemo(() => Math.max(...stdDevs, 1), [stdDevs]);

  // Distance domain (mm) for absolute-mode height mapping. 2-98 percentile clip.
  const { vMin, vMax } = useMemo(() => {
    const all: number[] = [];
    for (const f of frames) {
      for (const v of f.tof_grid) {
        if (typeof v === "number" && v > 0 && v < 4000) all.push(v);
      }
    }
    if (!all.length) return { vMin: 0, vMax: 1 };
    all.sort((a, b) => a - b);
    return {
      vMin: all[Math.floor(all.length * 0.02)],
      vMax: all[Math.floor(all.length * 0.98)],
    };
  }, [frames]);

  // Baseline (first frame) for rise computation.
  const baseline = frames[0]?.tof_grid;

  // Maximum positive rise across the session — used to normalize bar
  // heights so the tallest bar fills the canvas.
  const riseMaxMm = useMemo(() => {
    if (!baseline) return 1;
    let m = 1;
    for (const f of frames) {
      for (let i = 0; i < 64; i++) {
        const cur = f.tof_grid[i];
        const base = baseline[i];
        if (
          typeof cur === "number" && cur > 0 &&
          typeof base === "number" && base > 0
        ) {
          const rise = base - cur;
          if (rise > m) m = rise;
        }
      }
    }
    return m;
  }, [frames, baseline]);

  const currentFrame = frames[frameIdx] ?? frames[0];

  // Per-pixel normalized [0,1] height for the current frame.
  const displayHeights = useMemo(() => {
    if (!currentFrame) return Array(64).fill(0);
    const grid = currentFrame.tof_grid;
    const out: number[] = [];
    for (let i = 0; i < 64; i++) {
      const cur = grid[i];
      const validCur = typeof cur === "number" && cur > 0 && cur < 4000;
      if (mode === "rise") {
        const base = baseline?.[i];
        const validBase = typeof base === "number" && base > 0;
        if (validCur && validBase) {
          const rise = (base as number) - cur;
          out.push(Math.max(0, rise) / riseMaxMm);
        } else {
          out.push(0);
        }
      } else {
        // Absolute distance mode: taller bar = farther from sensor.
        if (validCur) {
          const v = Math.max(vMin, Math.min(vMax, cur));
          out.push((v - vMin) / Math.max(1, vMax - vMin));
        } else {
          out.push(0);
        }
      }
    }
    return out;
  }, [currentFrame, baseline, mode, riseMaxMm, vMin, vMax]);

  // Stats for the label under the canvas.
  const stats = useMemo(() => {
    if (!currentFrame) return null;
    const grid = currentFrame.tof_grid;
    const valid = grid.filter((v) => typeof v === "number" && v > 0 && v < 4000) as number[];
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (mode === "rise" && baseline) {
      const baseValid = baseline.filter((v) => typeof v === "number" && v > 0) as number[];
      const baseSorted = [...baseValid].sort((a, b) => a - b);
      const baseMedian = baseSorted[Math.floor(baseSorted.length / 2)];
      return { rise_cm: ((baseMedian - median) / 10).toFixed(1) };
    }
    return { distance_cm: (median / 10).toFixed(1) };
  }, [currentFrame, mode, baseline]);

  if (frames.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-center text-xs text-muted-foreground">
        {currentFrame ? new Date(currentFrame.measured_at).toLocaleString() : "—"}
        {stats && (
          <span className="ml-2">
            ·{" "}
            {"rise_cm" in stats
              ? `median rise ${stats.rise_cm} cm`
              : `median distance ${stats.distance_cm} cm`}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-center text-xs font-medium text-muted-foreground">Front</div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">
            Left
          </div>
          <div className="h-[260px] flex-1 overflow-hidden rounded-lg border border-border bg-card">
            <Canvas camera={{ position: [4, 5, 4], fov: 35 }} orthographic={false}>
              <ambientLight intensity={0.55} />
              <directionalLight position={[6, 10, 4]} intensity={0.9} />
              <BarMesh
                heights={displayHeights}
                stdDevs={stdDevs}
                stdDevMax={stdDevMax}
              />
            </Canvas>
          </div>
          <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
            Right
          </div>
        </div>
        <div className="text-center text-xs font-medium text-muted-foreground">Back</div>
      </div>

      {/* Scrubber — bidirectionally synced with the click-pin on the
          line charts above. */}
      <div className="flex items-center gap-2">
        <span className="w-12 text-right text-[10px] text-muted-foreground">
          {frameIdx + 1}/{frames.length}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={frameIdx}
          onChange={(e) => {
            const idx = Number(e.target.value);
            setFrameIdx(idx);
            if (onSelectTs && frames[idx]) onSelectTs(frames[idx].ts_num);
          }}
          className="flex-1 accent-primary"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant={mode === "rise" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode((m) => (m === "rise" ? "absolute" : "rise"))}
        >
          {mode === "rise" ? "Rise from baseline" : "Absolute distance"}
        </Button>
        <Label className="text-[10px] text-muted-foreground">
          color: per-pixel std-dev (orange = changing, blue = stable)
        </Label>
      </div>
    </div>
  );
}
