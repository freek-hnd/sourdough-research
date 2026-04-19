import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ChartMeasurement {
  measured_at: string;
  ts_num: number;
  co2_ppm: number | null;
  scd_temp_c: number | null;
  scd_humidity_pct: number | null;
  ds18b20_temp_c: number | null;
  tof_median_mm: number | null;
  tof_grid: number[] | null;
}

export interface ChartPhReading {
  measured_at: string;
  ts_num: number;
  ph: number | null;
}

export function useSessionChartData(
  stationId: number | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
) {
  const measurements = useQuery({
    queryKey: ["chart_measurements", stationId, startTime, endTime],
    enabled: !!stationId && !!startTime,
    queryFn: async (): Promise<ChartMeasurement[]> => {
      let q = supabase
        .from("measurements")
        .select("measured_at, co2_ppm, scd_temp_c, scd_humidity_pct, ds18b20_temp_c, tof_median_mm, tof_grid")
        .eq("station_id", stationId!)
        .gte("measured_at", startTime!)
        .order("measured_at", { ascending: true });
      if (endTime) q = q.lte("measured_at", endTime);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        ts_num: new Date(r.measured_at).getTime(),
      }));
    },
    staleTime: 30_000,
  });

  const phReadings = useQuery({
    queryKey: ["chart_ph", stationId, startTime, endTime],
    enabled: !!stationId && !!startTime,
    queryFn: async (): Promise<ChartPhReading[]> => {
      let q = supabase
        .from("ph_readings")
        .select("measured_at, ph")
        .eq("station_id", stationId!)
        .gte("measured_at", startTime!)
        .order("measured_at", { ascending: true });
      if (endTime) q = q.lte("measured_at", endTime);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        ts_num: new Date(r.measured_at).getTime(),
      }));
    },
    staleTime: 30_000,
  });

  return { measurements, phReadings };
}
