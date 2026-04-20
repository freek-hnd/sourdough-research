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
  item_id?: string;
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

      // Bake events carry item_id in notes JSON. We match by ILIKE on that
      // text so the state is findable even for items with no session
      // (dough with no station assigned) — linking via session_id alone
      // misses those.
      const itemIdPattern = `%"item_id":"${itemId}"%`;

      // Latest bake_start for this item.
      const { data: startEvents } = await supabase
        .from("events")
        .select("id, value, notes, occurred_at")
        .eq("event_name", "bake_start")
        .ilike("notes", itemIdPattern)
        .order("occurred_at", { ascending: false })
        .limit(1);
      const start = startEvents?.[0];
      if (!start) return { state: "no-bake" };

      const bakeId = start.value ?? undefined;
      const startNotes = parseNotes(start.notes);
      const probe = startNotes.probe ?? null;

      // Matching bake_end for this item (ignore bake_id here — we care
      // about whether THIS loaf has been taken out of the oven).
      const { data: endEvents } = await supabase
        .from("events")
        .select("id, notes, occurred_at")
        .eq("event_name", "bake_end")
        .ilike("notes", itemIdPattern)
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
      // Pull all bake_start events for this bake. Item ids come from
      // notes JSON — NOT from session_id — so items without a session
      // (no station assigned) are still handled.
      const { data: events, error } = await supabase
        .from("events")
        .select("session_id, notes")
        .eq("event_name", "bake_start")
        .eq("value", bakeId!);
      if (error) throw error;
      const rows = events ?? [];
      if (rows.length === 0) return [];

      // Parse item_id out of each event and collect session_ids for
      // items that do have one (so we can end those sessions later).
      const perEvent = rows.map((e) => ({
        itemId: parseNotes(e.notes).item_id as string | undefined,
        sessionId: (e.session_id as string | null) ?? null,
        probe: (parseNotes(e.notes).probe ?? null) as number | null,
      })).filter((x): x is { itemId: string; sessionId: string | null; probe: number | null } => !!x.itemId);

      if (perEvent.length === 0) return [];

      const itemIds = Array.from(new Set(perEvent.map((e) => e.itemId)));
      const { data: itemsRaw } = await supabase
        .from("items")
        .select("id, short_id, weight_g")
        .in("id", itemIds);
      const itemById = new Map<
        string,
        { id: string; short_id: string; weight_g: number }
      >();
      (itemsRaw ?? []).forEach((i) => {
        itemById.set(i.id as string, {
          id: i.id as string,
          short_id: i.short_id as string,
          weight_g: Number(i.weight_g),
        });
      });

      return perEvent
        .map((e) => {
          const itm = itemById.get(e.itemId);
          if (!itm) return null;
          return {
            itemId: itm.id,
            shortId: itm.short_id,
            weightG: itm.weight_g,
            sessionId: e.sessionId,
            probe: e.probe,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
    },
    staleTime: 10_000,
  });
}
