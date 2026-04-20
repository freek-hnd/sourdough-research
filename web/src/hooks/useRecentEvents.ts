import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useRecentEvents(limit = 10) {
  return useQuery({
    queryKey: ["events", "recent", limit],
    queryFn: async () => {
      // Hide heartbeat and periodic diag noise from the dashboard feed.
      // Anomalous diag events (diag_time_stuck, diag_alignment_wedged, etc.)
      // DO show up so they catch the eye during an incident.
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .neq("event_name", "heartbeat")
        .neq("event_name", "diag_periodic")
        .neq("event_name", "diag_boot")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
