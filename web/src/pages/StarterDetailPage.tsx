import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";
import { SessionPlots } from "@/components/SessionPlots";

interface StarterSession {
  id: string;
  item_id: string;
  station_id: number;
  started_at: string;
  ended_at: string | null;
  item_short_id: string;
}

export function StarterDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: starter, isLoading: starterLoading } = useQuery({
    queryKey: ["root_starter", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("root_starters")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["starter_sessions", id],
    enabled: !!id,
    queryFn: async (): Promise<StarterSession[]> => {
      // Find all items belonging to batches of this starter
      const { data: items, error: iErr } = await supabase
        .from("items")
        .select("id, short_id, batch_id, station_id")
        .eq("type", "starter");
      if (iErr) throw iErr;
      if (!items?.length) return [];

      // Filter to items from batches of this root starter
      const batchIds = items.map((i) => i.batch_id);
      const { data: batches, error: bErr } = await supabase
        .from("batches")
        .select("id")
        .eq("root_starter_id", id!)
        .in("id", batchIds);
      if (bErr) throw bErr;
      const validBatchIds = new Set((batches ?? []).map((b) => b.id));
      const starterItems = items.filter((i) => validBatchIds.has(i.batch_id));
      if (!starterItems.length) return [];

      // Get sessions for these items
      const itemIds = starterItems.map((i) => i.id);
      const { data: sessData, error: sErr } = await supabase
        .from("sessions")
        .select("*")
        .in("item_id", itemIds)
        .order("started_at", { ascending: false });
      if (sErr) throw sErr;

      const itemMap = new Map(starterItems.map((i) => [i.id, i]));
      return (sessData ?? []).map((s) => ({
        ...s,
        item_short_id: itemMap.get(s.item_id)?.short_id ?? "?",
      }));
    },
  });

  if (starterLoading) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  if (!starter) return <div className="p-4 text-muted-foreground">Starter not found.</div>;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">{starter.name}</h1>
        <p className="text-sm text-muted-foreground">{starter.origin}</p>
      </div>

      {sessionsLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !sessions?.length ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No sessions yet. Start a refresh with a station assigned to begin collecting data.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sessions.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="font-mono">{s.item_short_id}</span>
                  <div className="flex gap-2">
                    <Badge>Station {s.station_id}</Badge>
                    <Badge variant={s.ended_at ? "secondary" : "default"}>
                      {s.ended_at ? "Ended" : "Active"}
                    </Badge>
                  </div>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleString()}
                  {s.ended_at ? ` — ${new Date(s.ended_at).toLocaleString()}` : " — now"}
                </p>
              </CardHeader>
              <CardContent>
                {s.started_at ? (
                  <SessionPlots
                    stationId={s.station_id}
                    startedAt={s.started_at}
                    endedAt={s.ended_at}
                    sessionId={s.id}
                    itemId={s.item_id}
                  />
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Session has no start time.
                  </p>
                )}
              </CardContent>
              <Separator />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
