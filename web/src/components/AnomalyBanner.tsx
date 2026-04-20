import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  useStationAnomalies,
  anomalyLabel,
  anomalySeverity,
} from "@/hooks/useStationAnomalies";
import { formatTime } from "@/lib/utils";

/**
 * Dashboard banner that surfaces ESP32 anomaly events from the last 24h.
 *
 * Renders nothing when everything is healthy. When there's a problem it
 * becomes a prominent red/amber card so you can't miss it — even if the
 * 10-minute fallback auto-recovered and measurements kept flowing.
 */
export function AnomalyBanner() {
  const { data: anomalies } = useStationAnomalies(24);

  if (!anomalies || anomalies.length === 0) return null;

  const hasCritical = anomalies.some((a) => anomalySeverity(a.event_name) === "critical");

  // Group consecutive same-reason events per station so a burst of 20
  // mqtt_reconnects doesn't drown out one time_stuck.
  const grouped = collapseRuns(anomalies);

  return (
    <Card className={hasCritical
      ? "border-rose-500/50 bg-rose-50 dark:bg-rose-950/30"
      : "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30"
    }>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`size-4 ${hasCritical ? "text-rose-600" : "text-amber-600"}`} />
          <h3 className="text-sm font-semibold">
            Station anomalies (last 24h)
          </h3>
          <Badge variant="outline" className="ml-auto">{anomalies.length}</Badge>
        </div>

        <div className="space-y-1">
          {grouped.slice(0, 8).map((g) => {
            const sev = anomalySeverity(g.event_name);
            const dot =
              sev === "critical" ? "bg-rose-500" :
              sev === "warn"     ? "bg-amber-500" :
                                   "bg-slate-400";
            return (
              <div
                key={g.firstId}
                className="flex items-start gap-2 text-xs"
                title={g.notes ?? ""}
              >
                <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <span className="font-medium">
                      {anomalyLabel(g.event_name)}
                    </span>
                    {g.station_id != null && (
                      <span className="text-muted-foreground"> · Station {g.station_id}</span>
                    )}
                    {g.count > 1 && (
                      <span className="text-muted-foreground"> · ×{g.count}</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {formatTime(g.latestAt)}
                    {g.count > 1 && ` → ${formatTime(g.earliestAt)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {grouped.length > 8 && (
          <div className="text-xs text-muted-foreground">
            +{grouped.length - 8} more
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Data may still be arriving thanks to the 10-min fallback, but the
          firmware detected something wrong. See events table for full JSON.
        </p>
      </CardContent>
    </Card>
  );
}

interface AnomalyGroup {
  firstId: string;
  station_id: number | null;
  event_name: string;
  count: number;
  latestAt: string;
  earliestAt: string;
  notes: string | null;
}

function collapseRuns(
  anomalies: Array<{ id: string; station_id: number | null; event_name: string; occurred_at: string; notes: string | null }>,
): AnomalyGroup[] {
  const groups: AnomalyGroup[] = [];
  for (const a of anomalies) {
    const last = groups[groups.length - 1];
    if (last && last.event_name === a.event_name && last.station_id === a.station_id) {
      last.count++;
      last.earliestAt = a.occurred_at;
    } else {
      groups.push({
        firstId: a.id,
        station_id: a.station_id,
        event_name: a.event_name,
        count: 1,
        latestAt: a.occurred_at,
        earliestAt: a.occurred_at,
        notes: a.notes,
      });
    }
  }
  return groups;
}
