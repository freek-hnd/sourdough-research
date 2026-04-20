import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useItem } from "@/hooks/useItem";
import { useActiveDoughs } from "@/hooks/useActiveDoughs";
import { useLatestInkbirdReading, probeValue } from "@/hooks/useInkbird";
import { useBakeState, useBakeMembers } from "@/hooks/useBakeState";
import {
  useStartBake,
  useEndBake,
  useSaveOutcome,
} from "@/hooks/useMutations";

const DIMENSIONS = ["oven_spring", "crumb", "crust", "taste", "acidity", "aroma"] as const;

const DOUGH_PROBES = [1, 2, 3] as const;
const AMBIENT_PROBE = 4 as const;
type ProbeNumber = 1 | 2 | 3;

interface SelectedDough {
  id: string;
  short_id: string;
  weight_g: number;
  session_id: string | null;
  probe: ProbeNumber | null;
}

export function OutcomePage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading: itemLoading } = useItem(shortId);
  const { data: bakeInfo, isLoading: bakeLoading } = useBakeState(item?.id);

  if (itemLoading || bakeLoading || !item || !bakeInfo) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  if (bakeInfo.state === "done") {
    // Already baked; redirect back to the item. Component would otherwise
    // render empty.
    nav(`/item/${item.short_id}`);
    return null;
  }

  if (bakeInfo.state === "no-bake") {
    return <StartBakeView item={item} />;
  }

  if (bakeInfo.state === "baking") {
    return <EndBakeView item={item} bakeId={bakeInfo.bakeId!} />;
  }

  // awaiting-results
  return <ResultsView item={item} bakeId={bakeInfo.bakeId!} />;
}

// =====================================================================
// View 1 — Start bake
// Select which doughs are going in + assign probes. Logs bake_start
// events (session stays open). User is free to close the app after.
// =====================================================================

function StartBakeView({ item }: { item: NonNullable<ReturnType<typeof useItem>["data"]> }) {
  const nav = useNavigate();
  const { data: doughs, isLoading } = useActiveDoughs();
  const { data: inkbird } = useLatestInkbirdReading();
  const startBake = useStartBake();

  const [selected, setSelected] = useState<Map<string, SelectedDough>>(new Map());
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || !doughs) return;
    const next = new Map<string, SelectedDough>();
    const primary = doughs.find((d) => d.id === item.id);
    if (primary) {
      const probe = (primary.inkbird_probe ?? null) as ProbeNumber | null;
      next.set(primary.id, {
        id: primary.id,
        short_id: primary.short_id,
        weight_g: primary.weight_g,
        session_id: primary.session_id,
        probe: probe != null && DOUGH_PROBES.includes(probe) ? probe : null,
      });
    }
    setSelected(next);
    setSeeded(true);
  }, [seeded, doughs, item.id]);

  const ambientC = probeValue(inkbird, AMBIENT_PROBE as unknown as 4);
  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  function probesTakenBy(exceptItemId: string): Set<ProbeNumber> {
    const used = new Set<ProbeNumber>();
    for (const d of selected.values()) {
      if (d.id !== exceptItemId && d.probe != null) used.add(d.probe);
    }
    return used;
  }

  function toggleDough(d: NonNullable<typeof doughs>[number]) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(d.id)) {
        if (d.id === item.id) return prev; // can't uncheck primary
        next.delete(d.id);
      } else {
        const existingProbe = (d.inkbird_probe ?? null) as ProbeNumber | null;
        const taken = probesTakenBy(d.id);
        const valid =
          existingProbe != null && DOUGH_PROBES.includes(existingProbe)
            ? existingProbe
            : null;
        next.set(d.id, {
          id: d.id,
          short_id: d.short_id,
          weight_g: d.weight_g,
          session_id: d.session_id,
          probe: valid != null && !taken.has(valid) ? valid : null,
        });
      }
      return next;
    });
  }

  function updateProbe(id: string, probe: ProbeNumber | null) {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      next.set(id, { ...cur, probe });
      return next;
    });
  }

  async function onStart() {
    try {
      await startBake.mutateAsync({
        items: selectedList.map((d) => ({
          item_id: d.id,
          session_id: d.session_id,
          probe: d.probe,
        })),
      });
      toast.success(
        selectedList.length > 1
          ? `Bake started — ${selectedList.length} loaves`
          : "Bake started",
      );
      nav("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (isLoading) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Start bake</h1>
        <Badge variant="outline">1 of 3</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Log which loaves are going in the oven and assign probes. You can
        close the app after — end the bake and log results later.
      </p>

      {/* Ambient probe — reference only */}
      <Card>
        <CardContent className="flex items-center justify-between p-3">
          <div>
            <div className="text-sm font-medium">Ambient (Probe 4)</div>
            <div className="text-xs text-muted-foreground">Always reserved for oven ambient</div>
          </div>
          <div className="font-mono text-lg">
            {ambientC != null ? `${ambientC.toFixed(1)}°C` : "—"}
          </div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-medium text-muted-foreground">
        Which doughs are in the oven?
      </h2>

      {!doughs || doughs.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No active doughs available.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {doughs.map((d) => {
            const sel = selected.get(d.id);
            const isSelected = !!sel;
            const isPrimary = d.id === item.id;
            const takenByOthers = probesTakenBy(d.id);
            const reading = probeValue(inkbird, sel?.probe ?? null);
            return (
              <Card key={d.id} className={isSelected ? "border-primary" : ""}>
                <CardContent className="p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isPrimary && isSelected}
                      onChange={() => toggleDough(d)}
                      className="size-4"
                    />
                    <span className="font-mono text-sm font-medium">{d.short_id}</span>
                    <span className="text-xs text-muted-foreground">{d.weight_g}g</span>
                    {isPrimary && <Badge variant="secondary" className="text-[10px]">primary</Badge>}
                  </label>
                  {isSelected && (
                    <div className="flex items-center gap-2 pl-6">
                      <Label className="text-xs text-muted-foreground">Probe:</Label>
                      <Select
                        value={sel.probe?.toString() ?? ""}
                        onValueChange={(v) =>
                          updateProbe(d.id, v ? (Number(v) as ProbeNumber) : null)
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="None">
                            {sel.probe ? `Probe ${sel.probe}` : "None"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {DOUGH_PROBES.map((n) => (
                            <SelectItem
                              key={n}
                              value={n.toString()}
                              disabled={takenByOthers.has(n)}
                            >
                              Probe {n}{takenByOthers.has(n) ? " (in use)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="font-mono text-sm min-w-[4rem] text-right">
                        {sel.probe == null
                          ? "—"
                          : reading != null
                          ? `${reading.toFixed(1)}°C`
                          : "—"}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Button
        className="h-12 w-full"
        disabled={selectedList.length === 0 || startBake.isPending}
        onClick={onStart}
      >
        🔥 Start bake
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>
        Cancel
      </Button>
    </div>
  );
}

// =====================================================================
// View 2 — End bake
// Bake is in progress. One click ends it for every loaf in the bake.
// Each loaf's probe reading at this moment is captured so the results
// step can prefill internal temp later (when the probe is no longer
// inserted).
// =====================================================================

function EndBakeView({
  item,
  bakeId,
}: {
  item: NonNullable<ReturnType<typeof useItem>["data"]>;
  bakeId: string;
}) {
  const nav = useNavigate();
  const { data: members, isLoading } = useBakeMembers(bakeId);
  const { data: inkbird } = useLatestInkbirdReading();
  const endBake = useEndBake();

  if (isLoading || !members) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  async function onEnd() {
    try {
      await endBake.mutateAsync({
        bakeId,
        members: (members ?? []).map((m) => ({
          item_id: m.itemId,
          session_id: m.sessionId,
          final_temp_c: probeValue(inkbird, m.probe as 1 | 2 | 3 | 4 | null) ?? null,
        })),
      });
      toast.success(
        (members?.length ?? 0) > 1
          ? `Bake ended — ${members?.length} loaves`
          : "Bake ended",
      );
      // Send user back to the item so they see the 'Log results' button.
      nav(`/item/${item.short_id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">End bake</h1>
        <Badge variant="outline">2 of 3</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Current probe readings will be captured now so you can fill in
        results later — even the next day.
      </p>

      <div className="space-y-2">
        {(members ?? []).map((m) => {
          const reading = probeValue(inkbird, m.probe as 1 | 2 | 3 | 4 | null);
          return (
            <Card key={m.itemId}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <div className="font-mono text-sm font-medium">{m.shortId}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.probe ? `Probe ${m.probe}` : "no probe"}
                  </div>
                </div>
                <div className="font-mono text-lg">
                  {reading != null ? `${reading.toFixed(1)}°C` : "—"}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button
        className="h-12 w-full"
        disabled={endBake.isPending}
        onClick={onEnd}
      >
        🧊 End bake
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>
        Cancel
      </Button>
    </div>
  );
}

// =====================================================================
// View 3 — Log results
// Bake is over. Now fill in oven temp, duration, per-loaf internal
// temp + final weight, rating, photo, notes.
// =====================================================================

function ResultsView({
  item,
  bakeId,
}: {
  item: NonNullable<ReturnType<typeof useItem>["data"]>;
  bakeId: string;
}) {
  const nav = useNavigate();
  const { data: members, isLoading: membersLoading } = useBakeMembers(bakeId);
  const save = useSaveOutcome();

  const [ovenTemp, setOvenTemp] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [raterName, setRaterName] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<File | null>(null);

  // Per-loaf inputs, seeded from the probe readings captured at bake_end
  const [loafFields, setLoafFields] = useState<
    Map<string, { internal_temp_c: string; loaf_weight_g: string }>
  >(new Map());

  // Seed loafFields once members load — prefill internal_temp_c from
  // the bake_end captured reading. Need to fetch bake_end events to
  // extract final_temp_c per loaf.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !members || members.length === 0) return;
    let cancelled = false;
    (async () => {
      // Fetch all bake_end events for this bake and key them by item_id
      // (from notes JSON) — NOT session_id, because session-less items
      // also need to prefill correctly.
      const { data: endEvents } = await supabase
        .from("events")
        .select("notes")
        .eq("event_name", "bake_end")
        .eq("value", bakeId);
      if (cancelled) return;

      const finalByItem = new Map<string, number | null>();
      (endEvents ?? []).forEach((e) => {
        try {
          const parsed = JSON.parse(e.notes || "{}");
          const itemId = typeof parsed.item_id === "string" ? parsed.item_id : null;
          const v = typeof parsed.final_temp_c === "number" ? parsed.final_temp_c : null;
          if (itemId) finalByItem.set(itemId, v);
        } catch { /* ignore */ }
      });

      const next = new Map<string, { internal_temp_c: string; loaf_weight_g: string }>();
      for (const m of members) {
        const finalTemp = finalByItem.get(m.itemId);
        next.set(m.itemId, {
          internal_temp_c: finalTemp != null ? finalTemp.toFixed(1) : "",
          loaf_weight_g: String(m.weightG),
        });
      }
      setLoafFields(next);
      setSeeded(true);
    })();
    return () => { cancelled = true; };
  }, [seeded, members, bakeId]);

  function updateLoaf(
    id: string,
    patch: Partial<{ internal_temp_c: string; loaf_weight_g: string }>,
  ) {
    setLoafFields((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { internal_temp_c: "", loaf_weight_g: "" };
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }

  async function submit() {
    if (!item || !members) return;

    let photoUrl: string | null = null;
    if (photo) {
      const path = `${item.short_id}_${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("loaf-photos").upload(path, photo);
      if (error) {
        toast.error(`Photo upload failed: ${error.message}`);
        return;
      }
      const { data } = supabase.storage.from("loaf-photos").getPublicUrl(path);
      photoUrl = data.publicUrl;
    }

    try {
      await save.mutateAsync({
        primary_item_id: item.id,
        items: members.map((m) => {
          const f = loafFields.get(m.itemId);
          return {
            id: m.itemId,
            session_id: m.sessionId,
            inkbird_probe: m.probe,
            internal_temp_c: f?.internal_temp_c ? Number(f.internal_temp_c) : null,
            loaf_weight_g: f?.loaf_weight_g ? Number(f.loaf_weight_g) : null,
          };
        }),
        outcome_shared: {
          bake_temp_c: ovenTemp ? Number(ovenTemp) : null,
          bake_duration_min: duration ? Number(duration) : null,
          notes: notes || null,
          baked_at: new Date().toISOString(),
        },
        rating: raterName && Object.keys(scores).length > 0
          ? { rater_name: raterName, scores_json: scores, notes: null }
          : null,
        photo_url: photoUrl,
      });
      toast.success(
        members.length > 1
          ? `Results saved — ${members.length} loaves`
          : "Results saved",
      );
      nav("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (membersLoading || !members) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  const totalLoaves = members.length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Bake results</h1>
        <Badge variant="outline">3 of 3</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Oven temp (°C)</Label>
          <Input
            inputMode="numeric"
            value={ovenTemp}
            onChange={(e) => setOvenTemp(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Duration (min)</Label>
          <Input
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Per-loaf readings</h2>
        {members.map((m) => {
          const f = loafFields.get(m.itemId);
          return (
            <Card key={m.itemId}>
              <CardContent className="p-3 space-y-2">
                <div>
                  <span className="font-mono text-sm font-medium">{m.shortId}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m.probe ? `Probe ${m.probe}` : "no probe"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Internal temp (°C)</Label>
                    <Input
                      inputMode="numeric"
                      value={f?.internal_temp_c ?? ""}
                      onChange={(e) => updateLoaf(m.itemId, { internal_temp_c: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Loaf weight (g)</Label>
                    <Input
                      inputMode="numeric"
                      value={f?.loaf_weight_g ?? ""}
                      onChange={(e) => updateLoaf(m.itemId, { loaf_weight_g: e.target.value })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-1">
        <Label>Photo (for {item.short_id})</Label>
        <Input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </div>

      <Separator />
      <h2 className="text-sm font-medium text-muted-foreground">
        Rating {totalLoaves > 1 && `(for ${item.short_id} only)`}
      </h2>
      <div className="space-y-1">
        <Label>Rater name</Label>
        <Input value={raterName} onChange={(e) => setRaterName(e.target.value)} />
      </div>
      {DIMENSIONS.map((d) => (
        <div key={d} className="space-y-1">
          <Label className="capitalize">{d.replace("_", " ")}</Label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                variant={scores[d] === n ? "default" : "outline"}
                className="flex-1 h-11"
                onClick={() => setScores({ ...scores, [d]: n })}
              >{n}</Button>
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-1">
        <Label>Notes (shared across all loaves)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>

      <Button
        className="h-12 w-full"
        onClick={submit}
        disabled={save.isPending}
      >
        {totalLoaves > 1 ? `Save results (${totalLoaves} loaves)` : "Save results"}
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>
        Cancel
      </Button>
    </div>
  );
}
