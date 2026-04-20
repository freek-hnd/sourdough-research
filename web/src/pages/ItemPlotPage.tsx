import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useItem, useActiveSessionForItem, useItemEvents } from "@/hooks/useItem";
import { useMeasurements } from "@/hooks/useMeasurements";

type Range = "6h" | "12h" | "24h" | "full";

const EVENT_COLOR: Record<string, string> = {
  measurement_start: "#10b981",
  session_start: "#10b981",
  measurement_stop: "#ef4444",
  session_end: "#ef4444",
  stretch_fold: "#3b82f6",
  shape: "#a855f7",
  to_fridge: "#06b6d4",
  from_fridge: "#06b6d4",
  ph_start: "#f97316",
  ph_stop: "#f97316",
};

function eventColor(name: string): string {
  return EVENT_COLOR[name] ?? "#6b7280";
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ItemPlotPage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading: itemLoading } = useItem(shortId);
  const { data: session } = useActiveSessionForItem(item?.id);
  const { data: events } = useItemEvents(item?.id);
  const [range, setRange] = useState<Range>("full");

  // Determine the time window
  const { from, to } = useMemo(() => {
    const now = new Date();
    const endIso = session?.ended_at ?? now.toISOString();

    if (range === "full") {
      const start = session?.started_at ?? item?.created_at ?? new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      return { from: start, to: endIso };
    }

    const hours = range === "6h" ? 6 : range === "12h" ? 12 : 24;
    const start = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
    return { from: start, to: endIso };
  }, [range, session, item]);

  const { data: measurements, isLoading: measLoading } = useMeasurements(
    item?.station_id,
    from,
    to,
  );

  if (itemLoading || !item) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  if (!item.station_id) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-lg font-semibold">{item.short_id} — Plot</h1>
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          No station assigned, so there are no measurements to plot.
        </CardContent></Card>
        <Button variant="ghost" onClick={() => nav(`/item/${item.short_id}`)}>← Back</Button>
      </div>
    );
  }

  // Pre-compute chart data with numeric timestamps for ReferenceLine
  const chartData = (measurements ?? []).map((m) => ({
    t: new Date(m.measured_at).getTime(),
    tLabel: formatHHMM(m.measured_at),
    co2_ppm: m.co2_ppm,
    scd_temp_c: m.scd_temp_c ?? m.ds18b20_temp_c,
    tof_median_mm: m.tof_median_mm,
    scd_humidity_pct: m.scd_humidity_pct,
  }));

  const relevantEvents = (events ?? []).filter((e) => {
    const t = new Date(e.occurred_at).getTime();
    return t >= new Date(from).getTime() && t <= new Date(to).getTime();
  });

  return (
    <div className="space-y-4 p-4 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold">{item.short_id} — Plot</h1>
        <Link to={`/item/${item.short_id}`}>
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
      </div>

      {/* Range selector */}
      <div className="flex gap-2">
        {(["6h", "12h", "24h", "full"] as Range[]).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? "default" : "outline"}
            onClick={() => setRange(r)}
            className="flex-1"
          >
            {r === "full" ? "Full" : `Last ${r}`}
          </Button>
        ))}
      </div>

      {measLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          No measurements yet for this window.
        </CardContent></Card>
      ) : (
        <>
          <ChartCard title="CO₂ (ppm)" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => formatHHMM(new Date(v).toISOString())} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatHHMM(new Date(v as number).toISOString())} />
              <Line type="monotone" dataKey="co2_ppm" stroke="#ef4444" dot={false} strokeWidth={2} />
              {relevantEvents.map((e) => (
                <ReferenceLine
                  key={e.id}
                  x={new Date(e.occurred_at).getTime()}
                  stroke={eventColor(e.event_name)}
                  strokeDasharray="3 3"
                  label={{ value: e.event_name.slice(0, 10), fontSize: 9, fill: eventColor(e.event_name), position: "top" }}
                />
              ))}
            </LineChart>
          </ChartCard>

          <ChartCard title="Temperature (°C)" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => formatHHMM(new Date(v).toISOString())} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatHHMM(new Date(v as number).toISOString())} />
              <Line type="monotone" dataKey="scd_temp_c" stroke="#f97316" dot={false} strokeWidth={2} />
              {relevantEvents.map((e) => (
                <ReferenceLine key={e.id} x={new Date(e.occurred_at).getTime()} stroke={eventColor(e.event_name)} strokeDasharray="3 3" />
              ))}
            </LineChart>
          </ChartCard>

          <ChartCard title="Distance (mm, ToF median)" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => formatHHMM(new Date(v).toISOString())} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatHHMM(new Date(v as number).toISOString())} />
              <Line type="monotone" dataKey="tof_median_mm" stroke="#3b82f6" dot={false} strokeWidth={2} />
              {relevantEvents.map((e) => (
                <ReferenceLine key={e.id} x={new Date(e.occurred_at).getTime()} stroke={eventColor(e.event_name)} strokeDasharray="3 3" />
              ))}
            </LineChart>
          </ChartCard>

          <ChartCard title="Humidity (%)" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => formatHHMM(new Date(v).toISOString())} />
              <YAxis />
              <Tooltip labelFormatter={(v) => formatHHMM(new Date(v as number).toISOString())} />
              <Line type="monotone" dataKey="scd_humidity_pct" stroke="#06b6d4" dot={false} strokeWidth={2} />
              {relevantEvents.map((e) => (
                <ReferenceLine key={e.id} x={new Date(e.occurred_at).getTime()} stroke={eventColor(e.event_name)} strokeDasharray="3 3" />
              ))}
            </LineChart>
          </ChartCard>
        </>
      )}

      {/* Legend */}
      <Card>
        <CardContent className="p-3 text-xs">
          <div className="mb-1 font-medium">Event legend</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries({
              "measurement start / session start": "#10b981",
              "measurement stop / session end": "#ef4444",
              "fold": "#3b82f6",
              "shape": "#a855f7",
              "fridge": "#06b6d4",
              "ph": "#f97316",
              "other": "#6b7280",
            }).map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-3" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({ title, height, children }: { title: string; height: number; children: React.ReactElement }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-1 text-sm font-medium text-muted-foreground">{title}</div>
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
