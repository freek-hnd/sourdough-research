import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface MeasurementRow {
  measured_at: string;
  ts_num: number;
  co2_ppm: number | null;
  scd_temp_c: number | null;
  scd_humidity_pct: number | null;
  tof_median_mm: number | null;
  ds18b20_temp_c: number | null;
  tof_grid: number[] | null;
}

/**
 * Time-series measurements for a single station between `from` and `to`.
 * Returned rows are ordered ascending by measured_at and pre-enriched
 * with `ts_num` (epoch ms) so they plug straight into recharts on a
 * numeric x-axis.
 */
export function useMeasurements(
  stationId: number | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
) {
  return useQuery({
    queryKey: ["measurements", "range", stationId, from, to],
    enabled: !!stationId && !!from,
    queryFn: async (): Promise<MeasurementRow[]> => {
      const query = supabase
        .from("measurements")
        .select(
          "measured_at, co2_ppm, scd_temp_c, scd_humidity_pct, tof_median_mm, ds18b20_temp_c, tof_grid",
        )
        .eq("station_id", stationId!)
        .gte("measured_at", from!)
        .order("measured_at", { ascending: true });

      if (to) query.lte("measured_at", to);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        measured_at: r.measured_at as string,
        ts_num: new Date(r.measured_at as string).getTime(),
        co2_ppm: r.co2_ppm as number | null,
        scd_temp_c: r.scd_temp_c as number | null,
        scd_humidity_pct: r.scd_humidity_pct as number | null,
        tof_median_mm: r.tof_median_mm as number | null,
        ds18b20_temp_c: r.ds18b20_temp_c as number | null,
        tof_grid: (r.tof_grid as number[] | null) ?? null,
      }));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
