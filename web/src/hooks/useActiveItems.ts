import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Returns recently created items that are still "active" — meaning they
 * don't have an outcome yet. Includes optional session and station joins.
 *
 * Previously this queried from `sessions` which meant items without a
 * station (and thus no session) were invisible on the dashboard.
 */
export function useActiveItems() {
  return useQuery({
    queryKey: ["items", "active"],
    queryFn: async () => {
      // Fetch items that have NO outcome yet (still active)
      const { data: items, error } = await supabase
        .from("items")
        .select("*, batch:batches!items_batch_id_fkey(*, root_starter:root_starters(*)), station:stations(*)")
        .is("retired_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      // Filter out items that already have an outcome
      const itemIds = (items ?? []).map((i) => i.id);
      if (itemIds.length === 0) return [];

      const { data: outcomes } = await supabase
        .from("outcomes")
        .select("item_id")
        .in("item_id", itemIds);
      const completedIds = new Set((outcomes ?? []).map((o) => o.item_id));

      const activeItems = (items ?? []).filter((i) => !completedIds.has(i.id));

      // Fetch active sessions for these items
      const activeIds = activeItems.map((i) => i.id);
      if (activeIds.length === 0) return [];

      const { data: sessions } = await supabase
        .from("sessions")
        .select("*")
        .in("item_id", activeIds)
        .is("ended_at", null);

      const sessionMap = new Map(
        (sessions ?? []).map((s) => [s.item_id, s])
      );

      return activeItems.map((item) => ({
        ...item,
        session: sessionMap.get(item.id) ?? null,
      }));
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
