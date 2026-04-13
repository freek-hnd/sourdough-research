import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useRootStarters } from "@/hooks/useRootStarters";
import { useStations } from "@/hooks/useStations";
import { useCreateBatch } from "@/hooks/useMutations";
import { formatElapsed, generateShortId } from "@/lib/utils";

type Mode = "choose" | "dough" | "starter";

interface Child {
  weight_g: number;
  container_type: string;
  station_id: number | null;
  inkbird_probe: number | null;
}

const WIZARD_STORAGE_KEY = "sourdough_batch_wizard";

interface WizardState {
  mode: Mode;
  step: number;
  rootStarterId: string;
  flour: string;
  water: string;
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

function loadWizardState(): Partial<WizardState> | null {
  try {
    const raw = localStorage.getItem(WIZARD_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<WizardState>;
  } catch {
    return null;
  }
}

function clearWizardState() {
  localStorage.removeItem(WIZARD_STORAGE_KEY);
}

export function BatchNewPage() {
  const nav = useNavigate();
  const saved = loadWizardState();

  const [mode, setMode] = useState<Mode>(saved?.mode ?? "choose");
  const [step, setStep] = useState(saved?.step ?? 1);

  const [rootStarterId, setRootStarterId] = useState(saved?.rootStarterId ?? "");
  const [flour, setFlour] = useState(saved?.flour ?? "");
  const [water, setWater] = useState(saved?.water ?? "");
  const [starterG, setStarterG] = useState(saved?.starterG ?? "");
  const [salt, setSalt] = useState(saved?.salt ?? "");
  const [extras, setExtras] = useState(saved?.extras ?? "");
  const [containerType, setContainerType] = useState(saved?.containerType ?? "default");
  const [mixedAt, setMixedAt] = useState<string>(saved?.mixedAt ?? "");
  const [numChildren, setNumChildren] = useState(saved?.numChildren ?? 3);
  const [children, setChildren] = useState<Child[]>(saved?.children ?? []);
  const [stationId, setStationId] = useState<number | null>(saved?.stationId ?? null);
  const [notes, setNotes] = useState(saved?.notes ?? "");

  const { data: starters = [] } = useRootStarters();
  const { data: stations = [] } = useStations();
  const createBatch = useCreateBatch();

  // Persist wizard state to localStorage on every change
  useEffect(() => {
    if (mode === "choose") {
      clearWizardState();
      return;
    }
    const state: WizardState = {
      mode, step, rootStarterId, flour, water, starterG,
      salt, extras, containerType, mixedAt, numChildren,
      children, stationId, notes,
    };
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state));
  }, [mode, step, rootStarterId, flour, water, starterG, salt, extras,
      containerType, mixedAt, numChildren, children, stationId, notes]);

  const reset = useCallback(() => {
    clearWizardState();
    setMode("choose");
    setStep(1);
    setRootStarterId("");
    setFlour("");
    setWater("");
    setStarterG("");
    setSalt("");
    setExtras("");
    setContainerType("default");
    setMixedAt("");
    setNumChildren(3);
    setChildren([]);
    setStationId(null);
    setNotes("");
  }, []);

  if (mode === "choose") {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-lg font-semibold">Start new batch</h1>
        <div className="grid gap-3">
          <Card
            className="cursor-pointer hover:bg-accent/50"
            onClick={() => {
              setMode("dough");
              setStep(1);
            }}
          >
            <CardContent className="p-6 text-center">
              <div className="text-xl font-semibold">🍞 Dough</div>
              <div className="text-sm text-muted-foreground">Pre-dough → final mix → divide</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:bg-accent/50"
            onClick={() => {
              setMode("starter");
              setContainerType("jar-starter");
              setStep(1);
            }}
          >
            <CardContent className="p-6 text-center">
              <div className="text-xl font-semibold">🌾 Starter refresh</div>
              <div className="text-sm text-muted-foreground">Feed one starter</div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mode === "starter") {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-lg font-semibold">Starter refresh</h1>
        <div className="space-y-2">
          <Label>Root starter</Label>
          <Select value={rootStarterId} onValueChange={(v) => setRootStarterId(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {starters.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1"><Label>Flour (g)</Label><Input inputMode="numeric" value={flour} onChange={(e) => setFlour(e.target.value)} /></div>
          <div className="space-y-1"><Label>Water (g)</Label><Input inputMode="numeric" value={water} onChange={(e) => setWater(e.target.value)} /></div>
          <div className="space-y-1"><Label>Starter (g)</Label><Input inputMode="numeric" value={starterG} onChange={(e) => setStarterG(e.target.value)} /></div>
        </div>
        <div className="space-y-1">
          <Label>Container</Label>
          <Select value={containerType} onValueChange={(v) => setContainerType(v ?? "jar-starter")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="jar-starter">Jar (starter)</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Station</Label>
          <Select value={stationId?.toString() ?? ""} onValueChange={(v) => setStationId(v ? Number(v) : null)}>
            <SelectTrigger><SelectValue placeholder="No station" /></SelectTrigger>
            <SelectContent>
              {stations.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>#{s.id} {s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="h-12 w-full"
          disabled={!rootStarterId || !flour || !water || !starterG || createBatch.isPending}
          onClick={async () => {
            const now = new Date().toISOString();
            const totalG = Number(flour) + Number(water) + Number(starterG);
            try {
              await createBatch.mutateAsync({
                type: "starter",
                root_starter_id: rootStarterId,
                parent_item_id: null,
                flour_g: Number(flour),
                water_g: Number(water),
                starter_g: Number(starterG),
                salt_g: null,
                extras_json: null,
                mixed_at: now,
                notes: null,
                children: [{ weight_g: totalG, container_type: containerType, station_id: stationId, inkbird_probe: null }],
              });
              clearWizardState();
              toast.success("Starter refreshed");
              nav("/");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >Feed & start session</Button>
        <Button variant="ghost" onClick={reset} className="w-full">Cancel</Button>
      </div>
    );
  }

  // Dough flow
  const flourN = Number(flour) || 0;
  const waterN = Number(water) || 0;
  const starterN = Number(starterG) || 0;
  const saltN = Number(salt) || 0;
  const totalG = flourN + waterN + starterN + saltN;

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
        <Badge variant="outline">Step {step}/4</Badge>
      </div>

      {step === 1 && (
        <>
          <div className="space-y-1">
            <Label>Parent starter</Label>
            <Select value={rootStarterId} onValueChange={(v) => setRootStarterId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {starters.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Flour (g)</Label><Input inputMode="numeric" value={flour} onChange={(e) => setFlour(e.target.value)} /></div>
            <div className="space-y-1"><Label>Water (g)</Label><Input inputMode="numeric" value={water} onChange={(e) => setWater(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Container</Label>
            <Select value={containerType} onValueChange={(v) => setContainerType(v ?? "default")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="banneton">Banneton</SelectItem>
                <SelectItem value="bowl">Bowl</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="h-12 w-full"
            disabled={!rootStarterId || !flour || !water}
            onClick={() => {
              setMixedAt(new Date().toISOString());
              setStep(2);
            }}
          >Start autolyse →</Button>
        </>
      )}

      {step === 2 && (
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
          <Button className="h-12 w-full" disabled={!starterG || !salt} onClick={() => { setChildren(ensureChildren(numChildren)); setStep(3); }}>Mix done → Divide</Button>
        </>
      )}

      {step === 3 && (
        <>
          <div className="text-sm text-muted-foreground">Total: {totalG} g</div>
          <div>
            <Label>Number of balls</Label>
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
          <Button className="h-12 w-full" onClick={() => setStep(4)}>Assign stations →</Button>
        </>
      )}

      {step === 4 && (
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
                      <SelectTrigger><SelectValue placeholder="No station" /></SelectTrigger>
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
                      <SelectTrigger><SelectValue placeholder="Probe —" /></SelectTrigger>
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
                  parent_item_id: null,
                  flour_g: flourN,
                  water_g: waterN,
                  starter_g: starterN,
                  salt_g: saltN,
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
                clearWizardState();
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
