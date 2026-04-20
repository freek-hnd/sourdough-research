import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface AnomalyEvent {
  id: string;
  station_id: number | null;
  event_name: string;
  occurred_at: string;
  value: string | null;
  notes: string | null;
}

/**
 * Returns recent ESP32 diagnostic *anomaly* events (not periodic/boot/heartbeat).
 * These are the signals that tell us the firmware detected something wrong
 * — even when the 10-minute fallback successfully kept measurements flowing.
 *
 * Without this view, fallback-recovered incidents are invisible in the
 * dashboard: the data keeps arriving, so you'd never know the station
 * briefly wedged. That's exactly what we need to catch to fix the root
 * cause.
 */
export function useStationAnomalies(hours = 24) {
  return useQuery({
    queryKey: ["station_anomalies", hours],
    queryFn: async () => {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("events")
        .select("id, station_id, event_name, occurred_at, value, notes")
        .like("event_name", "diag_%")
        .neq("event_name", "diag_periodic")
        .neq("event_name", "diag_boot")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AnomalyEvent[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Human-readable label for a diag_ event_name. */
export function anomalyLabel(eventName: string): string {
  const reason = eventName.replace(/^diag_/, "");
  const map: Record<string, string> = {
    time_invalid: "Clock invalid (pre-2024)",
    time_stuck: "Clock frozen",
    time_backwards: "Clock went backwards",
    time_jumped_forward: "Clock jumped forward",
    alignment_wedged: "Measurement alignment wedged",
    fallback_triggered: "Fallback publish (normal path failed)",
    ntp_resync: "NTP resynced",
    wifi_reconnect: "WiFi reconnected",
    mqtt_reconnect: "MQTT reconnected",
  };
  return map[reason] ?? reason;
}

/** Severity classification for visual styling. */
export function anomalySeverity(eventName: string): "critical" | "warn" | "info" {
  const reason = eventName.replace(/^diag_/, "");
  if (
    reason === "alignment_wedged" ||
    reason === "time_stuck" ||
    reason === "time_invalid" ||
    reason === "fallback_triggered"
  ) return "critical";
  if (
    reason === "time_backwards" ||
    reason === "time_jumped_forward"
  ) return "warn";
  return "info";
}
