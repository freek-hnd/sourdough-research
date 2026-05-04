import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useItem(shortId: string | undefined) {
  return useQuery({
    queryKey: ["items", "by_short_id", shortId],
    enabled: !!shortId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*, batch:batches!items_batch_id_fkey(*, root_starter:root_starters(*)), station:stations(*)")
        .eq("short_id", shortId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useActiveSessionForItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ["sessions", "active", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("item_id", itemId!)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

/**
 * Latest session for an item — active OR already ended. Used to drive
 * the time window of SessionPlots so the plot stops at the real
 * ended_at instead of running to "now". Without this, an item whose
 * session ended hours ago would still pull in subsequent measurements
 * from the same station — typically the next jar that took its place
 * after a refresh — and they'd show up on the wrong item's chart.
 *
 * For event-logging or bake-state checks, use useActiveSessionForItem
 * instead. We don't want new event rows hanging off an ended session.
 */
export function useLatestSessionForItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ["sessions", "latest", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("item_id", itemId!)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSessionEvents(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["events", "by_session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("session_id", sessionId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useItemEvents(itemId: string | undefined) {
  return useQuery({
    queryKey: ["events", "by_item", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id")
        .eq("item_id", itemId!);
      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (sessionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .in("session_id", sessionIds)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useLatestMeasurement(stationId: number | null | undefined) {
  return useQuery({
    queryKey: ["measurements", "latest", stationId],
    enabled: !!stationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurements")
        .select("*")
        .eq("station_id", stationId!)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
