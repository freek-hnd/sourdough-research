import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { SessionCharts } from "@/components/charts/SessionCharts";

const RANGES = [
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

export function StationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rangeLabel = searchParams.get("range") ?? "24h";
  const rangeHours = RANGES.find((r) => r.label === rangeLabel)?.hours ?? 24;

  const stationId = Number(id);

  const { data: station, isLoading } = useQuery({
    queryKey: ["station", stationId],
    enabled: !isNaN(stationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stations")
        .select("*")
        .eq("id", stationId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading || !station) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;

  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - rangeHours * 3600_000).toISOString();

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{station.label}</h1>
          <p className="text-sm text-muted-foreground">Station #{station.id} — {station.device_type}</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.label}
              variant={rangeLabel === r.label ? "default" : "outline"}
              size="sm"
              onClick={() => setSearchParams({ range: r.label })}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>
      <SessionCharts stationId={stationId} startTime={startTime} endTime={endTime} />
    </div>
  );
}
