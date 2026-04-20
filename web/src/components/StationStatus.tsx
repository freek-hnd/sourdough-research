import {
  useStationHeartbeats,
  heartbeatStatus,
  type HeartbeatStatus,
} from "@/hooks/useStationHeartbeats";
import { useStationAnomalies } from "@/hooks/useStationAnomalies";

const DOT_CLASS: Record<HeartbeatStatus, string> = {
  green: "bg-emerald-500",
  orange: "bg-amber-500",
  red: "bg-rose-500",
};

const LABEL: Record<HeartbeatStatus, string> = {
  green: "Online",
  orange: "Stale",
  red: "Offline",
};

/**
 * Colored status dot next to a station identifier.
 *
 * Heartbeat freshness drives the base color (green/orange/red). On top
 * of that, if the station has had an anomaly event in the last 24h, the
 * dot gets a pulsing amber ring so you can see at a glance that
 * something went wrong — even if the 10-min fallback kept measurements
 * flowing and the heartbeat is still green.
 */
export function StationStatusDot({
  stationId,
  showLabel = false,
}: {
  stationId: number;
  showLabel?: boolean;
}) {
  const { data: heartbeats } = useStationHeartbeats();
  const { data: anomalies } = useStationAnomalies(24);
  const lastAt = heartbeats?.get(stationId);
  const status = heartbeatStatus(lastAt);
  const anomalyCount = (anomalies ?? []).filter(
    (a) => a.station_id === stationId,
  ).length;
  const hasRecentAnomaly = anomalyCount > 0;

  const title = [
    lastAt
      ? `Last heartbeat: ${new Date(lastAt).toLocaleString()}`
      : "No heartbeat ever",
    hasRecentAnomaly
      ? `${anomalyCount} anomaly event(s) in last 24h — check dashboard`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex" title={title}>
        <span className={`inline-block size-2 rounded-full ${DOT_CLASS[status]}`} />
        {hasRecentAnomaly && (
          <span className="absolute -inset-1 rounded-full ring-2 ring-amber-500 animate-pulse" />
        )}
      </span>
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {LABEL[status]}
          {hasRecentAnomaly && ` · ⚠ ${anomalyCount}`}
        </span>
      )}
    </span>
  );
}
