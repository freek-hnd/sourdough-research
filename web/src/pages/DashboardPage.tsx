import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useActiveItems } from "@/hooks/useActiveItems";
import { useRecentEvents } from "@/hooks/useRecentEvents";
import { formatElapsed, formatTime } from "@/lib/utils";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: activeItems, isLoading } = useActiveItems();
  const { data: events } = useRecentEvents(10);

  return (
    <div className="space-y-6 p-4">
      <Link to="/batch/new" className="block">
        <Button size="lg" className="h-14 w-full text-base">
          + New Batch
        </Button>
      </Link>

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
          <div className="space-y-2">
            {activeItems.map((item) => {
              const batch = item.batch as { root_starter?: { name: string } | null } | null;
              const station = item.station as { id: number; label: string } | null;
              const session = (item as Record<string, unknown>).session as { started_at: string } | null;
              const starterName = batch?.root_starter?.name;

              return (
                <Card
                  key={item.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/item/${item.short_id}`)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <div>
                        <span className="font-mono">{item.short_id}</span>
                        {starterName && (
                          <span className="ml-2 font-normal text-sm text-muted-foreground">{starterName}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary">{item.type}</Badge>
                        {station && <Badge>Station {station.id}</Badge>}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {session
                      ? `Running for ${formatElapsed(session.started_at)}`
                      : `Created ${formatElapsed(item.created_at)} ago`}
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
