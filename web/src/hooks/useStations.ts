import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Station } from "@/lib/types";

export function useStations() {
  return useQuery({
    queryKey: ["stations"],
    queryFn: async (): Promise<Station[]> => {
      const { data, error } = await supabase.from("stations").select("*").order("id");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
