/**
 * Volume-over-time chart. Computes ml at render time from raw tof_grid
 * + the station/jar/session calibration triple. Two lines:
 *
 *   solid  — volume_mean_ml   (primary)
 *   dashed — volume_median_ml (sanity check; if it diverges from mean,
 *                              there's a small number of outlier pixels
 *                              dragging the mean — worth a look)
 *
 * Renders nothing (a hint card) when calibration is incomplete; we'd
 * rather show "missing X" than an empty silent chart.
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
  computeVolume,
  type CalibJar,
  type CalibSession,
  type CalibStation,
} from "@/lib/volumeCalculation";

interface MeasurementForVolume {
  measured_at: string;
  ts_num: number;
  tof_grid: number[] | null;
}

export interface VolumeOverTimeProps {
  measurements: ReadonlyArray<MeasurementForVolume>;
  station: CalibStation | null | undefined;
  jar: CalibJar | null | undefined;
  session: CalibSession | null | undefined;
}

function formatXAxisTick(value: number, sessionStartMs: number): string {
  const d = new Date(value);
  const dayDiff = Math.floor((d.getTime() - sessionStartMs) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return dayDiff > 0 ? `+${dayDiff}d ${hh}:${mm}` : `${hh}:${mm}`;
}

function missingFields(
  station: CalibStation | null | undefined,
  jar: CalibJar | null | undefined,
  session: CalibSession | null | undefined,
): string[] {
  const out: string[] = [];
  if (!station) {
    out.push("station calibration");
  } else {
    if (!station.wall_pixel_mask) out.push("station.wall_pixel_mask");
    const hasLinear =
      station.pixel_slope &&
      station.pixel_intercept &&
      station.pixel_slope.length === 64 &&
      station.pixel_intercept.length === 64;
    const hasBaseline =
      station.baseline_grid &&
      station.baseline_grid.length === 64 &&
      station.baseline_height_mm != null;
    if (!hasLinear && !hasBaseline) {
      out.push("station calibration model (slopes or baseline_grid)");
    }
  }
  if (!jar) out.push("session.jar_id");
  else if (jar.cross_section_area_cm2 == null) {
    out.push("jar.cross_section_area_cm2");
  }
  if (!session) out.push("session setup");
  else if (session.setup_height_mm == null) {
    out.push("session.setup_height_mm");
  }
  return out;
}

export function VolumeOverTime({
  measurements,
  station,
  jar,
  session,
}: VolumeOverTimeProps) {
  const missing = missingFields(station, jar, session);

  const data = useMemo(() => {
    if (missing.length > 0 || !station || !jar || !session) return [];
    return measurements.map((m) => {
      const grid = m.tof_grid;
      const result =
        Array.isArray(grid) && grid.length === 64
          ? computeVolume(grid, station, jar, session)
          : {
              volume_mean_ml: null,
              volume_median_ml: null,
              n_active_pixels: 0,
              mean_delta_mm: null,
              median_delta_mm: null,
            };
      return {
        ts_num: m.ts_num,
        volume_mean_ml: result.volume_mean_ml,
        volume_median_ml: result.volume_median_ml,
        n_active_pixels: result.n_active_pixels,
      };
    });
  }, [measurements, station, jar, session, missing.length]);

  const sessionStartMs = useMemo(() => {
    if (data.length === 0) return Date.now();
    return data[0].ts_num;
  }, [data]);

  if (missing.length > 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="font-medium text-muted-foreground">
            Volume calculation not available
          </div>
          <div className="text-xs text-muted-foreground">
            Missing: {missing.join(", ")}.
          </div>
          <div className="text-xs text-muted-foreground">
            Open the session edit form to add the missing setup info.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          No measurements in window to compute volume.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Volume (ml)
        </div>
        <div className="text-[10px] text-muted-foreground">
          solid = mean · dashed = median
        </div>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={data} syncId="session">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="ts_num"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10 }}
              label={{ value: "ml", angle: -90, position: "insideLeft", fontSize: 10 }}
            />
            <Tooltip
              labelFormatter={(v) =>
                formatXAxisTick(v as number, sessionStartMs)
              }
              formatter={(val, key) => {
                if (typeof val !== "number") return [val, key];
                if (key === "volume_mean_ml") return [`${val.toFixed(1)} ml`, "Mean"];
                if (key === "volume_median_ml") return [`${val.toFixed(1)} ml`, "Median"];
                if (key === "n_active_pixels") return [val, "Active pixels"];
                return [val, key];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="volume_mean_ml"
              name="Mean"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="volume_median_ml"
              name="Median"
              stroke="#10b981"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              strokeOpacity={0.7}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
