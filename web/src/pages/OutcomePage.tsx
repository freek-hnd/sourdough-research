import { useMemo, useState } from "react";
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
import { useSaveOutcome } from "@/hooks/useMutations";

const DIMENSIONS = ["oven_spring", "crumb", "crust", "taste", "acidity", "aroma"] as const;

// Probes 1-3 are assignable to doughs. Probe 4 is reserved for ambient
// oven temperature.
const DOUGH_PROBES = [1, 2, 3] as const;
const AMBIENT_PROBE = 4 as const;

type ProbeNumber = 1 | 2 | 3;

interface SelectedDough {
  id: string;
  short_id: string;
  weight_g: number;
  session_id: string | null;
  probe: ProbeNumber | null;
  internal_temp_c: string;
  loaf_weight_g: string;
}

export function OutcomePage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading: itemLoading } = useItem(shortId);
  const { data: doughs, isLoading: doughsLoading } = useActiveDoughs();
  const { data: inkbird } = useLatestInkbirdReading();
  const save = useSaveOutcome();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state — which doughs are in this bake + probe assignments
  // Keyed by item id. Seeded on first render once both queries resolve.
  const [selected, setSelected] = useState<Map<string, SelectedDough>>(new Map());
  const [seeded, setSeeded] = useState(false);

  // Step 2 state — shared bake results + rating + photo
  const [ovenTemp, setOvenTemp] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [raterName, setRaterName] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<File | null>(null);

  // Seed step 1: pre-select the item the user came from. Default its
  // probe to whatever's already assigned on the item (inkbird_probe
  // field on items — may already match the probe the user set at batch
  // creation). Only do this once, when both queries have data.
  if (!seeded && item && doughs) {
    const next = new Map<string, SelectedDough>();
    const primary = doughs.find((d) => d.id === item.id);
    if (primary) {
      const probe = (primary.inkbird_probe ?? null) as ProbeNumber | null;
      const validProbe = probe != null && DOUGH_PROBES.includes(probe as ProbeNumber)
        ? probe
        : null;
      next.set(primary.id, {
        id: primary.id,
        short_id: primary.short_id,
        weight_g: primary.weight_g,
        session_id: primary.session_id,
        probe: validProbe,
        internal_temp_c: "",
        loaf_weight_g: String(primary.weight_g),
      });
    }
    setSelected(next);
    setSeeded(true);
  }

  const primaryItemId = item?.id ?? "";
  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);
  const totalLoaves = selectedList.length;
  const ambientC = probeValue(inkbird, AMBIENT_PROBE as unknown as 4);

  // Probes already used by other selected items (so we can disable them
  // in other rows' dropdowns).
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
        // Don't let the user uncheck the primary — rating/photo anchor
        // to that item. They can change primary by navigating to a
        // different item first.
        if (d.id === primaryItemId) return prev;
        next.delete(d.id);
      } else {
        const existingProbe = (d.inkbird_probe ?? null) as ProbeNumber | null;
        const valid = existingProbe != null && DOUGH_PROBES.includes(existingProbe)
          ? existingProbe
          : null;
        // Don't auto-assign a probe that's already taken by another selected dough
        const taken = probesTakenBy(d.id);
        next.set(d.id, {
          id: d.id,
          short_id: d.short_id,
          weight_g: d.weight_g,
          session_id: d.session_id,
          probe: valid != null && !taken.has(valid) ? valid : null,
          internal_temp_c: "",
          loaf_weight_g: String(d.weight_g),
        });
      }
      return next;
    });
  }

  function updateDough(id: string, patch: Partial<SelectedDough>) {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }

  async function submit() {
    if (!item || selectedList.length === 0) return;

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
        items: selectedList.map((d) => ({
          id: d.id,
          session_id: d.session_id,
          inkbird_probe: d.probe,
          internal_temp_c: d.internal_temp_c ? Number(d.internal_temp_c) : null,
          loaf_weight_g: d.loaf_weight_g ? Number(d.loaf_weight_g) : null,
        })),
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
        totalLoaves > 1
          ? `Bake saved — ${totalLoaves} loaves`
          : "Bake saved",
      );
      nav("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (itemLoading || doughsLoading || !item) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  }

  // ------------------------------------------------------------------
  // Step 1 — select doughs + assign probes
  // ------------------------------------------------------------------
  if (step === 1) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Start bake</h1>
          <Badge variant="outline">Step 1/2</Badge>
        </div>

        {/* Ambient (probe 4) — shown for reference, not assignable */}
        <Card>
          <CardContent className="flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">Ambient (Probe 4)</div>
              <div className="text-xs text-muted-foreground">Always reserved for oven ambient temperature</div>
            </div>
            <div className="font-mono text-lg">
              {ambientC != null ? `${ambientC.toFixed(1)}°C` : "—"}
            </div>
          </CardContent>
        </Card>

        <h2 className="text-sm font-medium text-muted-foreground">
          Which doughs are in the oven?
        </h2>

        {(!doughs || doughs.length === 0) ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">
            No active doughs available.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {doughs.map((d) => {
              const sel = selected.get(d.id);
              const isSelected = !!sel;
              const isPrimary = d.id === primaryItemId;
              const takenByOthers = probesTakenBy(d.id);
              const currentProbeReading = probeValue(inkbird, sel?.probe ?? null);

              return (
                <Card
                  key={d.id}
                  className={isSelected ? "border-primary" : ""}
                >
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
                            updateDough(d.id, { probe: v ? (Number(v) as ProbeNumber) : null })
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
                            : currentProbeReading != null
                            ? `${currentProbeReading.toFixed(1)}°C`
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
          disabled={totalLoaves === 0}
          onClick={() => setStep(2)}
        >Next: bake results →</Button>
        <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>Cancel</Button>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Step 2 — results
  // ------------------------------------------------------------------
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Bake results</h1>
        <Badge variant="outline">Step 2/2</Badge>
      </div>

      <div className="text-xs text-muted-foreground">
        {totalLoaves} loaf{totalLoaves === 1 ? "" : "s"} · ambient{" "}
        {ambientC != null ? `${ambientC.toFixed(1)}°C` : "—"}
      </div>

      {/* Shared oven settings */}
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

      {/* Per-loaf readings */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Per-loaf readings</h2>
        {selectedList.map((d) => {
          const liveTemp = probeValue(inkbird, d.probe);
          return (
            <Card key={d.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-medium">{d.short_id}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {d.probe ? `Probe ${d.probe}` : "no probe"}
                    </span>
                  </div>
                  {d.probe != null && liveTemp != null && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateDough(d.id, { internal_temp_c: liveTemp.toFixed(1) })
                      }
                    >
                      Use live {liveTemp.toFixed(1)}°C
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Internal temp (°C)</Label>
                    <Input
                      inputMode="numeric"
                      value={d.internal_temp_c}
                      onChange={(e) => updateDough(d.id, { internal_temp_c: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Loaf weight (g)</Label>
                    <Input
                      inputMode="numeric"
                      value={d.loaf_weight_g}
                      onChange={(e) => updateDough(d.id, { loaf_weight_g: e.target.value })}
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
        {totalLoaves > 1 ? `Save bake (${totalLoaves} loaves)` : "Save bake"}
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>
        ← Back
      </Button>
    </div>
  );
}
