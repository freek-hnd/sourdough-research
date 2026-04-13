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
  flour_g: number;
  water_g: number;
  starter_g: number | null;
  salt_g: number | null;
  extras_json: unknown;
  mixed_at: string;
  notes: string | null;
  children: Array<{
    weight_g: number;
    container_type: string;
    station_id: number | null;
    inkbird_probe: number | null;
  }>;
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewBatchInput) => {
      const total =
        input.flour_g + input.water_g + (input.starter_g ?? 0) + (input.salt_g ?? 0);
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
          extras_json: input.extras_json,
          total_weight_g: total,
          num_children: input.children.length,
          mixed_at: input.mixed_at,
          notes: input.notes,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      const now = new Date();
      const { generateShortId } = await import("@/lib/utils");
      const prefix = generateShortId(input.type, now, 0).slice(0, 6); // e.g. "D0412-"
      const { data: existing } = await supabase
        .from("items")
        .select("short_id")
        .like("short_id", `${prefix}%`);
      const offset = existing?.length ?? 0;
      const itemsPayload = input.children.map((c, i) => ({
        batch_id: batch.id,
        type: input.type,
        short_id: generateShortId(input.type, now, offset + i),
        container_type: c.container_type,
        weight_g: c.weight_g,
        station_id: c.station_id,
        inkbird_probe: c.inkbird_probe,
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
      item_id: string;
      session_id: string | null;
      outcome: {
        loaf_weight_g: number | null;
        bake_temp_c: number | null;
        bake_duration_min: number | null;
        internal_temp_c: number | null;
        notes: string | null;
        baked_at: string;
      };
      rating: { rater_name: string; scores_json: Record<string, number>; notes: string | null } | null;
      photo_url: string | null;
    }) => {
      const { error: oErr } = await supabase
        .from("outcomes")
        .insert({ item_id: input.item_id, ...input.outcome });
      if (oErr) throw oErr;

      if (input.rating) {
        const { error: rErr } = await supabase
          .from("ratings")
          .insert({ item_id: input.item_id, ...input.rating });
        if (rErr) throw rErr;
      }

      if (input.photo_url) {
        const { error: pErr } = await supabase
          .from("photos")
          .insert({ item_id: input.item_id, storage_url: input.photo_url });
        if (pErr) throw pErr;
      }

      if (input.session_id) {
        const { error: sErr } = await supabase
          .from("sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", input.session_id);
        if (sErr) throw sErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
