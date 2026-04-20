import { useStationHeartbeats, heartbeatStatus, type HeartbeatStatus } from "@/hooks/useStationHeartbeats";

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

export function StationStatusDot({ stationId, showLabel = false }: { stationId: number; showLabel?: boolean }) {
  const { data: heartbeats } = useStationHeartbeats();
  const lastAt = heartbeats?.get(stationId);
  const status = heartbeatStatus(lastAt);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block size-2 rounded-full ${DOT_CLASS[status]}`}
        title={lastAt ? `Last heartbeat: ${new Date(lastAt).toLocaleString()}` : "No heartbeat ever"}
      />
      {showLabel && <span className="text-xs text-muted-foreground">{LABEL[status]}</span>}
    </span>
  );
}
