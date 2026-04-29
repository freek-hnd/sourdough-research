import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useStations } from "@/hooks/useStations";
import { useCreateBatch, type NewBatchInput } from "@/hooks/useMutations";
import { StarterPicker } from "@/components/StarterPicker";
import { Minus, Plus } from "lucide-react";
import { formatElapsed, generateShortId } from "@/lib/utils";

type Mode = "choose" | "dough" | "starter";
type SaveableMode = "dough" | "starter";

interface Child {
  weight_g: number;
  container_type: string;
  station_id: number | null;
  inkbird_probe: number | null;
  // Per-jar ingredient amounts for the multi-jar starter flow. Stored
  // as numbers; "" / unset means the user hasn't filled this field.
  flour_g?: number;
  water_g?: number;
  starter_g?: number;
  whole_flour_g?: number;
}

// Container suggestions shown in the typeahead datalist. Free text is
// also accepted so the user can type "Mason 1L" or whatever they actually
// have in the kitchen.
const CONTAINER_SUGGESTIONS = [
  "Jar (starter)",
  "Jar (large)",
  "Banneton",
  "Bowl",
  "Other",
];

// One storage slot per flow so you can have a dough in progress AND a
// starter refresh in progress at the same time without one overwriting
// the other. Legacy key is migrated on load.
const LEGACY_STORAGE_KEY = "sourdough_batch_wizard";
const STORAGE_KEYS: Record<SaveableMode, string> = {
  dough:   "sourdough_batch_wizard_dough",
  starter: "sourdough_batch_wizard_starter",
};

interface WizardState {
  mode: Mode;
  step: number;
  rootStarterId: string;
  parentItemId: string | null;
  parentGeneration: number;
  parentLabel: string;
  flour: string;
  water: string;
  wholeFlour: string;
  starterG: string;
  salt: string;
  extras: string;
  containerType: string;
  mixedAt: string;
  numChildren: number;
  children: Child[];
  stationId: number | null;
  notes: string;
}

function loadWizardState(mode: SaveableMode): Partial<WizardState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[mode]);
    if (raw) return JSON.parse(raw) as Partial<WizardState>;
    // One-time migration: if we only have the legacy single-key save
    // and its mode matches the requested mode, use it.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<WizardState>;
      if (parsed.mode === mode) {
        localStorage.setItem(STORAGE_KEYS[mode], legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function clearWizardState(mode: SaveableMode) {
  localStorage.removeItem(STORAGE_KEYS[mode]);
  // Also clear the legacy key if it was for this mode, so the user
  // doesn't see a ghost resume banner after discarding.
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<WizardState>;
      if (parsed.mode === mode) localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

export function BatchNewPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // Initial mode: ?resume=dough|starter picks the right saved slot on load.
  // Otherwise start at the choose screen so the user can see BOTH in-progress
  // flows and decide which to work on.
  const resumeParam = searchParams.get("resume");
  const parentParam = searchParams.get("parent");
  const initialMode: Mode =
    resumeParam === "dough" || resumeParam === "starter"
      ? resumeParam
      : parentParam
      ? "starter"
      : "choose";
  // Parent deep link always starts a fresh starter flow so the picker
  // opens cleanly; otherwise restore from the per-mode slot if any.
  const initial: Partial<WizardState> | null =
    initialMode === "choose" || parentParam ? null : loadWizardState(initialMode);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState(initial?.step ?? 1);

  const [rootStarterId, setRootStarterId] = useState(initial?.rootStarterId ?? "");
  const [parentItemId, setParentItemId] = useState<string | null>(initial?.parentItemId ?? null);
  const [parentGeneration, setParentGeneration] = useState(initial?.parentGeneration ?? 0);
  const [parentLabel, setParentLabel] = useState(initial?.parentLabel ?? "");
  const [flour, setFlour] = useState(initial?.flour ?? "");
  const [water, setWater] = useState(initial?.water ?? "");
  const [wholeFlour, setWholeFlour] = useState(initial?.wholeFlour ?? "");
  const [starterG, setStarterG] = useState(initial?.starterG ?? "");
  const [salt, setSalt] = useState(initial?.salt ?? "");
  const [extras, setExtras] = useState(initial?.extras ?? "");
  const [containerType, setContainerType] = useState(
    initial?.containerType ?? (initialMode === "starter" ? "jar-starter" : "default"),
  );
  const [mixedAt, setMixedAt] = useState<string>(initial?.mixedAt ?? "");
  const [numChildren, setNumChildren] = useState(initial?.numChildren ?? 3);
  const [children, setChildren] = useState<Child[]>(initial?.children ?? []);
  const [stationId, setStationId] = useState<number | null>(initial?.stationId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const { data: stations = [] } = useStations();
  const createBatch = useCreateBatch();

  // Apply a saved state (or defaults) to all the individual fields. Used
  // when switching modes from the choose screen so you don't see stale
  // fields from a previous session.
  const applyState = useCallback((newMode: SaveableMode, s: Partial<WizardState> | null) => {
    setStep(s?.step ?? 1);
    setRootStarterId(s?.rootStarterId ?? "");
    setParentItemId(s?.parentItemId ?? null);
    setParentGeneration(s?.parentGeneration ?? 0);
    setParentLabel(s?.parentLabel ?? "");
    setFlour(s?.flour ?? "");
    setWater(s?.water ?? "");
    setWholeFlour(s?.wholeFlour ?? "");
    setStarterG(s?.starterG ?? "");
    setSalt(s?.salt ?? "");
    setExtras(s?.extras ?? "");
    setContainerType(s?.containerType ?? (newMode === "starter" ? "jar-starter" : "default"));
    setMixedAt(s?.mixedAt ?? "");
    setNumChildren(s?.numChildren ?? 3);
    setChildren(s?.children ?? []);
    setStationId(s?.stationId ?? null);
    setNotes(s?.notes ?? "");
  }, []);

  const pickMode = useCallback((newMode: SaveableMode) => {
    const s = loadWizardState(newMode);
    applyState(newMode, s);
    setMode(newMode);
  }, [applyState]);

  // Persist wizard state to the slot that matches the current mode.
  // When mode === "choose" we don't touch storage.
  useEffect(() => {
    if (mode === "choose") return;
    const state: WizardState = {
      mode, step, rootStarterId, parentItemId, parentGeneration, parentLabel,
      flour, water, wholeFlour, starterG, salt, extras, containerType, mixedAt,
      numChildren, children, stationId, notes,
    };
    localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(state));
  }, [mode, step, rootStarterId, parentItemId, parentGeneration, parentLabel,
      flour, water, wholeFlour, starterG, salt, extras, containerType, mixedAt,
      numChildren, children, stationId, notes]);

  const reset = useCallback(() => {
    if (mode === "dough" || mode === "starter") clearWizardState(mode);
    setMode("choose");
    setStep(1);
    setRootStarterId("");
    setParentItemId(null);
    setParentGeneration(0);
    setParentLabel("");
    setFlour("");
    setWater("");
    setWholeFlour("");
    setStarterG("");
    setSalt("");
    setExtras("");
    setContainerType("default");
    setMixedAt("");
    setNumChildren(3);
    setChildren([]);
    setStationId(null);
    setNotes("");
  }, [mode]);

  if (mode === "choose") {
    const doughInProgress = loadWizardState("dough");
    const starterInProgress = loadWizardState("starter");
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-lg font-semibold">Start new batch</h1>
        <div className="grid gap-3">
          <Card
            className={`cursor-pointer hover:bg-accent/50 ${doughInProgress ? "border-amber-500" : ""}`}
            onClick={() => pickMode("dough")}
          >
            <CardContent className="p-6 text-center">
              <div className="text-xl font-semibold">🍞 Dough</div>
              <div className="text-sm text-muted-foreground">Pre-dough → final mix → divide</div>
              {doughInProgress && (
                <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  In progress — step {doughInProgress.step}/5
                </div>
              )}
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer hover:bg-accent/50 ${starterInProgress ? "border-amber-500" : ""}`}
            onClick={() => pickMode("starter")}
          >
            <CardContent className="p-6 text-center">
              <div className="text-xl font-semibold">🌾 Starter refresh</div>
              <div className="text-sm text-muted-foreground">Feed one starter</div>
              {starterInProgress && (
                <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  In progress — step {starterInProgress.step}/2
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mode === "starter") {
    const starterNumChildren = numChildren > 1 ? numChildren : 1;

    // Step 1: Pick parent starter
    if (step === 1) {
      return (
        <div className="space-y-4 p-4">
          <h1 className="text-lg font-semibold">Which starter are you refreshing?</h1>
          <StarterPicker
            onSelect={({ parentItemId: pid, parentGeneration: pg, rootStarterId: rsId, label }) => {
              setParentItemId(pid);
              setParentGeneration(pg);
              setRootStarterId(rsId);
              setParentLabel(label);
              setStep(2);
            }}
          />
          <Button variant="ghost" onClick={reset} className="w-full">Cancel</Button>
        </div>
      );
    }

    // Step 2: Feed amounts + split option
    if (step === 2) {
      return (
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Feed starter</h1>
            <Badge variant="outline">From: {parentLabel}</Badge>
          </div>

          {/* Number of jars first — choosing >1 unlocks per-jar inputs below. */}
          <div>
            <Label>Number of jars</Label>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  variant={starterNumChildren === n ? "default" : "outline"}
                  className="flex-1 h-12"
                  onClick={() => setNumChildren(n)}
                >{n}</Button>
              ))}
            </div>
          </div>

          {starterNumChildren === 1 && (
            <>
              {/* Single jar: shared ingredient row, order: water → flour → whole flour → starter */}
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1"><Label>Water (g)</Label><Input inputMode="numeric" value={water} onChange={(e) => setWater(e.target.value)} /></div>
                <div className="space-y-1"><Label>Flour (g)</Label><Input inputMode="numeric" value={flour} onChange={(e) => setFlour(e.target.value)} /></div>
                <div className="space-y-1"><Label>Whole (g)</Label><Input inputMode="numeric" value={wholeFlour} onChange={(e) => setWholeFlour(e.target.value)} placeholder="0" /></div>
                <div className="space-y-1"><Label>Starter (g)</Label><Input inputMode="numeric" value={starterG} onChange={(e) => setStarterG(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Container</Label>
                  <Input
                    type="text"
                    list="container-options"
                    value={containerType}
                    onChange={(e) => setContainerType(e.target.value)}
                    placeholder="Jar (starter)"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Station</Label>
                  <Select value={stationId?.toString() ?? ""} onValueChange={(v) => setStationId(v ? Number(v) : null)}>
                    <SelectTrigger>
                      <SelectValue placeholder="No station">
                        {stationId ? `#${stationId} ${stations.find((s) => s.id === stationId)?.label ?? ""}` : "No station"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {stations.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>#{s.id} {s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {starterNumChildren > 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Each jar can have its own recipe. Order: water → flour → whole → starter.
              </p>
              {Array.from({ length: starterNumChildren }, (_, i) => {
                const c = children[i] ?? {} as Partial<Child>;
                const updateChild = (patch: Partial<Child>) => {
                  const next = [...children];
                  // Spread defaults first, then existing values, then the
                  // patch — ordered so explicit values always win.
                  const existing: Partial<Child> = next[i] ?? {};
                  next[i] = {
                    weight_g: existing.weight_g ?? 0,
                    container_type: existing.container_type ?? "Jar (starter)",
                    station_id: existing.station_id ?? null,
                    inkbird_probe: existing.inkbird_probe ?? null,
                    ...existing,
                    ...patch,
                  };
                  setChildren(next);
                };
                return (
                  <div
                    key={i}
                    className="space-y-2 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-8 font-mono text-sm font-semibold">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <Input
                        type="text"
                        list="container-options"
                        value={c.container_type ?? ""}
                        onChange={(e) => updateChild({ container_type: e.target.value })}
                        placeholder="Jar (starter)"
                        className="flex-1"
                      />
                      <Select
                        value={c.station_id?.toString() ?? ""}
                        onValueChange={(v) =>
                          updateChild({ station_id: v ? Number(v) : null })
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder="No station">
                            {c.station_id
                              ? `#${c.station_id}`
                              : "No station"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {stations.map((s) => (
                            <SelectItem key={s.id} value={s.id.toString()}>
                              #{s.id} {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Water</Label>
                        <Input
                          inputMode="numeric"
                          value={c.water_g ?? ""}
                          onChange={(e) =>
                            updateChild({
                              water_g: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Flour</Label>
                        <Input
                          inputMode="numeric"
                          value={c.flour_g ?? ""}
                          onChange={(e) =>
                            updateChild({
                              flour_g: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Whole</Label>
                        <Input
                          inputMode="numeric"
                          value={c.whole_flour_g ?? ""}
                          onChange={(e) =>
                            updateChild({
                              whole_flour_g: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Starter</Label>
                        <Input
                          inputMode="numeric"
                          value={c.starter_g ?? ""}
                          onChange={(e) =>
                            updateChild({
                              starter_g: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Datalist powering the typeahead Container input. */}
          <datalist id="container-options">
            {CONTAINER_SUGGESTIONS.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>

          <Button
            className="h-12 w-full"
            disabled={(() => {
              if (createBatch.isPending) return true;
              if (starterNumChildren === 1) {
                return !water || !flour || !starterG;
              }
              // Multi-jar: every jar must have water, flour, and starter.
              for (let i = 0; i < starterNumChildren; i++) {
                const c = children[i];
                if (!c || c.water_g == null || c.flour_g == null || c.starter_g == null) return true;
              }
              return false;
            })()}
            onClick={async () => {
              const now = new Date().toISOString();
              let childrenPayload: NewBatchInput["children"];
              let batchFlour: number;
              let batchWater: number;
              let batchStarter: number;
              let batchWholeFlour: number;

              if (starterNumChildren === 1) {
                const w = Number(water) || 0;
                const f = Number(flour) || 0;
                const wf = Number(wholeFlour) || 0;
                const s = Number(starterG) || 0;
                const total = w + f + wf + s;
                childrenPayload = [{
                  weight_g: total,
                  container_type: containerType || "Jar (starter)",
                  station_id: stationId,
                  inkbird_probe: null,
                  water_g: w,
                  flour_g: f,
                  whole_flour_g: wf,
                  starter_g: s,
                }];
                batchWater = w;
                batchFlour = f;
                batchWholeFlour = wf;
                batchStarter = s;
              } else {
                // Per-jar: each jar's weight is the sum of its own ingredients.
                childrenPayload = Array.from({ length: starterNumChildren }, (_, i) => {
                  const c = children[i];
                  const w = c?.water_g ?? 0;
                  const f = c?.flour_g ?? 0;
                  const wf = c?.whole_flour_g ?? 0;
                  const s = c?.starter_g ?? 0;
                  return {
                    weight_g: w + f + wf + s,
                    container_type: c?.container_type || "Jar (starter)",
                    station_id: c?.station_id ?? null,
                    inkbird_probe: null,
                    water_g: w,
                    flour_g: f,
                    whole_flour_g: wf,
                    starter_g: s,
                  };
                });
                // Batch-level totals are sums across jars.
                batchWater = childrenPayload.reduce((a, c) => a + (c.water_g ?? 0), 0);
                batchFlour = childrenPayload.reduce((a, c) => a + (c.flour_g ?? 0), 0);
                batchWholeFlour = childrenPayload.reduce((a, c) => a + (c.whole_flour_g ?? 0), 0);
                batchStarter = childrenPayload.reduce((a, c) => a + (c.starter_g ?? 0), 0);
              }

              try {
                await createBatch.mutateAsync({
                  type: "starter",
                  root_starter_id: rootStarterId,
                  parent_item_id: parentItemId,
                  parent_generation: parentGeneration,
                  flour_g: batchFlour,
                  water_g: batchWater,
                  starter_g: batchStarter,
                  whole_flour_g: batchWholeFlour > 0 ? batchWholeFlour : null,
                  salt_g: null,
                  extras_json: null,
                  mixed_at: now,
                  notes: null,
                  children: childrenPayload,
                });
                clearWizardState("starter");
                toast.success(starterNumChildren > 1 ? `Split into ${starterNumChildren} jars` : "Starter refreshed");
                nav("/");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >Feed & start{starterNumChildren > 1 ? ` ${starterNumChildren} sessions` : " session"}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setStep(1)}>Back</Button>
            <Button variant="ghost" className="flex-1" onClick={reset}>Cancel</Button>
          </div>
        </div>
      );
    }

    // Fallback — shouldn't happen
    return null;
  }

  // Dough flow
  const flourN = Number(flour) || 0;
  const waterN = Number(water) || 0;
  const starterN = Number(starterG) || 0;
  const saltN = Number(salt) || 0;
  const wholeFlourN = Number(wholeFlour) || 0;
  const totalG = flourN + waterN + wholeFlourN + starterN + saltN;

  function ensureChildren(n: number): Child[] {
    const equal = Math.round(totalG / n);
    return Array.from({ length: n }, (_, i) => children[i] ?? {
      weight_g: equal,
      container_type: "default",
      station_id: null,
      inkbird_probe: null,
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">New dough batch</h1>
        <Badge variant="outline">Step {step}/5</Badge>
      </div>

      {step === 1 && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">Which starter are you using?</h2>
          <StarterPicker
            onSelect={({ parentItemId: pid, parentGeneration: pg, rootStarterId: rsId, label }) => {
              setParentItemId(pid);
              setParentGeneration(pg);
              setRootStarterId(rsId);
              setParentLabel(label);
              setStep(2);
            }}
          />
        </>
      )}

      {step === 2 && (
        <>
          <Badge variant="outline">Starter: {parentLabel}</Badge>
          {/* Order: water → flour → whole flour. Whole flour is optional;
              empty defaults to 0 in the totals. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label>Water (g)</Label><Input inputMode="numeric" value={water} onChange={(e) => setWater(e.target.value)} /></div>
            <div className="space-y-1"><Label>Flour (g)</Label><Input inputMode="numeric" value={flour} onChange={(e) => setFlour(e.target.value)} /></div>
            <div className="space-y-1"><Label>Whole (g)</Label><Input inputMode="numeric" value={wholeFlour} onChange={(e) => setWholeFlour(e.target.value)} placeholder="0" /></div>
          </div>
          <div className="space-y-1">
            <Label>Container</Label>
            <Input
              type="text"
              list="container-options"
              value={containerType}
              onChange={(e) => setContainerType(e.target.value)}
              placeholder="Default"
            />
          </div>
          <datalist id="container-options">
            {CONTAINER_SUGGESTIONS.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
          <Button
            className="h-12 w-full"
            disabled={!flour || !water}
            onClick={() => {
              setMixedAt(new Date().toISOString());
              setStep(3);
            }}
          >Start autolyse →</Button>
          <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>Back</Button>
        </>
      )}

      {step === 3 && (
        <>
          <Badge>Autolyse: {mixedAt ? formatElapsed(mixedAt) : "-"}</Badge>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Starter (g)</Label><Input inputMode="numeric" value={starterG} onChange={(e) => setStarterG(e.target.value)} /></div>
            <div className="space-y-1"><Label>Salt (g)</Label><Input inputMode="numeric" value={salt} onChange={(e) => setSalt(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Extras (optional)</Label>
            <Input value={extras} onChange={(e) => setExtras(e.target.value)} placeholder="seeds, rye, etc." />
          </div>
          <Button className="h-12 w-full" disabled={!starterG || !salt} onClick={() => { setChildren(ensureChildren(numChildren)); setStep(4); }}>Mix done → Divide</Button>
          <Button variant="ghost" className="w-full" onClick={() => setStep(2)}>Back</Button>
        </>
      )}

      {step === 4 && (
        <>
          <div className="text-sm text-muted-foreground">Total: {totalG} g</div>
          <div>
            <Label>Number of balls</Label>
            {/* Quick pick for the common case */}
            <div className="mt-2 flex gap-2">
              {[2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  variant={numChildren === n ? "default" : "outline"}
                  className="flex-1 h-12"
                  onClick={() => { setNumChildren(n); setChildren(ensureChildren(n)); }}
                >{n}</Button>
              ))}
            </div>
            {/* +/- controls for 6-15 — tap-friendly with floury hands */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">or more:</span>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12"
                disabled={numChildren <= 2}
                onClick={() => {
                  const n = Math.max(2, numChildren - 1);
                  setNumChildren(n);
                  setChildren(ensureChildren(n));
                }}
              ><Minus className="size-4" /></Button>
              <div
                className={`flex-1 text-center font-mono text-lg ${
                  numChildren > 5 ? "font-bold" : "text-muted-foreground"
                }`}
              >
                {numChildren > 5 ? numChildren : "—"}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12"
                disabled={numChildren >= 15}
                onClick={() => {
                  const n = Math.min(15, Math.max(6, numChildren + 1));
                  setNumChildren(n);
                  setChildren(ensureChildren(n));
                }}
              ><Plus className="size-4" /></Button>
            </div>
          </div>
          <div className="space-y-2">
            {children.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-8 font-mono">{String.fromCharCode(65 + i)}</span>
                <Input
                  inputMode="numeric"
                  value={c.weight_g}
                  onChange={(e) => {
                    const next = [...children];
                    next[i] = { ...c, weight_g: Number(e.target.value) || 0 };
                    setChildren(next);
                  }}
                />
                <span className="text-sm text-muted-foreground">g</span>
              </div>
            ))}
          </div>
          <Button className="h-12 w-full" onClick={() => setStep(5)}>Assign stations →</Button>
          <Button variant="ghost" className="w-full" onClick={() => setStep(3)}>Back</Button>
        </>
      )}

      {step === 5 && (
        <>
          <div className="space-y-3">
            {children.map((c, i) => {
              const shortId = generateShortId("dough", new Date(mixedAt || Date.now()), i);
              return (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="font-mono">{shortId}</span>
                      <span className="text-sm text-muted-foreground">{c.weight_g} g</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2">
                    <Select
                      value={c.station_id?.toString() ?? ""}
                      onValueChange={(v) => {
                        const next = [...children];
                        next[i] = { ...c, station_id: v ? Number(v) : null };
                        setChildren(next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No station">
                          {c.station_id ? `#${c.station_id}` : "No station"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {stations.map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>#{s.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={c.inkbird_probe?.toString() ?? ""}
                      onValueChange={(v) => {
                        const next = [...children];
                        next[i] = { ...c, inkbird_probe: v ? Number(v) : null };
                        setChildren(next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Probe —">
                          {c.inkbird_probe ? `Probe ${c.inkbird_probe}` : "Probe —"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4].map((n) => (
                          <SelectItem key={n} value={n.toString()}>Probe {n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Textarea placeholder="Batch notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button
            className="h-12 w-full"
            disabled={createBatch.isPending}
            onClick={async () => {
              try {
                await createBatch.mutateAsync({
                  type: "dough",
                  root_starter_id: rootStarterId,
                  parent_item_id: parentItemId,
                  parent_generation: parentGeneration,
                  flour_g: flourN,
                  water_g: waterN,
                  starter_g: starterN,
                  salt_g: saltN,
                  whole_flour_g: wholeFlourN > 0 ? wholeFlourN : null,
                  extras_json: extras ? { note: extras } : null,
                  mixed_at: mixedAt || new Date().toISOString(),
                  notes: notes || null,
                  children: children.map((c) => ({
                    weight_g: c.weight_g,
                    container_type: containerType,
                    station_id: c.station_id,
                    inkbird_probe: c.inkbird_probe,
                  })),
                });
                clearWizardState("dough");
                toast.success(`Batch created — ${children.length} items`);
                nav("/");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >Create batch & start sessions</Button>
        </>
      )}

      <Button variant="ghost" className="w-full" onClick={reset}>Cancel</Button>
    </div>
  );
}
