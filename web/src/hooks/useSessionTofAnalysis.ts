import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { computePixelScores } from "@/lib/tofAnalysis";

export interface SessionTofAnalysis {
  /** First measurement of the session — used as the rise baseline. */
  baselineGrid: number[] | null;
  baselineMedianMm: number | null;
  /** Per-pixel A×B score in [0,1]. Always length 64. */
  pixelScores: number[];
  /** Number of frames considered (whole session). */
  frameCount: number;
}

/**
 * Fetches a session's full ToF history + station_adjusted events from
 * Supabase, and returns:
 *   - the very first measurement (baseline for "rise" computations)
 *   - per-pixel relevance scores via tofAnalysis.computePixelScores
 *
 * This is an analysis-grade fetch (the entire session, not just a
 * visible window) so the scores stay stable as the user changes
 * the time selector. Cached for 5 minutes since this rarely changes.
 */
export function useSessionTofAnalysis(
  stationId: number | null | undefined,
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
) {
  return useQuery({
    queryKey: ["session_tof_analysis", stationId, startedAt, endedAt],
    enabled: !!stationId && !!startedAt,
    queryFn: async (): Promise<SessionTofAnalysis> => {
      // Pull all measurements in the session window.
      let q = supabase
        .from("measurements")
        .select("measured_at, tof_grid, tof_median_mm")
        .eq("station_id", stationId!)
        .gte("measured_at", startedAt!)
        .order("measured_at", { ascending: true });
      if (endedAt) q = q.lte("measured_at", endedAt);
      const { data: rows, error } = await q;
      if (error) throw error;

      const all = (rows ?? []).map((r) => ({
        measured_at: r.measured_at as string,
        ts_num: new Date(r.measured_at as string).getTime(),
        tof_grid: (r.tof_grid as number[] | null) ?? null,
        tof_median_mm: (r.tof_median_mm as number | null) ?? null,
      }));

      // First valid frame = baseline for rise.
      let baselineGrid: number[] | null = null;
      let baselineMedianMm: number | null = null;
      for (const r of all) {
        if (
          Array.isArray(r.tof_grid) && r.tof_grid.length === 64 &&
          typeof r.tof_median_mm === "number" && r.tof_median_mm > 0
        ) {
          baselineGrid = r.tof_grid;
          baselineMedianMm = r.tof_median_mm;
          break;
        }
      }

      // Pull station_adjusted events for the same window so we can
      // mask glitchy readings around them.
      const { data: evs } = await supabase
        .from("events")
        .select("occurred_at, event_name")
        .gte("occurred_at", startedAt!)
        .like("event_name", "station_adjusted%");
      const eventTimestamps = (evs ?? [])
        .filter((e) => {
          if (endedAt) return new Date(e.occurred_at as string) <= new Date(endedAt);
          return true;
        })
        .map((e) => new Date(e.occurred_at as string).getTime());

      // Score over the whole session — score is a property of the
      // pixel, not the visible window.
      const scoredFrames = all
        .filter((r): r is typeof r & { tof_grid: number[] } =>
          Array.isArray(r.tof_grid) && r.tof_grid.length === 64,
        )
        .map((r) => ({ ts_num: r.ts_num, tof_grid: r.tof_grid }));

      const pixelScores = computePixelScores(scoredFrames, eventTimestamps);

      return {
        baselineGrid,
        baselineMedianMm,
        pixelScores,
        frameCount: scoredFrames.length,
      };
    },
    staleTime: 5 * 60_000,
  });
}
