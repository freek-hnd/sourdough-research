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
  const { data: sessions, isLoading } = useActiveItems();
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
        ) : !sessions || sessions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No active items. Start a new batch to begin.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => {
              const item = (s as { item: { short_id: string; type: string; id: string } | null }).item;
              const station = (s as { station: { id: number; label: string } | null }).station;
              if (!item) return null;
              return (
                <Card
                  key={s.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/item/${item.short_id}`)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="font-mono">{item.short_id}</span>
                      <div className="flex gap-2">
                        <Badge variant="secondary">{item.type}</Badge>
                        {station && <Badge>Station {station.id}</Badge>}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Running for {formatElapsed(s.started_at)}
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
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-14 text-muted-foreground">{formatTime(e.occurred_at)}</span>
                <span className="flex-1">{e.event_name}</span>
                {e.station_id && (
                  <span className="text-muted-foreground">#{e.station_id}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
