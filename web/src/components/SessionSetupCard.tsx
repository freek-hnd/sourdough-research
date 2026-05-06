/**
 * Session calibration setup form.
 *
 * Lets the user retro-actively (or up-front) tag a session with the
 * physical setup needed to compute volume:
 *   - jar_id            — which jar (geometry / cross_section_area)
 *   - setup_height_mm   — how high above the station's reference plane
 *   - pixel_subset      — which pixels to feed into volume calc
 *   - manual_pixel_mask — only used when pixel_subset === 'manual'
 *
 * No clever auto-detection — the user knows their experiments better
 * than any heuristic would. The form preloads from the session row so
 * editing is non-destructive.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useJars } from "@/hooks/useJars";
import { useSession, useStation } from "@/hooks/useItem";
import { useUpdateSessionSetup } from "@/hooks/useMutations";
import type { PixelSubset } from "@/lib/types";

interface Props {
  sessionId: string;
}

const SUBSET_OPTIONS: Array<{ value: PixelSubset; label: string }> = [
  { value: "6x6_inner", label: "Inner 6×6 (default)" },
  { value: "4x4_center", label: "Center 4×4" },
  { value: "8x8_all", label: "All 8×8" },
  { value: "manual", label: "Manual selection" },
];

function emptyMask(): number[] {
  return new Array(64).fill(0);
}

export function SessionSetupCard({ sessionId }: Props) {
  const { data: jars = [], isLoading: jarsLoading } = useJars();
  const { data: session } = useSession(sessionId);
  const { data: station } = useStation(
    (session as { station_id?: number } | null | undefined)?.station_id ?? null,
  );
  const update = useUpdateSessionSetup();

  // Local form state.
  const [jarId, setJarId] = useState<string | null>(null);
  const [heightMm, setHeightMm] = useState<string>("");
  const [subset, setSubset] = useState<PixelSubset>("6x6_inner");
  const [manualMask, setManualMask] = useState<number[]>(emptyMask());

  // Hydrate from the session row when it loads / changes.
  useEffect(() => {
    if (!session) return;
    const s = session as {
      jar_id: string | null;
      setup_height_mm: number | null;
      pixel_subset: PixelSubset | null;
      manual_pixel_mask: number[] | null;
    };
    setJarId(s.jar_id);
    setHeightMm(s.setup_height_mm != null ? String(s.setup_height_mm) : "");
    setSubset((s.pixel_subset ?? "6x6_inner") as PixelSubset);
    setManualMask(
      s.manual_pixel_mask && s.manual_pixel_mask.length === 64
        ? s.manual_pixel_mask
        : emptyMask(),
    );
  }, [session]);

  const wallMask = useMemo<number[]>(() => {
    const w = (station as { wall_pixel_mask?: number[] | null } | null | undefined)
      ?.wall_pixel_mask;
    return w && w.length === 64 ? w : emptyMask();
  }, [station]);

  const baselineHeight =
    (station as { baseline_height_mm?: number | null } | null | undefined)
      ?.baseline_height_mm ?? null;
  const hasLinearModel = !!(
    station as { pixel_slope?: number[] | null } | null | undefined
  )?.pixel_slope;

  if (!session) {
    return <Skeleton className="h-32 w-full" />;
  }

  function toggleManualPixel(idx: number) {
    if (wallMask[idx] === 1) return; // wall pixel — never selectable
    setManualMask((prev) => {
      const next = [...prev];
      next[idx] = next[idx] === 1 ? 0 : 1;
      return next;
    });
  }

  async function save() {
    try {
      await update.mutateAsync({
        session_id: sessionId,
        jar_id: jarId,
        setup_height_mm: heightMm === "" ? null : Number(heightMm),
        pixel_subset: subset,
        manual_pixel_mask: subset === "manual" ? manualMask : null,
      });
      toast.success("Session setup saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const heightHint = (() => {
    if (hasLinearModel) {
      return "Station has a multi-height model — any setup_height works.";
    }
    if (baselineHeight != null) {
      return `Station has a single-height baseline at ${baselineHeight} mm. Volume only renders when this exactly matches.`;
    }
    return "Station has no calibration yet — volume won't render until calibration is loaded.";
  })();

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Volume calibration setup
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Jar</Label>
          {jarsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select
              value={jarId ?? "__none__"}
              onValueChange={(v) =>
                setJarId(v === "__none__" || !v ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="None">
                  {jarId
                    ? jars.find((j) => j.id === jarId)?.name ?? "(unknown jar)"
                    : "None"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {jars.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                    {j.cross_section_area_cm2 != null
                      ? ` · ${j.cross_section_area_cm2} cm²`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Setup height (mm)</Label>
          <Input
            inputMode="decimal"
            value={heightMm}
            onChange={(e) => setHeightMm(e.target.value)}
            placeholder={baselineHeight != null ? String(baselineHeight) : "152"}
          />
          <p className="text-[10px] text-muted-foreground">{heightHint}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Pixel subset</Label>
          <Select
            value={subset}
            onValueChange={(v) => v && setSubset(v as PixelSubset)}
          >
            <SelectTrigger>
              <SelectValue>
                {SUBSET_OPTIONS.find((o) => o.value === subset)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUBSET_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {subset === "manual" && (
          <ManualMaskEditor
            mask={manualMask}
            wallMask={wallMask}
            onToggle={toggleManualPixel}
          />
        )}

        <Button
          className="h-10 w-full"
          disabled={update.isPending}
          onClick={save}
        >
          Save setup
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 8×8 click-on/off pixel mask editor. Wall pixels (from station calibration)
// are greyed out and not clickable. Top of the rendered grid = physical Back
// per the orientation calibration (see SOUR_KNOWLEDGE_TRANSFER.md).
// ---------------------------------------------------------------------------

function ManualMaskEditor({
  mask,
  wallMask,
  onToggle,
}: {
  mask: number[];
  wallMask: number[];
  onToggle: (idx: number) => void;
}) {
  const selectedCount = mask.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Click pixels to toggle. Wall pixels are not selectable.</span>
        <span>{selectedCount} selected</span>
      </div>
      <div className="text-center text-[10px] font-medium text-muted-foreground">Back</div>
      <div className="flex items-center gap-1">
        <div className="text-[10px] font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">
          Left
        </div>
        <div className="grid aspect-square w-full max-w-[260px] grid-cols-8 gap-0.5 rounded-md bg-muted p-1">
          {mask.map((v, i) => {
            const isWall = wallMask[i] === 1;
            const isSel = v === 1;
            return (
              <button
                key={i}
                type="button"
                disabled={isWall}
                onClick={() => onToggle(i)}
                className={
                  "aspect-square rounded-sm text-[8px] font-mono transition-colors " +
                  (isWall
                    ? "cursor-not-allowed bg-muted-foreground/20 text-muted-foreground"
                    : isSel
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-card hover:bg-accent")
                }
                aria-label={`pixel ${i}`}
                title={
                  isWall
                    ? `Pixel ${i} (wall)`
                    : isSel
                    ? `Pixel ${i} — selected`
                    : `Pixel ${i}`
                }
              >
                {isWall ? "·" : i}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] font-medium text-muted-foreground [writing-mode:vertical-rl]">
          Right
        </div>
      </div>
      <div className="text-center text-[10px] font-medium text-muted-foreground">Front</div>
    </div>
  );
}
