/**
 * 8x8 ToF heatmap visualization.
 *
 * Color scale: low distance (close = dough surface) → warm (amber/orange),
 * high distance (far = beaker wall/air) → cool (blue).
 *
 * Orientation (verified by calibration):
 *   - row 0 = physical BACK of the setup → rendered at the top
 *   - row 7 = physical FRONT (operator side) → rendered at the bottom
 *   - col 0 = LEFT, col 7 = RIGHT
 * The data path firmware → MQTT → Pi SQLite → Supabase preserves
 * row-major order, so what we render top-down is back→front and the
 * labels say so.
 */

interface TofHeatmapProps {
  grid: number[];
  median?: number | null;
  min?: number | null;
  max?: number | null;
}

function distanceColor(d: number, minD: number, maxD: number): string {
  if (d <= 0) return "oklch(0.25 0 0)"; // invalid → dark gray
  // Normalize into [0,1]. Low = warm (close/surface), high = cool (far).
  const range = Math.max(1, maxD - minD);
  const t = Math.max(0, Math.min(1, (d - minD) / range));
  // Interpolate hue: 30 (amber) → 220 (blue).
  const hue = 30 + t * 190;
  return `oklch(0.65 0.18 ${hue})`;
}

export function TofHeatmap({ grid, median, min, max }: TofHeatmapProps) {
  if (!grid || grid.length !== 64) {
    return (
      <div className="text-sm text-muted-foreground">No ToF grid data</div>
    );
  }

  const valid = grid.filter((d) => d > 0);
  const minD = valid.length > 0 ? Math.min(...valid) : 0;
  const maxD = valid.length > 0 ? Math.max(...valid) : 1;

  return (
    <div className="space-y-2">
      {/* Top label = row 0 = physical BACK */}
      <div className="text-center text-xs font-medium text-muted-foreground">Back</div>

      <div className="flex items-center gap-2">
        {/* Left label */}
        <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">
          Left
        </div>

        {/* 8x8 grid */}
        <div className="grid aspect-square w-full grid-cols-8 gap-0.5 rounded-md bg-muted p-1">
          {grid.map((d, i) => (
            <div
              key={i}
              className="aspect-square rounded-sm flex items-center justify-center text-[9px] font-mono text-white/90"
              style={{ backgroundColor: distanceColor(d, minD, maxD) }}
              title={`Zone ${i}: ${d} mm`}
            >
              {d > 0 ? d : "—"}
            </div>
          ))}
        </div>

        {/* Right label */}
        <div className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
          Right
        </div>
      </div>

      {/* Bottom label = row 7 = physical FRONT (operator side) */}
      <div className="text-center text-xs font-medium text-muted-foreground">Front</div>

      {/* Stats */}
      <div className="flex justify-around text-sm">
        <div><span className="text-muted-foreground">Min:</span> {min ?? minD} mm</div>
        <div><span className="text-muted-foreground">Median:</span> {median ?? "—"} mm</div>
        <div><span className="text-muted-foreground">Max:</span> {max ?? maxD} mm</div>
      </div>
    </div>
  );
}
