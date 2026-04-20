import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Time-series measurements for a single station between `from` and `to`.
 * Returned rows are ordered ascending by measured_at so they can be plotted
 * directly as a line chart.
 */
export function useMeasurements(
  stationId: number | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
) {
  return useQuery({
    queryKey: ["measurements", "range", stationId, from, to],
    enabled: !!stationId && !!from,
    queryFn: async () => {
      const query = supabase
        .from("measurements")
        .select(
          "measured_at, co2_ppm, scd_temp_c, scd_humidity_pct, tof_median_mm, ds18b20_temp_c"
        )
        .eq("station_id", stationId!)
        .gte("measured_at", from!)
        .order("measured_at", { ascending: true });

      if (to) query.lte("measured_at", to);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
