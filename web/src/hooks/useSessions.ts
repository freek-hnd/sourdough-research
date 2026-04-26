import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SessionRow {
  id: string;
  item_id: string;
  station_id: number;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
}

export interface SessionWithItem extends SessionRow {
  item_short_id: string;
  item_retired_at: string | null;
  has_outcome: boolean;
  /** ISO timestamp of latest measurement on this station, or null. */
  last_measurement_at: string | null;
  /** Same station's NEXT session (started_at > this.started_at), if any. */
  next_session_started_at: string | null;
}

async function fetchEnriched(rows: SessionRow[]): Promise<SessionWithItem[]> {
  if (rows.length === 0) return [];

  // Items
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id)));
  const { data: items } = await supabase
    .from("items")
    .select("id, short_id, retired_at")
    .in("id", itemIds);
  const itemById = new Map<
    string,
    { id: string; short_id: string; retired_at: string | null }
  >(
    (items ?? []).map((i) => [
      i.id as string,
      {
        id: i.id as string,
        short_id: i.short_id as string,
        retired_at: (i.retired_at as string | null) ?? null,
      },
    ]),
  );

  // Outcomes — does each item have one?
  const { data: outcomes } = await supabase
    .from("outcomes")
    .select("item_id")
    .in("item_id", itemIds);
  const baked = new Set((outcomes ?? []).map((o) => o.item_id as string));

  // Latest measurement per station
  const stationIds = Array.from(new Set(rows.map((r) => r.station_id)));
  const lastByStation = new Map<number, string>();
  await Promise.all(
    stationIds.map(async (sid) => {
      const { data } = await supabase
        .from("measurements")
        .select("measured_at")
        .eq("station_id", sid)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.measured_at) lastByStation.set(sid, data.measured_at as string);
    }),
  );

  // For each open session, find next session on the same station that
  // started after it (so we can detect "stale because reused"). Pulled
  // in one query for the whole batch.
  const openOnes = rows.filter((r) => !r.ended_at);
  const nextByOpen = new Map<string, string>();
  if (openOnes.length > 0) {
    const { data: nextRows } = await supabase
      .from("sessions")
      .select("id, station_id, started_at")
      .in("station_id", stationIds)
      .order("started_at", { ascending: true });
    const byStation = new Map<number, Array<{ id: string; started_at: string }>>();
    (nextRows ?? []).forEach((n) => {
      const sid = n.station_id as number;
      if (!byStation.has(sid)) byStation.set(sid, []);
      byStation.get(sid)!.push({
        id: n.id as string,
        started_at: n.started_at as string,
      });
    });
    for (const o of openOnes) {
      const list = byStation.get(o.station_id) ?? [];
      const next = list.find(
        (n) => n.id !== o.id && new Date(n.started_at).getTime() > new Date(o.started_at).getTime(),
      );
      if (next) nextByOpen.set(o.id, next.started_at);
    }
  }

  return rows.map((r) => {
    const it = itemById.get(r.item_id);
    return {
      ...r,
      item_short_id: it?.short_id ?? "?",
      item_retired_at: it?.retired_at ?? null,
      has_outcome: baked.has(r.item_id),
      last_measurement_at: lastByStation.get(r.station_id) ?? null,
      next_session_started_at: nextByOpen.get(r.id) ?? null,
    };
  });
}

export function useCompleteSessions() {
  return useQuery({
    queryKey: ["sessions", "complete"],
    queryFn: async (): Promise<SessionWithItem[]> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, item_id, station_id, started_at, ended_at, notes")
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return fetchEnriched((data ?? []) as SessionRow[]);
    },
    staleTime: 60_000,
  });
}

export function useOpenSessions() {
  return useQuery({
    queryKey: ["sessions", "open"],
    queryFn: async (): Promise<SessionWithItem[]> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, item_id, station_id, started_at, ended_at, notes")
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return fetchEnriched((data ?? []) as SessionRow[]);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ----- Suggested end time logic ------------------------------------------

export type EndReason =
  | "reused"     // station now hosts a newer session
  | "outcome"    // bake outcome exists for the item
  | "retired"    // item was retired/archived
  | "stale"      // no measurements for >2h
  | "long";      // session > 24h with no other signal
// (returned as undefined when none of the above triggers)

export function suggestedEnd(s: SessionWithItem): { at: string; reason: EndReason } | null {
  // Priority order — the spec is explicit.
  if (s.next_session_started_at) {
    return { at: s.next_session_started_at, reason: "reused" };
  }
  if (s.has_outcome) {
    // The exact baked_at is in outcomes; for simplicity default to now
    // (caller can fetch the precise time if it wants). To keep this
    // hook self-contained without a join, we surface the trigger only.
    return { at: new Date().toISOString(), reason: "outcome" };
  }
  if (s.item_retired_at) {
    return { at: s.item_retired_at, reason: "retired" };
  }
  if (s.last_measurement_at) {
    const lastMs = new Date(s.last_measurement_at).getTime();
    const ageMs = Date.now() - lastMs;
    if (ageMs > 2 * 3600 * 1000) {
      return { at: new Date(lastMs + 2 * 3600 * 1000).toISOString(), reason: "stale" };
    }
  }
  const startedMs = new Date(s.started_at).getTime();
  const elapsedMs = Date.now() - startedMs;
  if (elapsedMs > 24 * 3600 * 1000) {
    return { at: new Date(startedMs + 24 * 3600 * 1000).toISOString(), reason: "long" };
  }
  return null;
}

export function reasonText(reason: EndReason): string {
  switch (reason) {
    case "reused":
      return "Station was assigned to a newer session — the previous one should have ended then.";
    case "outcome":
      return "Item has a bake outcome — fermentation session is finished.";
    case "retired":
      return "Item was retired — session should have ended at retire time.";
    case "stale":
      return "No measurements from this station for over 2 hours.";
    case "long":
      return "Session has been running over 24 hours with no clear end signal.";
  }
}
