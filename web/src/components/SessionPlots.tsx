/**
 * SessionPlots — unified time-series view for a station × time window.
 *
 * Used on the item detail / station detail / sessions pages so the
 * chart UI is consistent across the app.
 *
 * Renders a range selector → 4 stacked line charts → optional ToF 3D
 * grid below. When `sessionId` is provided, fetches that session's
 * events and overlays vertical reference lines on every chart.
 */

import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useItemEvents, useSessionEvents } from "@/hooks/useItem";

export interface SessionPlotsProps {
  stationId: number;
  /** ISO timestamp — when the session started. Used as the lower bound
   *  for "Since session start". Required for the range selector. */
  startedAt: string;
  /** ISO timestamp — when the session ended, or null/undefined for an
   *  open session (in which case "now" is used). */
  endedAt: string | null;
  /** When set, render a red dashed reference line on every chart at
   *  this timestamp labeled "suggested end". */
  suggestedEndAt?: string | null;
  /** When set, fetch the session's events and overlay them as vertical
   *  reference lines on each chart. */
  sessionId?: string;
  /** Override the item id used to fetch events. Falls back to using
   *  sessionId-based lookup via useItemEvents. */
  itemId?: string;
}

type RangeKey = "6h" | "24h" | "session_start" | "full";

// Event styling per the spec.
const EVENT_STYLE: Record<string, { stroke: string; label: string }> = {
  measurement_start: { stroke: "#22c55e", label: "▶" },
  measurement_stop: { stroke: "#ef4444", label: "⏹" },
  session_end: { stroke: "#ef4444", label: "end" },
  stretch_fold: { stroke: "#3b82f6", label: "fold" },
  shape: { stroke: "#a855f7", label: "shape" },
  to_fridge: { stroke: "#06b6d4", label: "→❄" },
  from_fridge: { stroke: "#06b6d4", label: "←❄" },
  ph_record_start: { stroke: "#f97316", label: "pH▶" },
  ph_record_stop: { stroke: "#f97316", label: "pH⏹" },
  station_adjusted: { stroke: "#eab308", label: "⚠" },
  station_adjusted_horizontal: { stroke: "#eab308", label: "⚠H" },
  station_adjusted_vertical: { stroke: "#eab308", label: "⚠V" },
};

function styleFor(eventName: string) {
  return EVENT_STYLE[eventName] ?? { stroke: "#6b7280", label: eventName.slice(0, 8) };
}

function formatXAxisTick(value: number, sessionStartMs: number): string {
  const d = new Date(value);
  const dayDiff = Math.floor((d.getTime() - sessionStartMs) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return dayDiff > 0 ? `+${dayDiff}d ${hh}:${mm}` : `${hh}:${mm}`;
}

export function SessionPlots({
  stationId,
  startedAt,
  endedAt,
  suggestedEndAt,
  sessionId,
  itemId,
}: SessionPlotsProps) {
  const sessionEnded = !!endedAt;
  const [range, setRange] = useState<RangeKey>(sessionEnded ? "full" : "session_start");

  // Resolve the actual time window from the selected range.
  const { from, to } = useMemo(() => {
    const startedMs = new Date(startedAt).getTime();
    const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();

    if (range === "full") {
      return {
        from: startedAt,
        to: endedAt ?? new Date(endMs).toISOString(),
      };
    }
    if (range === "session_start") {
      return {
        from: startedAt,
        to: endedAt ?? new Date(endMs).toISOString(),
      };
    }
    const hours = range === "6h" ? 6 : 24;
    const fromMs = Math.max(startedMs, endMs - hours * 3600 * 1000);
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(endMs).toISOString(),
    };
  }, [range, startedAt, endedAt]);

  const { data: rows, isLoading } = useMeasurements(stationId, from, to);
  // Events: prefer querying by session_id (cheaper, exact). Fall back
  // to item-scoped events if only itemId is given. Both hooks short-
  // circuit when their argument is undefined, so this is safe.
  const sessionEvents = useSessionEvents(sessionId);
  const itemEvents = useItemEvents(sessionId ? undefined : itemId);
  const eventsData = sessionId ? sessionEvents.data : itemEvents.data;

  const sessionStartMs = new Date(startedAt).getTime();

  // Click-to-pin timestamp shared across all four charts AND the ToF
  // 3D grid. Clicking any chart sets it; the ToF scrubber jumps to the
  // matching frame; recharts' syncId="session" already syncs hover
  // tooltips for free.
  const [selectedTs, setSelectedTs] = useState<number | null>(null);

  // Recharts onClick handler — pulls the X coordinate of the clicked
  // point out of the chart state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = useCallback((state: any) => {
    if (state && typeof state.activeLabel === "number") {
      setSelectedTs(state.activeLabel);
    }
  }, []);

  // Baseline = first valid ToF reading in the visible window. Used to
  // convert raw distance into "rise from baseline" so dough rising
  // shows as the line GOING UP, with the starting point at zero — the
  // mental model the user works with at the bench.
  const baselineMm = useMemo(() => {
    for (const r of rows ?? []) {
      if (typeof r.tof_median_mm === "number" && r.tof_median_mm > 0) {
        return r.tof_median_mm;
      }
    }
    return null;
  }, [rows]);

  // Pre-compute tof_rise_cm per row. Positive when dough has risen
  // above baseline, negative when it's lower. cm because mm is too
  // noisy for a kitchen-scale chart.
  const chartData = useMemo(() => {
    if (!rows) return [];
    return rows.map((r) => ({
      ...r,
      tof_rise_cm:
        baselineMm != null &&
        typeof r.tof_median_mm === "number" &&
        r.tof_median_mm > 0
          ? (baselineMm - r.tof_median_mm) / 10
          : null,
    }));
  }, [rows, baselineMm]);

  // Filter events to the visible window AND drop heartbeat / diag
  // noise so chart annotations stay readable.
  const events = useMemo(() => {
    if (!eventsData) return [];
    const fromMs = new Date(from).getTime();
    const toMs = to ? new Date(to).getTime() : Date.now();
    return eventsData.filter((e) => {
      if (!e.event_name) return false;
      if (e.event_name === "heartbeat") return false;
      if (e.event_name.startsWith("diag_")) return false;
      const t = new Date(e.occurred_at).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [eventsData, from, to]);

  const suggestedMs = suggestedEndAt ? new Date(suggestedEndAt).getTime() : null;

  return (
    <div className="space-y-3">
      {/* Range selector */}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={range === "6h" ? "default" : "outline"}
          onClick={() => setRange("6h")}
        >Last 6h</Button>
        <Button
          size="sm"
          variant={range === "24h" ? "default" : "outline"}
          onClick={() => setRange("24h")}
        >Last 24h</Button>
        <Button
          size="sm"
          variant={range === "session_start" ? "default" : "outline"}
          onClick={() => setRange("session_start")}
        >Since session start</Button>
        <Button
          size="sm"
          variant={range === "full" ? "default" : "outline"}
          onClick={() => setRange("full")}
        >Full session</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No measurements in this window.
        </div>
      ) : (
        <>
          <ChartCard title="CO₂ (ppm)" height={200}>
            <LineChart data={chartData} syncId="session" onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts_num"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
              />
              <Line type="monotone" dataKey="co2_ppm" stroke="#f59e0b" dot={false} strokeWidth={2} />
              <EventLines events={events} />
              <PinLine ts={selectedTs} />
              {suggestedMs && (
                <ReferenceLine
                  x={suggestedMs}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{ value: "suggested end", fontSize: 10, fill: "#ef4444", position: "top" }}
                />
              )}
            </LineChart>
          </ChartCard>

          <ChartCard title="Temperature (°C)" height={200}>
            <LineChart data={chartData} syncId="session" onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts_num"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="scd_temp_c" name="SCD41" stroke="#ef4444" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="ds18b20_temp_c" name="DS18B20" stroke="#fb923c" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
              <EventLines events={events} />
              <PinLine ts={selectedTs} />
              {suggestedMs && (
                <ReferenceLine x={suggestedMs} stroke="#ef4444" strokeDasharray="4 4" />
              )}
            </LineChart>
          </ChartCard>

          <ChartCard
            title="Rise (cm)"
            subtitle="↑ taller dough · 0 = session start"
            height={200}
          >
            <LineChart data={chartData} syncId="session" onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts_num"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
                formatter={(v) =>
                  typeof v === "number" ? [`${v.toFixed(1)} cm`, "Rise"] : [v, "Rise"]
                }
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
              <Line type="monotone" dataKey="tof_rise_cm" stroke="#818cf8" dot={false} strokeWidth={2} />
              <EventLines events={events} />
              <PinLine ts={selectedTs} />
              {suggestedMs && (
                <ReferenceLine x={suggestedMs} stroke="#ef4444" strokeDasharray="4 4" />
              )}
            </LineChart>
          </ChartCard>

          <ChartCard title="Humidity (%)" height={200}>
            <LineChart data={chartData} syncId="session" onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts_num"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v) => formatXAxisTick(v as number, sessionStartMs)}
              />
              <Line type="monotone" dataKey="scd_humidity_pct" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <EventLines events={events} />
              <PinLine ts={selectedTs} />
              {suggestedMs && (
                <ReferenceLine x={suggestedMs} stroke="#ef4444" strokeDasharray="4 4" />
              )}
            </LineChart>
          </ChartCard>

          <ToFGridSection
            rows={chartData}
            selectedTs={selectedTs}
            onSelectTs={setSelectedTs}
          />
        </>
      )}
    </div>
  );
}

/** Vertical click-to-pin marker shared across all four charts. */
function PinLine({ ts }: { ts: number | null }) {
  if (ts == null) return null;
  return (
    <ReferenceLine
      x={ts}
      stroke="#0f172a"
      strokeOpacity={0.5}
      strokeWidth={1.5}
    />
  );
}

// Helper sub-component: render reference lines for events. Returning a
// fragment of <ReferenceLine> elements so recharts picks them up via
// children traversal. Recharts requires these to be direct children of
// the chart, not wrapped in an arbitrary component, but in practice
// returning a fragment works because React flattens it.
function EventLines({
  events,
}: {
  events: Array<{ id: string; event_name: string; occurred_at: string }>;
}) {
  return (
    <>
      {events.map((e) => {
        const s = styleFor(e.event_name);
        return (
          <ReferenceLine
            key={e.id}
            x={new Date(e.occurred_at).getTime()}
            stroke={s.stroke}
            strokeDasharray="3 3"
            label={{
              value: s.label,
              fontSize: 9,
              fill: s.stroke,
              position: "top",
            }}
          />
        );
      })}
    </>
  );
}

function ChartCard({
  title,
  subtitle,
  height,
  children,
}: {
  title: string;
  subtitle?: string;
  height: number;
  children: React.ReactElement;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="text-[10px] text-muted-foreground">{subtitle}</div>
        )}
      </div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

// Lazy-import the std-dev grid here so callers that don't need it (or
// runs without any ToF data) don't pay for Three.js.
import { ToFStdDevGrid } from "@/components/charts/ToFStdDevGrid";

function ToFGridSection({
  rows,
  selectedTs,
  onSelectTs,
}: {
  rows: Array<{ measured_at: string; ts_num: number; tof_grid: number[] | null }>;
  selectedTs: number | null;
  onSelectTs: (ts: number | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const frames = useMemo(
    () =>
      rows
        .filter((r): r is { measured_at: string; ts_num: number; tof_grid: number[] } =>
          Array.isArray(r.tof_grid) && r.tof_grid.length === 64,
        )
        .map((r) => ({
          measured_at: r.measured_at,
          ts_num: r.ts_num,
          tof_grid: r.tof_grid,
        })),
    [rows],
  );

  if (frames.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <span>ToF grid ({frames.length} frames)</span>
        <span className="text-[10px]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="p-3 pt-0">
          <ToFStdDevGrid
            frames={frames}
            selectedTs={selectedTs}
            onSelectTs={onSelectTs}
          />
        </div>
      )}
    </div>
  );
}
