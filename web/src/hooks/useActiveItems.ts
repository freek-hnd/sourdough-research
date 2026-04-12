import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useActiveItems() {
  return useQuery({
    queryKey: ["items", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*, item:items(*, batch:batches(*)), station:stations(*)")
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
