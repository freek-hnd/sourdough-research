import { Link, useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useItem, useLatestSessionForItem } from "@/hooks/useItem";
import { SessionPlots } from "@/components/SessionPlots";

/**
 * Per-item plot view. Reuses the unified SessionPlots component so
 * the time-series UI is identical to /sessions and /stations/:id.
 *
 * Time window comes from the item's LATEST session (active or ended)
 * — using ended_at as the upper bound is essential, otherwise once
 * the session has ended the plot would keep pulling in the next
 * jar's measurements from the same station.
 */
export function ItemPlotPage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading } = useItem(shortId);
  const { data: session } = useLatestSessionForItem(item?.id);

  if (isLoading || !item) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  if (!item.station_id) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-lg font-semibold">{item.short_id} — Plot</h1>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No station assigned, so there are no measurements to plot.
          </CardContent>
        </Card>
        <Button variant="ghost" onClick={() => nav(`/item/${item.short_id}`)}>
          ← Back
        </Button>
      </div>
    );
  }

  // Fall back to the item's created_at if there's no session for it,
  // so the plot still has a sensible lower bound.
  const startedAt = session?.started_at ?? item.created_at;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold">{item.short_id} — Plot</h1>
        <Link to={`/item/${item.short_id}`}>
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
      </div>

      <SessionPlots
        stationId={item.station_id}
        startedAt={startedAt}
        endedAt={session?.ended_at ?? null}
        sessionId={session?.id}
        itemId={item.id}
      />
    </div>
  );
}
