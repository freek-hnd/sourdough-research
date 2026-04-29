import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useLogEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      event_name: string;
      session_id?: string | null;
      station_id?: number | null;
      value?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("events")
        .insert({
          event_name: input.event_name,
          session_id: input.session_id ?? null,
          station_id: input.station_id ?? null,
          value: input.value ?? null,
          notes: input.notes ?? null,
          occurred_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase
        .from("events")
        .delete()
        .eq("id", eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", sessionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export interface NewBatchInput {
  type: "starter" | "dough";
  root_starter_id: string;
  parent_item_id: string | null;
  parent_generation?: number;
  flour_g: number;
  water_g: number;
  starter_g: number | null;
  salt_g: number | null;
  /** Whole-grain / volkoren flour. Stored in batches.extras_json since
   *  the schema doesn't have a dedicated column yet. */
  whole_flour_g?: number | null;
  extras_json: unknown;
  mixed_at: string;
  notes: string | null;
  children: Array<{
    weight_g: number;
    container_type: string;
    station_id: number | null;
    inkbird_probe: number | null;
    /** Per-jar ingredient amounts. Used by the multi-jar starter
     *  refresh flow where each new jar can have its own recipe. When
     *  set, batch.flour_g/water_g/starter_g is the SUM across jars and
     *  the per-jar breakdown is preserved in extras_json.jars. */
    flour_g?: number;
    water_g?: number;
    starter_g?: number;
    whole_flour_g?: number;
  }>;
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewBatchInput) => {
      const { generateShortId } = await import("@/lib/utils");
      const now = new Date();
      const prefix = generateShortId(input.type, now, 0).slice(0, 6);
      const { data: existing } = await supabase
        .from("items")
        .select("short_id")
        .like("short_id", `${prefix}%`);
      const offsetBase = existing?.length ?? 0;
      const generation = (input.parent_generation ?? 0) + 1;

      // -------------------------------------------------------------
      // Starter refresh into 2+ jars: each jar is its OWN batch.
      // All batches share root_starter_id, parent_item_id, mixed_at;
      // each batch's flour_g/water_g/starter_g/whole_flour_g is just
      // that one jar's recipe. No per-jar mathematics on a parent
      // batch row, no synthetic 'sum' values.
      // -------------------------------------------------------------
      if (input.type === "starter" && input.children.length > 1) {
        const insertedItems: Array<{ id: string; station_id: number | null }> = [];

        for (let i = 0; i < input.children.length; i++) {
          const c = input.children[i];
          const jarFlour = c.flour_g ?? input.flour_g;
          const jarWater = c.water_g ?? input.water_g;
          const jarStarter = c.starter_g ?? (input.starter_g ?? 0);
          const jarWhole = c.whole_flour_g ?? 0;
          const jarTotal = jarFlour + jarWater + jarStarter + jarWhole;

          const jarExtras: Record<string, unknown> = {};
          if (input.extras_json != null) jarExtras.extra = input.extras_json;
          if (jarWhole > 0) jarExtras.whole_flour_g = jarWhole;
          const jarExtrasPayload =
            Object.keys(jarExtras).length > 0 ? jarExtras : null;

          const { data: jarBatch, error: bErr } = await supabase
            .from("batches")
            .insert({
              type: "starter",
              root_starter_id: input.root_starter_id,
              parent_item_id: input.parent_item_id,
              flour_g: jarFlour,
              water_g: jarWater,
              starter_g: jarStarter,
              salt_g: null,
              extras_json: jarExtrasPayload,
              total_weight_g: jarTotal,
              num_children: 1,
              mixed_at: input.mixed_at,
              notes: input.notes,
            })
            .select()
            .single();
          if (bErr) throw bErr;

          const { data: jarItem, error: iErr } = await supabase
            .from("items")
            .insert({
              batch_id: jarBatch.id,
              type: "starter",
              short_id: generateShortId("starter", now, offsetBase + i),
              container_type: c.container_type,
              weight_g: c.weight_g || jarTotal,
              station_id: c.station_id,
              inkbird_probe: c.inkbird_probe,
              generation,
            })
            .select()
            .single();
          if (iErr) throw iErr;
          insertedItems.push({ id: jarItem.id, station_id: jarItem.station_id });
        }

        const sessionsPayload = insertedItems
          .filter((it) => it.station_id != null)
          .map((it) => ({
            id: crypto.randomUUID(),
            item_id: it.id,
            station_id: it.station_id!,
            started_at: input.mixed_at,
          }));
        if (sessionsPayload.length > 0) {
          const { error: sErr } = await supabase
            .from("sessions")
            .insert(sessionsPayload)
            .select();
          if (sErr) throw sErr;
        }

        return { items: insertedItems };
      }

      // -------------------------------------------------------------
      // Dough OR single-jar starter: classic 1-batch-with-N-items
      // shape. Dough is divided from a shared mixture so a single
      // batch row with shared flour/water/starter is the correct model.
      // -------------------------------------------------------------
      const wholeFlourG = input.whole_flour_g ?? 0;
      const total =
        input.flour_g + input.water_g + (input.starter_g ?? 0) +
        (input.salt_g ?? 0) + wholeFlourG;

      const extras: Record<string, unknown> = {};
      if (input.extras_json != null) extras.extra = input.extras_json;
      if (wholeFlourG > 0) extras.whole_flour_g = wholeFlourG;
      const extrasPayload = Object.keys(extras).length > 0 ? extras : null;

      const { data: batch, error: bErr } = await supabase
        .from("batches")
        .insert({
          type: input.type,
          root_starter_id: input.root_starter_id,
          parent_item_id: input.parent_item_id,
          flour_g: input.flour_g,
          water_g: input.water_g,
          starter_g: input.starter_g,
          salt_g: input.salt_g,
          extras_json: extrasPayload,
          total_weight_g: total,
          num_children: input.children.length,
          mixed_at: input.mixed_at,
          notes: input.notes,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      const itemsPayload = input.children.map((c, i) => ({
        batch_id: batch.id,
        type: input.type,
        short_id: generateShortId(input.type, now, offsetBase + i),
        container_type: c.container_type,
        weight_g: c.weight_g,
        station_id: c.station_id,
        inkbird_probe: c.inkbird_probe,
        generation,
      }));
      const { data: items, error: iErr } = await supabase
        .from("items")
        .insert(itemsPayload)
        .select();
      if (iErr) throw iErr;

      const sessionsPayload = (items ?? [])
        .filter((it) => it.station_id != null)
        .map((it) => ({
          id: crypto.randomUUID(),
          item_id: it.id,
          station_id: it.station_id!,
          started_at: input.mixed_at,
        }));
      if (sessionsPayload.length > 0) {
        const { error: sErr } = await supabase
          .from("sessions")
          .insert(sessionsPayload)
          .select();
        if (sErr) throw sErr;
      }
      return { batch, items };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["starter_lineage"] });
    },
  });
}

/**
 * Logs a bake_start event for each dough being baked together.
 * Shared bake_id (UUID) goes into event.value so the loaves can be
 * matched up later as one bake. event.notes carries the JSON payload
 * with the Inkbird probe number assigned to this loaf.
 */
export function useStartBake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      items: Array<{
        item_id: string;
        session_id: string | null;
        probe: number | null;
      }>;
    }) => {
      const bakeId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const rows = input.items.map((it) => ({
        id: crypto.randomUUID(),
        event_name: "bake_start",
        session_id: it.session_id,
        station_id: null,
        occurred_at: occurredAt,
        value: bakeId,
        notes: JSON.stringify({ probe: it.probe, item_id: it.item_id }),
      }));
      const { error } = await supabase.from("events").insert(rows).select();
      if (error) throw error;
      return { bakeId, occurredAt };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["bake_state"] });
      qc.invalidateQueries({ queryKey: ["bake_members"] });
    },
  });
}

/**
 * Logs a bake_end event for every loaf in the bake. Each event carries
 * the shared bake_id in event.value plus (optionally) the probe's
 * reading at oven-out time in event.notes as JSON, so the results
 * step can prefill internal_temp_c even a day later when the probe is
 * no longer in the loaf.
 */
export function useEndBake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bakeId: string;
      members: Array<{
        item_id: string;
        session_id: string | null;
        final_temp_c: number | null;
      }>;
    }) => {
      const occurredAt = new Date().toISOString();
      const rows = input.members.map((m) => ({
        id: crypto.randomUUID(),
        event_name: "bake_end",
        session_id: m.session_id,
        station_id: null,
        occurred_at: occurredAt,
        value: input.bakeId,
        // item_id is embedded here so useBakeState can find this event
        // for items that have no session (= no station assigned).
        notes: JSON.stringify({
          final_temp_c: m.final_temp_c,
          item_id: m.item_id,
        }),
      }));
      const { error } = await supabase.from("events").insert(rows).select();
      if (error) throw error;
      return { occurredAt };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["bake_state"] });
    },
  });
}

export function useRetireStarter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("items")
        .update({ retired_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["starter_lineage"] });
    },
  });
}

export function useCreateRootStarter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; origin: string; description?: string }) => {
      const { data, error } = await supabase
        .from("root_starters")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["root_starters"] }),
  });
}

export function useSaveOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      // The "primary" item being baked — rating + photo attach only to it.
      primary_item_id: string;
      // All items baked together. Each carries its own internal temp,
      // final loaf weight, and assigned Inkbird probe because those
      // vary per loaf even in the same oven session.
      items: Array<{
        id: string;
        session_id: string | null;
        internal_temp_c: number | null;
        loaf_weight_g: number | null;
        inkbird_probe: number | null;
      }>;
      // Shared fields — same for every loaf in this bake.
      outcome_shared: {
        bake_temp_c: number | null;
        bake_duration_min: number | null;
        notes: string | null;
        baked_at: string;
      };
      rating: { rater_name: string; scores_json: Record<string, number>; notes: string | null } | null;
      photo_url: string | null;
    }) => {
      // One outcome row per item; per-item fields differ, shared fields
      // repeat. Inkbird probe is embedded in notes as "[Probe N]"
      // prefix since the outcomes table doesn't (yet) have a probe column.
      const outcomeRows = input.items.map((it) => {
        const prefix = it.inkbird_probe != null ? `[Probe ${it.inkbird_probe}] ` : "";
        const notes = input.outcome_shared.notes
          ? `${prefix}${input.outcome_shared.notes}`
          : prefix
          ? prefix.trim()
          : null;
        return {
          item_id: it.id,
          bake_temp_c: input.outcome_shared.bake_temp_c,
          bake_duration_min: input.outcome_shared.bake_duration_min,
          baked_at: input.outcome_shared.baked_at,
          internal_temp_c: it.internal_temp_c,
          loaf_weight_g: it.loaf_weight_g,
          notes,
        };
      });
      const { error: oErr } = await supabase
        .from("outcomes")
        .insert(outcomeRows);
      if (oErr) throw oErr;

      // Rating + photo attach to the primary only — user tasted/photographed
      // one representative loaf. If they want per-item ratings they can
      // go to each item separately.
      if (input.rating) {
        const { error: rErr } = await supabase
          .from("ratings")
          .insert({ item_id: input.primary_item_id, ...input.rating });
        if (rErr) throw rErr;
      }

      if (input.photo_url) {
        const { error: pErr } = await supabase
          .from("photos")
          .insert({ item_id: input.primary_item_id, storage_url: input.photo_url });
        if (pErr) throw pErr;
      }

      // End any sessions for the baked items.
      const sessionIdsToEnd = input.items
        .map((it) => it.session_id)
        .filter((id): id is string => id != null);
      if (sessionIdsToEnd.length > 0) {
        const { error: sErr } = await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString() })
          .in("id", sessionIdsToEnd);
        if (sErr) throw sErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
