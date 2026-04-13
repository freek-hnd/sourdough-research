import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useItem(shortId: string | undefined) {
  return useQuery({
    queryKey: ["items", "by_short_id", shortId],
    enabled: !!shortId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*, batch:batches(*, root_starter:root_starters(*)), station:stations(*)")
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
