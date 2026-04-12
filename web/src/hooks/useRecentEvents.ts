import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useRecentEvents(limit = 10) {
  return useQuery({
    queryKey: ["events", "recent", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
