import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * All active dough items ready to be baked:
 * - type = 'dough'
 * - not retired
 * - no outcome yet
 *
 * Used by the bake wizard so the user can pick which doughs are in
 * the oven together, even when they come from different batches.
 * Each item also carries its active session id (if any) so we can
 * end those sessions when the bake is saved.
 */
export function useActiveDoughs() {
  return useQuery({
    queryKey: ["active_doughs"],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("items")
        .select("id, short_id, weight_g, batch_id, inkbird_probe, created_at")
        .eq("type", "dough")
        .is("retired_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!items || items.length === 0) return [];

      const ids = items.map((i) => i.id);
      const { data: outcomes } = await supabase
        .from("outcomes")
        .select("item_id")
        .in("item_id", ids);
      const baked = new Set((outcomes ?? []).map((o) => o.item_id));

      const { data: sessions } = await supabase
        .from("sessions")
        .select("id, item_id")
        .in("item_id", ids)
        .is("ended_at", null);
      const sessionByItem = new Map<string, string>();
      (sessions ?? []).forEach((s) => sessionByItem.set(s.item_id, s.id));

      return items
        .filter((i) => !baked.has(i.id))
        .map((i) => ({
          ...i,
          session_id: sessionByItem.get(i.id) ?? null,
        }));
    },
    staleTime: 30_000,
  });
}
