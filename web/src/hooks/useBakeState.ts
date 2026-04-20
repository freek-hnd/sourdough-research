import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Bake is a multi-step process that can span days:
 *   no-bake         → dough is still fermenting / waiting
 *   baking          → in the oven now (bake_start event logged)
 *   awaiting-results → came out of oven (bake_end logged) but results
 *                      (oven temp, rating, photo, etc.) not yet entered
 *   done            → outcome row exists for this item
 *
 * bake_start / bake_end events carry a shared bake_id (stored in
 * event.value) so multiple loaves baked together can be identified as
 * a single bake. event.notes is JSON: on bake_start we store the
 * assigned Inkbird probe number; on bake_end we store the probe's
 * reading at oven-out time so the results step can prefill internal
 * temp even a day later.
 */

export type BakeState = "no-bake" | "baking" | "awaiting-results" | "done";

export interface BakeInfo {
  state: BakeState;
  bakeId?: string;
  probe?: number | null;
  finalTempC?: number | null;
  startedAt?: string;
  endedAt?: string;
}

interface ParsedNotes {
  probe?: number | null;
  final_temp_c?: number | null;
}

function parseNotes(notes: string | null | undefined): ParsedNotes {
  if (!notes) return {};
  try {
    return JSON.parse(notes) as ParsedNotes;
  } catch {
    return {};
  }
}

export function useBakeState(itemId: string | undefined) {
  return useQuery<BakeInfo>({
    queryKey: ["bake_state", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      // If there's already an outcome we're done.
      const { data: outcome } = await supabase
        .from("outcomes")
        .select("id")
        .eq("item_id", itemId!)
        .limit(1)
        .maybeSingle();
      if (outcome) return { state: "done" };

      // Need the item's sessions so we can find bake_* events attached
      // to any of them.
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id")
        .eq("item_id", itemId!);
      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (sessionIds.length === 0) return { state: "no-bake" };

      // Latest bake_start for this item's sessions.
      const { data: startEvents } = await supabase
        .from("events")
        .select("id, value, notes, occurred_at")
        .eq("event_name", "bake_start")
        .in("session_id", sessionIds)
        .order("occurred_at", { ascending: false })
        .limit(1);
      const start = startEvents?.[0];
      if (!start) return { state: "no-bake" };

      const bakeId = start.value ?? undefined;
      const startNotes = parseNotes(start.notes);
      const probe = startNotes.probe ?? null;

      // Matching bake_end for this item's sessions.
      const { data: endEvents } = await supabase
        .from("events")
        .select("id, notes, occurred_at")
        .eq("event_name", "bake_end")
        .in("session_id", sessionIds)
        .order("occurred_at", { ascending: false })
        .limit(1);
      const end = endEvents?.[0];

      if (end) {
        const endNotes = parseNotes(end.notes);
        return {
          state: "awaiting-results",
          bakeId,
          probe,
          finalTempC: endNotes.final_temp_c ?? null,
          startedAt: start.occurred_at,
          endedAt: end.occurred_at,
        };
      }
      return {
        state: "baking",
        bakeId,
        probe,
        startedAt: start.occurred_at,
      };
    },
    staleTime: 10_000,
  });
}

/**
 * Returns the item ids + session ids of every loaf that is part of the
 * given bake (same bake_id). Used when one loaf's "End bake" or
 * "Log results" should fan out to all loaves that were baked together.
 */
export function useBakeMembers(bakeId: string | undefined) {
  return useQuery({
    queryKey: ["bake_members", bakeId],
    enabled: !!bakeId,
    queryFn: async () => {
      const { data: events, error } = await supabase
        .from("events")
        .select("session_id, notes")
        .eq("event_name", "bake_start")
        .eq("value", bakeId!);
      if (error) throw error;
      const rows = events ?? [];
      if (rows.length === 0) return [];

      const sessionIds = rows.map((e) => e.session_id).filter((v): v is string => !!v);
      if (sessionIds.length === 0) return [];

      const { data: sessions } = await supabase
        .from("sessions")
        .select("id, item_id, ended_at, item:items(id, short_id, weight_g)")
        .in("id", sessionIds);

      // Build { itemId, shortId, weight_g, sessionId, probe } per row
      const sessionById = new Map<string, (typeof sessions extends Array<infer T> ? T : never)>();
      (sessions ?? []).forEach((s) => sessionById.set(s.id, s));

      return rows
        .map((e) => {
          const notes = parseNotes(e.notes);
          const sess = e.session_id ? sessionById.get(e.session_id) : undefined;
          const itm = (sess as { item?: { id: string; short_id: string; weight_g: number } } | undefined)?.item;
          if (!itm) return null;
          return {
            itemId: itm.id,
            shortId: itm.short_id,
            weightG: itm.weight_g,
            sessionId: e.session_id as string,
            probe: (notes.probe ?? null) as number | null,
            sessionEndedAt: (sess as { ended_at: string | null } | undefined)?.ended_at ?? null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
    },
    staleTime: 10_000,
  });
}
