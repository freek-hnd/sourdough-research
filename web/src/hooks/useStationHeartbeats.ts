import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Returns a map of station_id -> last heartbeat ISO timestamp.
 * Stations without any heartbeat are absent from the map.
 *
 * Heartbeats are logged by ESP32 stations once per minute (see firmware
 * publishHeartbeat). Refreshed every 60s to keep the dashboard current.
 */
export function useStationHeartbeats() {
  return useQuery({
    queryKey: ["station_heartbeats"],
    queryFn: async () => {
      // Pull the last N heartbeat events. 500 is plenty for a handful of stations.
      const { data, error } = await supabase
        .from("events")
        .select("station_id, occurred_at")
        .eq("event_name", "heartbeat")
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      // Fold into the most-recent per station_id.
      const map = new Map<number, string>();
      for (const row of data ?? []) {
        if (row.station_id == null) continue;
        if (!map.has(row.station_id)) {
          map.set(row.station_id, row.occurred_at);
        }
      }
      return map;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export type HeartbeatStatus = "green" | "orange" | "red";

/** Classify a station as green/orange/red based on heartbeat age. */
export function heartbeatStatus(lastHeartbeatAt: string | undefined): HeartbeatStatus {
  if (!lastHeartbeatAt) return "red";
  const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (ageMs < 15 * 60 * 1000) return "green";
  if (ageMs < 30 * 60 * 1000) return "orange";
  return "red";
}
