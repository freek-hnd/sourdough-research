import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Pause, Play } from "lucide-react";
import type { ChartMeasurement } from "@/hooks/useSessionChartData";

const GRID = 8;
const CELL_SIZE = 0.4;
const GAP = 0.05;
const MAX_HEIGHT = 4;

function ToFGrid({ grid, vMin, vMax }: { grid: number[]; vMin: number; vMax: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const range = vMax - vMin || 1;

  useEffect(() => {
    if (!meshRef.current) return;
    const colors: number[] = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const raw = grid[idx] ?? 0;
        const v = raw > 0 ? raw : vMax;
        // Invert: closer (smaller distance) = taller
        const h = Math.max(0.05, (1 - (v - vMin) / range) * MAX_HEIGHT);
        const x = (c - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        const z = (r - GRID / 2 + 0.5) * (CELL_SIZE + GAP);
        tempObj.position.set(x, h / 2, z);
        tempObj.scale.set(1, h / CELL_SIZE, 1);
        tempObj.updateMatrix();
        meshRef.current.setMatrixAt(idx, tempObj.matrix);
        // Viridis-ish color
        const t = Math.max(0, Math.min(1, 1 - (v - vMin) / range));
        colors.push(
          t < 0.5 ? 0.27 + t * 2 * -0.1 : 0.17 + (t - 0.5) * 2 * 0.82,
          t < 0.5 ? 0.004 + t * 2 * 0.51 : 0.514 + (t - 0.5) * 2 * 0.39,
          t < 0.5 ? 0.33 + t * 2 * 0.14 : 0.47 + (t - 0.5) * 2 * -0.33,
        );
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    meshRef.current.geometry.setAttribute("color", colorAttr);
  }, [grid, vMin, vMax, tempObj, range]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, GRID * GRID]}>
      <boxGeometry args={[CELL_SIZE, CELL_SIZE, CELL_SIZE]} />
      <meshStandardMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function AutoRotate() {
  useFrame(({ camera }) => {
    // no-op: orbit controls handles it
    void camera;
  });
  return null;
}

interface ToFViewerProps {
  data: ChartMeasurement[];
  selectedTs: number | null;
  onSelectTs: (ts: number | null) => void;
}

export function ToFViewer({ data, selectedTs, onSelectTs }: ToFViewerProps) {
  const framesWithGrid = useMemo(
    () => data.filter((r) => r.tof_grid && r.tof_grid.length === 64),
    [data],
  );

  const { vMin, vMax } = useMemo(() => {
    const all: number[] = [];
    for (const f of framesWithGrid) {
      for (const v of f.tof_grid!) {
        if (v > 0) all.push(v);
      }
    }
    if (!all.length) return { vMin: 0, vMax: 1 };
    all.sort((a, b) => a - b);
    return {
      vMin: all[Math.floor(all.length * 0.02)],
      vMax: all[Math.floor(all.length * 0.98)],
    };
  }, [framesWithGrid]);

  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Sync frame to selectedTs from chart crosshair
  useEffect(() => {
    if (selectedTs && framesWithGrid.length > 0) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < framesWithGrid.length; i++) {
        const dist = Math.abs(framesWithGrid[i].ts_num - selectedTs);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      setFrameIdx(best);
    }
  }, [selectedTs, framesWithGrid]);

  // Play/pause loop
  useEffect(() => {
    if (playing && framesWithGrid.length > 1) {
      intervalRef.current = setInterval(() => {
        setFrameIdx((prev) => {
          const next = (prev + 1) % framesWithGrid.length;
          onSelectTs(framesWithGrid[next].ts_num);
          return next;
        });
      }, 600);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, framesWithGrid, onSelectTs]);

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = Number(e.target.value);
      setFrameIdx(idx);
      if (framesWithGrid[idx]) onSelectTs(framesWithGrid[idx].ts_num);
    },
    [framesWithGrid, onSelectTs],
  );

  if (!framesWithGrid.length) return null;

  const currentFrame = framesWithGrid[frameIdx] ?? framesWithGrid[0];
  const grid = currentFrame.tof_grid!;

  return (
    <div className="space-y-2">
      <div className="px-1 text-xs uppercase tracking-wider text-muted-foreground">ToF 3D Surface</div>
      <div className="text-center text-xs text-muted-foreground">
        {new Date(currentFrame.measured_at).toLocaleString()}
      </div>
      <div className="h-[300px] w-full overflow-hidden rounded-lg border border-border bg-card">
        <Canvas camera={{ position: [4, 5, 4], fov: 45 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 10, 5]} intensity={0.8} />
          <ToFGrid grid={grid} vMin={vMin} vMax={vMax} />
          <OrbitControls enablePan={false} />
          <AutoRotate />
        </Canvas>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => setPlaying((p) => !p)}
          className="h-8 w-8 p-0"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <input
          type="range" min={0} max={framesWithGrid.length - 1}
          value={frameIdx} onChange={handleSlider}
          className="flex-1 accent-primary"
        />
        <span className="w-16 text-right text-xs text-muted-foreground">
          {frameIdx + 1}/{framesWithGrid.length}
        </span>
      </div>
    </div>
  );
}
