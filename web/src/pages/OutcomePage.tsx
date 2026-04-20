import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useItem, useActiveSessionForItem } from "@/hooks/useItem";
import { useBatchSiblings } from "@/hooks/useBatchSiblings";
import { useLatestInkbirdReading, probeValue } from "@/hooks/useInkbird";
import { useSaveOutcome } from "@/hooks/useMutations";

const DIMENSIONS = ["oven_spring", "crumb", "crust", "taste", "acidity", "aroma"] as const;

type ProbeNumber = 1 | 2 | 3 | 4;

export function OutcomePage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading } = useItem(shortId);
  const { data: session } = useActiveSessionForItem(item?.id);
  const { data: siblings } = useBatchSiblings(item?.batch_id, item?.id);
  const { data: inkbird } = useLatestInkbirdReading();
  const save = useSaveOutcome();

  const [ovenTemp, setOvenTemp] = useState("");
  const [duration, setDuration] = useState("");
  const [loafWeight, setLoafWeight] = useState("");
  const [internalTemp, setInternalTemp] = useState("");
  const [notes, setNotes] = useState("");
  const [raterName, setRaterName] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [inkbirdProbe, setInkbirdProbe] = useState<ProbeNumber | null>(null);

  // Which siblings are also being baked (keyed by item id)
  const [selectedSiblings, setSelectedSiblings] = useState<Set<string>>(new Set());

  const currentProbeReading = probeValue(inkbird, inkbirdProbe);

  const selectedSiblingList = useMemo(
    () => (siblings ?? []).filter((s) => selectedSiblings.has(s.id)),
    [siblings, selectedSiblings],
  );
  const totalBakingTogether = 1 + selectedSiblingList.length;

  if (isLoading || !item) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;

  async function submit() {
    if (!item) return;
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

    // The outcomes table doesn't have a dedicated inkbird_probe column, so
    // we embed it in notes as a compact prefix the UI / analysis can parse
    // out later: "[Probe 3] actual notes here".
    const notesWithProbe = inkbirdProbe
      ? `[Probe ${inkbirdProbe}]${notes ? ` ${notes}` : ""}`
      : (notes || null);

    // Items baking together: current item + selected siblings
    const items: Array<{ id: string; session_id: string | null }> = [
      { id: item.id, session_id: session?.id ?? null },
      ...selectedSiblingList.map((s) => ({ id: s.id, session_id: s.session_id })),
    ];

    try {
      await save.mutateAsync({
        primary_item_id: item.id,
        items,
        outcome: {
          loaf_weight_g: loafWeight ? Number(loafWeight) : null,
          bake_temp_c: ovenTemp ? Number(ovenTemp) : null,
          bake_duration_min: duration ? Number(duration) : null,
          internal_temp_c: internalTemp ? Number(internalTemp) : null,
          notes: notesWithProbe,
          baked_at: new Date().toISOString(),
        },
        rating: raterName && Object.keys(scores).length > 0
          ? { rater_name: raterName, scores_json: scores, notes: null }
          : null,
        photo_url: photoUrl,
      });
      toast.success(
        totalBakingTogether > 1
          ? `Outcome saved for ${totalBakingTogether} loaves`
          : "Outcome saved",
      );
      nav("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function toggleSibling(id: string) {
    setSelectedSiblings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">
        Bake outcome — <span className="font-mono">{item.short_id}</span>
      </h1>

      {/* Sibling selection — only show if there are other doughs in this batch */}
      {siblings && siblings.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Also baking together?
            </h2>
            <label className="flex items-center gap-2 opacity-70">
              <input
                type="checkbox"
                checked
                disabled
                className="size-4"
              />
              <span className="font-mono text-sm">{item.short_id}</span>
              <span className="text-xs text-muted-foreground">
                ({item.weight_g}g) · current
              </span>
            </label>
            {siblings.map((s) => (
              <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSiblings.has(s.id)}
                  onChange={() => toggleSibling(s.id)}
                  className="size-4"
                />
                <span className="font-mono text-sm">{s.short_id}</span>
                <span className="text-xs text-muted-foreground">({s.weight_g}g)</span>
              </label>
            ))}
            {totalBakingTogether > 1 && (
              <p className="text-xs text-muted-foreground pt-1">
                Same outcome will be logged for all {totalBakingTogether} loaves.
                Rating & photo only on {item.short_id}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Oven temp (°C)</Label>
          <Input inputMode="numeric" value={ovenTemp} onChange={(e) => setOvenTemp(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Duration (min)</Label>
          <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Loaf weight (g)</Label>
          <Input inputMode="numeric" value={loafWeight} onChange={(e) => setLoafWeight(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Internal temp (°C)</Label>
          <Input inputMode="numeric" value={internalTemp} onChange={(e) => setInternalTemp(e.target.value)} />
        </div>
      </div>

      {/* Inkbird probe selector with live reading */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Internal temperature probe
          </h2>
          <div className="flex items-center gap-2">
            <Select
              value={inkbirdProbe?.toString() ?? ""}
              onValueChange={(v) => setInkbirdProbe(v ? (Number(v) as ProbeNumber) : null)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="None">
                  {inkbirdProbe ? `Probe ${inkbirdProbe}` : "None"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={n.toString()}>Probe {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="font-mono text-lg min-w-[5rem] text-right">
              {inkbirdProbe == null
                ? "—"
                : currentProbeReading != null
                ? `${currentProbeReading.toFixed(1)}°C`
                : "—"}
            </div>
          </div>
          {inkbirdProbe != null && currentProbeReading == null && (
            <p className="text-xs text-muted-foreground">
              No reading yet from Probe {inkbirdProbe}. Make sure the
              Inkbird is on and the probe is placed.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1">
        <Label>Photo</Label>
        <Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </div>

      <Separator />
      <h2 className="text-sm font-medium text-muted-foreground">
        Rating {totalBakingTogether > 1 && `(for ${item.short_id} only)`}
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
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>

      <Button className="h-12 w-full" onClick={submit} disabled={save.isPending}>
        {totalBakingTogether > 1
          ? `Save outcome for ${totalBakingTogether} loaves`
          : "Save outcome"}
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>Cancel</Button>
    </div>
  );
}
