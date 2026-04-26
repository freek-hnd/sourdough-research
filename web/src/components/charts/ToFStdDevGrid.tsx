/**
 * 8x8 ToF grid rendered as 3D bars.
 *
 * - Bar HEIGHT = the distance reading at the currently selected timestamp
 *   (shorter bar = closer to sensor = taller dough).
 * - Bar COLOR = std-dev of that pixel across all measurements in the
 *   session (computed once when data loads, NOT updated with the
 *   scrubber). High variance pixels = the dough surface; low variance
 *   pixels = wall or empty air.
 * - Fixed isometric camera angle, no rotation, no orbit controls.
 *
 * Below the canvas: a time scrubber range input + a "Show relative to
 * baseline" toggle that subtracts the first frame's grid from each
 * subsequent frame.
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

// Color stops: dark slate/blue (low std-dev = stable) → orange (high
// std-dev = changing). OKLab interpolation by hand would be nicer; for
// now linear RGB blend between two anchors is good enough.
const COLOR_LOW = new THREE.Color(0x1e3a5f);
const COLOR_HIGH = new THREE.Color(0xf97316);

interface BarMeshProps {
  /** Current frame distances, length 64 */
  grid: number[];
  /** Std-devs across the whole session, length 64 */
  stdDevs: number[];
  /** Std-dev value at which color saturates to COLOR_HIGH */
  stdDevMax: number;
  /** Lower bound for distance → bar height mapping (mm) */
  vMin: number;
  /** Upper bound for distance → bar height mapping (mm) */
  vMax: number;
}

function BarMesh({ grid, stdDevs, stdDevMax, vMin, vMax }: BarMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const obj = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const range = Math.max(1, vMax - vMin);

  useEffect(() => {
    if (!meshRef.current) return;
    const colors: number[] = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const raw = grid[idx];
        // Clamp to [vMin, vMax] before mapping. Direct mapping (NOT
        // inverted) so taller bar = bigger distance reading = dough
        // is shorter at that point.
        const valid = typeof raw === "number" && raw > 0 && raw < 4000;
        const v = valid ? Math.max(vMin, Math.min(vMax, raw)) : vMin;
        const h = Math.max(0.05, ((v - vMin) / range) * MAX_HEIGHT);
        const x = (c - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        const z = (r - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        obj.position.set(x, h / 2, z);
        obj.scale.set(1, h / CELL_SIZE, 1);
        obj.updateMatrix();
        meshRef.current.setMatrixAt(idx, obj.matrix);

        // Color from std-dev (NOT current value)
        const sd = stdDevs[idx] ?? 0;
        const t = stdDevMax > 0 ? Math.min(1, sd / stdDevMax) : 0;
        tmpColor.copy(COLOR_LOW).lerp(COLOR_HIGH, t);
        colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    meshRef.current.geometry.setAttribute("color", colorAttr);
  }, [grid, stdDevs, stdDevMax, vMin, vMax, range, obj, tmpColor]);

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
}

export function ToFStdDevGrid({ frames }: ToFStdDevGridProps) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [relative, setRelative] = useState(false);

  // Keep the slider position valid if the underlying data changes.
  useEffect(() => {
    if (frameIdx >= frames.length) setFrameIdx(Math.max(0, frames.length - 1));
  }, [frames.length, frameIdx]);

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

  // Distance domain for height mapping. 2-98 percentile clip.
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

  // Baseline = first frame, used when relative mode is on.
  const baseline = frames[0]?.tof_grid;

  const currentFrame = frames[frameIdx] ?? frames[0];
  const displayGrid = useMemo(() => {
    if (!currentFrame) return Array(64).fill(0);
    if (!relative || !baseline) return currentFrame.tof_grid;
    // Subtract baseline. Result can be negative (dough rose past
    // baseline). Re-anchor to vMin so heights stay positive.
    const out: number[] = [];
    for (let i = 0; i < 64; i++) {
      const cur = currentFrame.tof_grid[i];
      const base = baseline[i];
      if (
        typeof cur !== "number" || cur <= 0 ||
        typeof base !== "number" || base <= 0
      ) {
        out.push(0);
        continue;
      }
      // Difference, then re-anchor: 0 = at baseline, negative = closer
      // (taller dough), positive = further. Visualize by mapping to a
      // fresh [vMin, vMax] band centered on vMin.
      const diff = cur - base;
      out.push(Math.max(vMin, Math.min(vMax, vMin + diff + (vMax - vMin) / 2)));
    }
    return out;
  }, [currentFrame, baseline, relative, vMin, vMax]);

  if (frames.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-center text-xs text-muted-foreground">
        {currentFrame ? new Date(currentFrame.measured_at).toLocaleString() : "—"}
      </div>

      {/* Side labels around the canvas */}
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
                grid={displayGrid}
                stdDevs={stdDevs}
                stdDevMax={stdDevMax}
                vMin={vMin}
                vMax={vMax}
              />
            </Canvas>
          </div>
          <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
            Right
          </div>
        </div>
        <div className="text-center text-xs font-medium text-muted-foreground">Back</div>
      </div>

      {/* Scrubber */}
      <div className="flex items-center gap-2">
        <span className="w-10 text-right text-[10px] text-muted-foreground">
          {frameIdx + 1}/{frames.length}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={frameIdx}
          onChange={(e) => setFrameIdx(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant={relative ? "default" : "outline"}
          size="sm"
          onClick={() => setRelative((r) => !r)}
        >
          {relative ? "Relative to baseline" : "Show relative to baseline"}
        </Button>
        <Label className="text-[10px] text-muted-foreground">
          color: per-pixel std-dev (orange = changing, blue = stable)
        </Label>
      </div>
    </div>
  );
}
