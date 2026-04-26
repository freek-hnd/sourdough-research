import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { SessionPlots } from "@/components/SessionPlots";

/**
 * Station detail = sensor history view for a single station.
 *
 * Now uses the unified SessionPlots component so the chart UI is the
 * same as on the Sessions page and item detail. Time range options
 * (6h / 24h / Since session start / Full session) live inside
 * SessionPlots, so this page just decides what `startedAt` to feed it.
 *
 * Without an associated session, "Since session start" doesn't have a
 * meaningful anchor — we fall back to "24h ago" for the lower bound,
 * and SessionPlots' user-visible options will still let the user pick
 * 6h / 24h / Full (= same as 24h here).
 */

const FALLBACK_HOURS = 24;

export function StationDetailPage() {
  const { id } = useParams<{ id: string }>();
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

  if (isLoading || !station) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  // Anchor "Since session start" to N hours ago. The user can pick
  // shorter or longer ranges via the in-component selector.
  const startedAt = new Date(Date.now() - FALLBACK_HOURS * 3600 * 1000).toISOString();

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">{station.label}</h1>
        <p className="text-sm text-muted-foreground">
          Station #{station.id} — {station.device_type}
        </p>
      </div>
      <SessionPlots
        stationId={stationId}
        startedAt={startedAt}
        endedAt={null}
      />
    </div>
  );
}
