import { useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionChartData } from "@/hooks/useSessionChartData";
import { ToFViewer } from "@/components/charts/ToFViewer";

const COLORS = {
  co2: "#f59e0b",
  scd_temp: "#ef4444",
  ds18b20: "#fb923c",
  humidity: "#38bdf8",
  ph: "#34d399",
  tof: "#818cf8",
};

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; color: string; name: string; value: number }>; label?: number }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded border border-border bg-card p-2 text-xs shadow-lg">
      <div className="mb-1 text-muted-foreground">{fmtDateTime(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value != null ? Number(p.value).toFixed(1) : "—"}
        </div>
      ))}
    </div>
  );
}

interface ChartPanelProps {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  lines: Array<{ key: string; color: string; name: string }>;
  selectedTs: number | null;
  onSelect: (ts: number | null) => void;
  height?: number;
  yDomain?: [number | string, number | string];
}

function ChartPanel({ title, data, lines, selectedTs, onSelect, height = 140, yDomain }: ChartPanelProps) {
  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state: any) => {
      if (state?.activeLabel) onSelect(state.activeLabel as number);
    },
    [onSelect],
  );

  return (
    <div className="space-y-1">
      <div className="px-1 text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId="session" onClick={handleClick}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="ts_num" type="number" domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTime} scale="time"
            tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
          />
          <YAxis
            domain={yDomain ?? ["auto", "auto"]} width={46}
            tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          {selectedTs && <ReferenceLine x={selectedTs} stroke="hsl(var(--ring))" strokeWidth={1} strokeOpacity={0.5} />}
          {lines.map(({ key, color, name }) => (
            <Line key={key} type="monotone" dataKey={key} name={name} stroke={color}
              strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SessionChartsProps {
  stationId: number;
  startTime: string;
  endTime?: string;
}

export function SessionCharts({ stationId, startTime, endTime }: SessionChartsProps) {
  const { measurements, phReadings } = useSessionChartData(stationId, startTime, endTime);
  const [selectedTs, setSelectedTs] = useState<number | null>(null);

  const mData = measurements.data ?? [];
  const phData = phReadings.data ?? [];
  const hasPh = phData.some((r) => r.ph != null);

  if (measurements.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!mData.length) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No measurement data for this time range.</div>;
  }

  return (
    <div className="space-y-2">
      <ChartPanel
        title="Temperature (°C)"
        data={mData}
        lines={[
          { key: "scd_temp_c", color: COLORS.scd_temp, name: "SCD41" },
          { key: "ds18b20_temp_c", color: COLORS.ds18b20, name: "DS18B20" },
        ]}
        selectedTs={selectedTs} onSelect={setSelectedTs}
        height={150}
      />
      <ChartPanel
        title="Humidity (%)"
        data={mData}
        lines={[{ key: "scd_humidity_pct", color: COLORS.humidity, name: "RH" }]}
        selectedTs={selectedTs} onSelect={setSelectedTs}
        height={110}
      />
      <ChartPanel
        title="CO₂ (ppm)"
        data={mData}
        lines={[{ key: "co2_ppm", color: COLORS.co2, name: "CO₂" }]}
        selectedTs={selectedTs} onSelect={setSelectedTs}
        height={130}
      />
      {hasPh && (
        <ChartPanel
          title="pH"
          data={phData}
          lines={[{ key: "ph", color: COLORS.ph, name: "pH" }]}
          yDomain={[0, 14]}
          selectedTs={selectedTs} onSelect={setSelectedTs}
          height={110}
        />
      )}
      <ChartPanel
        title="ToF Rise (mm)"
        data={mData}
        lines={[{ key: "tof_median_mm", color: COLORS.tof, name: "Median" }]}
        selectedTs={selectedTs} onSelect={setSelectedTs}
        height={130}
      />
      <ToFViewer
        data={mData}
        selectedTs={selectedTs}
        onSelectTs={setSelectedTs}
      />
    </div>
  );
}
