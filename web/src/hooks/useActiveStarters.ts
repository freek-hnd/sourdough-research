import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RootStarter } from "@/lib/types";

interface ActiveStarter {
  id: string;
  short_id: string;
  generation: number;
  weight_g: number;
  container_type: string;
  created_at: string;
  station_id: number | null;
  batch: {
    root_starter_id: string;
    parent_item_id: string | null;
    root_starter: RootStarter;
  } | null;
}

export interface StarterGroup {
  rootStarter: RootStarter;
  items: ActiveStarter[];
}

export function useActiveStarters() {
  return useQuery({
    queryKey: ["items", "active_starters"],
    queryFn: async (): Promise<StarterGroup[]> => {
      const { data, error } = await supabase
        .from("items")
        .select("id, short_id, generation, weight_g, container_type, created_at, station_id, batch:batches!items_batch_id_fkey(root_starter_id, parent_item_id, root_starter:root_starters(*))")
        .eq("type", "starter")
        .is("retired_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const items = (data ?? []) as unknown as ActiveStarter[];
      const groups = new Map<string, StarterGroup>();
      for (const item of items) {
        if (!item.batch?.root_starter) continue;
        const rsId = item.batch.root_starter_id;
        if (!groups.has(rsId)) {
          groups.set(rsId, { rootStarter: item.batch.root_starter, items: [] });
        }
        groups.get(rsId)!.items.push(item);
      }
      return Array.from(groups.values()).sort((a, b) =>
        a.rootStarter.name.localeCompare(b.rootStarter.name)
      );
    },
    staleTime: 30_000,
  });
}
