import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useActiveItems } from "@/hooks/useActiveItems";
import { useRecentEvents } from "@/hooks/useRecentEvents";
import { StationStatusDot } from "@/components/StationStatus";
import { AnomalyBanner } from "@/components/AnomalyBanner";
import { BatchResumeBanner } from "@/components/BatchResumeBanner";
import { SessionsAttentionBanner } from "@/components/SessionsAttentionBanner";
import { formatElapsed, formatTime } from "@/lib/utils";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: activeItems, isLoading } = useActiveItems();
  const { data: events } = useRecentEvents(10);

  return (
    <div className="space-y-6 p-4">
      <BatchResumeBanner />

      <Link to="/batch/new" className="block">
        <Button size="lg" className="h-14 w-full text-base">
          + New Batch
        </Button>
      </Link>

      <AnomalyBanner />

      <SessionsAttentionBanner />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Active items</h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !activeItems || activeItems.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No active items. Start a new batch to begin.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium">Running</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Weight</th>
                    <th className="px-4 py-2 font-medium">Station</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((item) => {
                    const station = item.station as { id: number; label: string } | null;
                    const session = (item as Record<string, unknown>).session as { started_at: string } | null;
                    const batch = item.batch as { total_weight_g?: number } | null;
                    const weight = batch?.total_weight_g;
                    return (
                      <tr
                        key={item.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                        onClick={() => navigate(`/item/${item.short_id}`)}
                      >
                        <td className="px-4 py-2 font-mono font-medium">{item.short_id}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {session ? formatElapsed(session.started_at) : `${formatElapsed(item.created_at)} ago`}
                        </td>
                        <td className="px-4 py-2"><Badge variant="secondary">{item.type}</Badge></td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {weight != null ? `${Math.round(weight)} g` : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {station ? (
                            <span className="inline-flex items-center gap-1.5">
                              <StationStatusDot stationId={station.id} />
                              <Badge>Station {station.id}</Badge>
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <Separator />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Recent events</h2>
        {!events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="w-14 shrink-0 text-muted-foreground">{formatTime(e.occurred_at)}</span>
                <span className="flex-1">{e.event_name}</span>
                {e.station_id && (
                  <span className="text-muted-foreground">#{e.station_id}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
