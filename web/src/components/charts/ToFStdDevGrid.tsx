/**
 * 8x8 ToF grid rendered as 3D bars.
 *
 * Bar HEIGHT = "rise from baseline" by default — how much the dough
 * has risen at that pixel since the FIRST measurement of the session
 * (NOT the first visible frame). This stays correct even when the
 * time selector is set to "Last 6h" mid-session: a pixel that has
 * already risen 30mm before the visible window starts shows a bar
 * 30mm tall throughout, instead of resetting to 0.
 *
 * Bar COLOR = the per-pixel A×B relevance score computed once
 * across the whole session by useSessionTofAnalysis. Pixels likely
 * tracking the dough surface glow orange; pixels stuck on the wall
 * or jittery sit dark blue. Scores are passed in as props so the
 * coloring is consistent between this widget and any future
 * calibration tooling.
 *
 * Toggle button flips into "Absolute distance" mode for raw mm
 * heights when needed.
 *
 * Scrubber is bidirectionally synced with the parent via
 * selectedTs / onSelectTs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { pixelScoreColor } from "@/lib/tofAnalysis";

const GRID = 8;
const CELL_SIZE = 0.4;
const GAP = 0.05;
const MAX_HEIGHT = 4;

// Color used for the dimmed-out non-dough pixels when the "hide non-dough"
// toggle is on. Almost-black so it doesn't compete with the actual data.
const HIDDEN_COLOR = { r: 0x1a / 255, g: 0x1a / 255, b: 0x2e / 255 };

function BarMesh({
  heights,
  pixelScores,
  hiddenPixels,
}: {
  heights: number[];
  pixelScores: number[];
  /** Pixels to render flat + dim. Empty set = render everything. */
  hiddenPixels: ReadonlySet<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const obj = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    const colors: number[] = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const isHidden = hiddenPixels.has(idx);
        // Hidden pixels get a flat near-zero bar so the Z scale stops
        // being dominated by a bright wall reading at the edge.
        const norm = isHidden ? 0 : (heights[idx] ?? 0);
        const h = Math.max(0.05, norm * MAX_HEIGHT);
        const x = (c - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        const z = (r - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        obj.position.set(x, h / 2, z);
        obj.scale.set(1, h / CELL_SIZE, 1);
        obj.updateMatrix();
        meshRef.current.setMatrixAt(idx, obj.matrix);

        if (isHidden) {
          colors.push(HIDDEN_COLOR.r, HIDDEN_COLOR.g, HIDDEN_COLOR.b);
        } else {
          const { r: cr, g: cg, b: cb } = pixelScoreColor(pixelScores[idx] ?? 0);
          colors.push(cr, cg, cb);
        }
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    meshRef.current.geometry.setAttribute("color", colorAttr);
  }, [heights, pixelScores, hiddenPixels, obj]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, GRID * GRID]}>
      <boxGeometry args={[CELL_SIZE, CELL_SIZE, CELL_SIZE]} />
      <meshStandardMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

interface ToFStdDevGridProps {
  /** Frames in the visible window — drive the scrubber and bar heights. */
  frames: Array<{ measured_at: string; ts_num: number; tof_grid: number[] }>;
  /** First-measurement-of-session grid — anchor for the "rise" mode. */
  baselineGrid: number[] | null;
  /** Per-pixel relevance scores from the whole session, length 64. */
  pixelScores: number[];
  /** Click-pinned timestamp from the parent — scrubber jumps to nearest frame. */
  selectedTs?: number | null;
  /** Called when the user drags the scrubber. */
  onSelectTs?: (ts: number | null) => void;
  /** When provided, the "Hide non-dough" toggle becomes active. Pixels NOT
   *  in this set are shown flat + dim when the toggle is on. */
  selectedPixels?: ReadonlySet<number>;
}

export function ToFStdDevGrid({
  frames,
  baselineGrid,
  pixelScores,
  selectedTs,
  onSelectTs,
  selectedPixels,
}: ToFStdDevGridProps) {
  const [frameIdx, setFrameIdx] = useState(0);
  // Default: "Rise from session start". Toggle off → absolute distance.
  const [mode, setMode] = useState<"rise" | "absolute">("rise");
  const [hideNonDough, setHideNonDough] = useState(false);

  // Build the hidden set: every pixel NOT in selectedPixels, when the
  // toggle is on AND we have a meaningful selection. With no selection
  // (size 0 or 64) the toggle is a no-op.
  const hiddenPixels = useMemo<ReadonlySet<number>>(() => {
    if (!hideNonDough || !selectedPixels) return new Set();
    if (selectedPixels.size === 0 || selectedPixels.size >= 64) return new Set();
    const hidden = new Set<number>();
    for (let i = 0; i < 64; i++) {
      if (!selectedPixels.has(i)) hidden.add(i);
    }
    return hidden;
  }, [hideNonDough, selectedPixels]);

  useEffect(() => {
    if (frameIdx >= frames.length) setFrameIdx(Math.max(0, frames.length - 1));
  }, [frames.length, frameIdx]);

  // Sync scrubber to parent's pinned timestamp.
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

  // Distance domain for absolute-mode height mapping. 2-98 percentile clip.
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

  // Maximum positive rise across the whole visible series (relative to
  // the SESSION baseline, not first visible frame) — used to normalize
  // bar heights so the tallest rise fills the canvas.
  const riseMaxMm = useMemo(() => {
    if (!baselineGrid) return 1;
    let m = 1;
    for (const f of frames) {
      for (let i = 0; i < 64; i++) {
        const cur = f.tof_grid[i];
        const base = baselineGrid[i];
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
  }, [frames, baselineGrid]);

  const currentFrame = frames[frameIdx] ?? frames[0];

  const displayHeights = useMemo(() => {
    if (!currentFrame) return Array(64).fill(0);
    const grid = currentFrame.tof_grid;
    const out: number[] = [];
    for (let i = 0; i < 64; i++) {
      const cur = grid[i];
      const validCur = typeof cur === "number" && cur > 0 && cur < 4000;
      if (mode === "rise") {
        const base = baselineGrid?.[i];
        const validBase = typeof base === "number" && base > 0;
        if (validCur && validBase) {
          const rise = (base as number) - cur;
          out.push(Math.max(0, rise) / riseMaxMm);
        } else {
          out.push(0);
        }
      } else {
        if (validCur) {
          const v = Math.max(vMin, Math.min(vMax, cur));
          out.push((v - vMin) / Math.max(1, vMax - vMin));
        } else {
          out.push(0);
        }
      }
    }
    return out;
  }, [currentFrame, baselineGrid, mode, riseMaxMm, vMin, vMax]);

  const stats = useMemo(() => {
    if (!currentFrame) return null;
    const grid = currentFrame.tof_grid;
    const valid = grid.filter((v) => typeof v === "number" && v > 0 && v < 4000) as number[];
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (mode === "rise" && baselineGrid) {
      const baseValid = baselineGrid.filter((v) => typeof v === "number" && v > 0) as number[];
      if (baseValid.length === 0) return { distance_cm: (median / 10).toFixed(1) };
      const baseSorted = [...baseValid].sort((a, b) => a - b);
      const baseMedian = baseSorted[Math.floor(baseSorted.length / 2)];
      return { rise_cm: ((baseMedian - median) / 10).toFixed(1) };
    }
    return { distance_cm: (median / 10).toFixed(1) };
  }, [currentFrame, mode, baselineGrid]);

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
        {/* row 0 = physical BACK → renders along the top edge */}
        <div className="text-center text-xs font-medium text-muted-foreground">Back</div>
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
                pixelScores={pixelScores}
                hiddenPixels={hiddenPixels}
              />
            </Canvas>
          </div>
          <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
            Right
          </div>
        </div>
        {/* row 7 = physical FRONT (operator side) → bottom edge */}
        <div className="text-center text-xs font-medium text-muted-foreground">Front</div>
      </div>

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "rise" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode((m) => (m === "rise" ? "absolute" : "rise"))}
          >
            {mode === "rise" ? "Rise from session start" : "Absolute distance"}
          </Button>
          {selectedPixels && selectedPixels.size > 0 && selectedPixels.size < 64 && (
            <Button
              variant={hideNonDough ? "default" : "outline"}
              size="sm"
              onClick={() => setHideNonDough((v) => !v)}
            >
              {hideNonDough ? "Showing dough only" : "Hide non-dough pixels"}
            </Button>
          )}
        </div>
        <Label className="text-[10px] text-muted-foreground">
          color: pixel relevance score (orange = tracking dough, blue = wall/noise)
        </Label>
      </div>
    </div>
  );
}
