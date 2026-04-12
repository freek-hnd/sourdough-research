import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useItem, useActiveSessionForItem } from "@/hooks/useItem";
import { useSaveOutcome } from "@/hooks/useMutations";

const DIMENSIONS = ["oven_spring", "crumb", "crust", "taste", "acidity", "aroma"] as const;

export function OutcomePage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading } = useItem(shortId);
  const { data: session } = useActiveSessionForItem(item?.id);
  const save = useSaveOutcome();

  const [ovenTemp, setOvenTemp] = useState("");
  const [duration, setDuration] = useState("");
  const [loafWeight, setLoafWeight] = useState("");
  const [internalTemp, setInternalTemp] = useState("");
  const [notes, setNotes] = useState("");
  const [raterName, setRaterName] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<File | null>(null);

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

    try {
      await save.mutateAsync({
        item_id: item.id,
        session_id: session?.id ?? null,
        outcome: {
          loaf_weight_g: loafWeight ? Number(loafWeight) : null,
          bake_temp_c: ovenTemp ? Number(ovenTemp) : null,
          bake_duration_min: duration ? Number(duration) : null,
          internal_temp_c: internalTemp ? Number(internalTemp) : null,
          notes: notes || null,
          baked_at: new Date().toISOString(),
        },
        rating: raterName && Object.keys(scores).length > 0
          ? { rater_name: raterName, scores_json: scores, notes: null }
          : null,
        photo_url: photoUrl,
      });
      toast.success("Outcome saved");
      nav("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Bake outcome — <span className="font-mono">{item.short_id}</span></h1>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label>Oven temp (°C)</Label><Input inputMode="numeric" value={ovenTemp} onChange={(e) => setOvenTemp(e.target.value)} /></div>
        <div className="space-y-1"><Label>Duration (min)</Label><Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
        <div className="space-y-1"><Label>Loaf weight (g)</Label><Input inputMode="numeric" value={loafWeight} onChange={(e) => setLoafWeight(e.target.value)} /></div>
        <div className="space-y-1"><Label>Internal temp (°C)</Label><Input inputMode="numeric" value={internalTemp} onChange={(e) => setInternalTemp(e.target.value)} /></div>
      </div>

      <div className="space-y-1">
        <Label>Photo</Label>
        <Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </div>

      <Separator />
      <h2 className="text-sm font-medium text-muted-foreground">Rating</h2>
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

      <Button className="h-12 w-full" onClick={submit} disabled={save.isPending}>Save outcome</Button>
      <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>Cancel</Button>
    </div>
  );
}
