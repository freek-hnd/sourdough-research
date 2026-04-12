import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RootStarter } from "@/lib/types";

export function useRootStarters() {
  return useQuery({
    queryKey: ["root_starters"],
    queryFn: async (): Promise<RootStarter[]> => {
      const { data, error } = await supabase
        .from("root_starters")
        .select("*")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
