import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Returns other dough items from the same batch that don't have an
 * outcome yet. Used on OutcomePage to let the user mark several doughs
 * as baked together in one session.
 */
export function useBatchSiblings(
  batchId: string | null | undefined,
  currentItemId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["batch_siblings", batchId, currentItemId],
    enabled: !!batchId && !!currentItemId,
    queryFn: async () => {
      // All dough items from the batch except the current one
      const { data: items, error } = await supabase
        .from("items")
        .select("id, short_id, weight_g")
        .eq("batch_id", batchId!)
        .eq("type", "dough")
        .neq("id", currentItemId!);
      if (error) throw error;
      if (!items || items.length === 0) return [];

      // Filter out ones that already have an outcome
      const ids = items.map((i) => i.id);
      const { data: outcomes } = await supabase
        .from("outcomes")
        .select("item_id")
        .in("item_id", ids);
      const done = new Set((outcomes ?? []).map((o) => o.item_id));

      // Pull any active sessions so we know which to end when baking
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id, item_id")
        .in("item_id", ids)
        .is("ended_at", null);
      const sessionByItem = new Map<string, string>();
      (sessions ?? []).forEach((s) => sessionByItem.set(s.item_id, s.id));

      return items
        .filter((i) => !done.has(i.id))
        .map((i) => ({
          ...i,
          session_id: sessionByItem.get(i.id) ?? null,
        }));
    },
    staleTime: 30_000,
  });
}
