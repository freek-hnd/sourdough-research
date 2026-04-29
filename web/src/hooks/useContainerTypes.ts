import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const PREDEFINED = [
  "Jar (starter)",
  "Jar (large)",
  "Banneton",
  "Bowl",
  "Default",
];

/**
 * Returns the union of:
 *   - a small set of predefined container labels
 *   - every distinct container_type currently in the items table
 * sorted, deduplicated, ready to feed a <Select> dropdown.
 *
 * The point: once you type a custom label like "Mason 1L" once, it
 * shows up in the dropdown next time so you can click instead of
 * retype. No schema for "container types" — we just read what's
 * already been used.
 */
export function useContainerTypes() {
  return useQuery({
    queryKey: ["distinct_container_types"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("items")
        .select("container_type")
        .not("container_type", "is", null)
        .limit(500);
      if (error) throw error;
      const seen = new Set<string>(PREDEFINED);
      for (const r of data ?? []) {
        const v = r.container_type as string | null;
        if (v && v.trim()) seen.add(v);
      }
      return [...seen].sort((a, b) => a.localeCompare(b));
    },
    staleTime: 5 * 60_000,
  });
}
