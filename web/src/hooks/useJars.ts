import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Jar } from "@/lib/types";

/** All jars known to the system, sorted by name. */
export function useJars() {
  return useQuery({
    queryKey: ["jars"],
    queryFn: async (): Promise<Jar[]> => {
      const { data, error } = await supabase
        .from("jars")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Jar[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Single jar by id. enabled when jarId is set. */
export function useJar(jarId: string | null | undefined) {
  return useQuery({
    queryKey: ["jar", jarId],
    enabled: !!jarId,
    queryFn: async (): Promise<Jar | null> => {
      const { data, error } = await supabase
        .from("jars")
        .select("*")
        .eq("id", jarId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Jar | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}
