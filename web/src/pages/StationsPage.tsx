import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";

export function StationsPage() {
  const navigate = useNavigate();
  const { data: stations, isLoading } = useQuery({
    queryKey: ["stations", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stations")
        .select("*")
        .eq("is_active", true)
        .order("id");
      if (error) throw error;

      // Fetch latest measurement per station
      const stationIds = (data ?? []).map((s) => s.id);
      if (!stationIds.length) return [];

      const results = await Promise.all(
        stationIds.map(async (sid) => {
          const { data: latest } = await supabase
            .from("measurements")
            .select("measured_at")
            .eq("station_id", sid)
            .order("measured_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { station_id: sid, last_measured: latest?.measured_at ?? null };
        }),
      );
      const lastMap = new Map(results.map((r) => [r.station_id, r.last_measured]));

      return (data ?? []).map((s) => ({
        ...s,
        last_measured: lastMap.get(s.id) ?? null,
      }));
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Stations</h1>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !stations?.length ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No active stations.</CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Label</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Last measurement</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                    onClick={() => navigate(`/stations/${s.id}`)}
                  >
                    <td className="px-4 py-2 font-mono">{s.id}</td>
                    <td className="px-4 py-2 font-medium">{s.label}</td>
                    <td className="px-4 py-2"><Badge variant="outline">{s.device_type}</Badge></td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.last_measured ? new Date(s.last_measured).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
