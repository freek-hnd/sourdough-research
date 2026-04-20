import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Most recent Inkbird BLE reading across all 4 probes. Used on the
 * bake outcome page to show the live internal dough temperature when
 * the user selects which probe they're tracking.
 */
export function useLatestInkbirdReading() {
  return useQuery({
    queryKey: ["inkbird_readings", "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inkbird_readings")
        .select("measured_at, probe1_c, probe2_c, probe3_c, probe4_c")
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function probeValue(
  reading: {
    probe1_c: number | null;
    probe2_c: number | null;
    probe3_c: number | null;
    probe4_c: number | null;
  } | null | undefined,
  probe: 1 | 2 | 3 | 4 | null,
): number | null {
  if (!reading || probe == null) return null;
  const key = `probe${probe}_c` as const;
  return reading[key];
}
