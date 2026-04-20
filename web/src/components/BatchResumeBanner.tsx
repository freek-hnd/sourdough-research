import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RotateCcw } from "lucide-react";

// Must stay in sync with BatchNewPage.tsx
const STORAGE_KEYS = {
  dough:   "sourdough_batch_wizard_dough",
  starter: "sourdough_batch_wizard_starter",
} as const;
const LEGACY_STORAGE_KEY = "sourdough_batch_wizard";

type SaveableMode = keyof typeof STORAGE_KEYS;

interface WizardState {
  mode?: "choose" | SaveableMode;
  step?: number;
  parentLabel?: string;
}

const DOUGH_STEPS: Record<number, string> = {
  1: "Choose parent starter",
  2: "Mix flour & water",
  3: "Add starter & salt",
  4: "Divide",
  5: "Assign stations",
};

const STARTER_STEPS: Record<number, string> = {
  1: "Choose parent starter",
  2: "Feed amounts",
};

function readMode(mode: SaveableMode): WizardState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[mode]);
    if (raw) return JSON.parse(raw) as WizardState;
    // Legacy single-key fallback: show it if it matches this mode
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as WizardState;
      if (parsed.mode === mode) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function clearMode(mode: SaveableMode) {
  localStorage.removeItem(STORAGE_KEYS[mode]);
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as WizardState;
      if (parsed.mode === mode) localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

/**
 * Banners for unfinished batch wizards. Shows one row per flow that has
 * a saved state — so you can have a dough in progress AND a starter
 * refresh in progress at the same time, and resume either independently.
 */
export function BatchResumeBanner() {
  const nav = useNavigate();
  const [dough, setDough] = useState<WizardState | null>(() => readMode("dough"));
  const [starter, setStarter] = useState<WizardState | null>(() => readMode("starter"));

  // Re-read when the tab regains focus (another tab may have cleared/updated)
  useEffect(() => {
    const refresh = () => {
      setDough(readMode("dough"));
      setStarter(readMode("starter"));
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const entries: Array<{ mode: SaveableMode; state: WizardState }> = [];
  if (dough)   entries.push({ mode: "dough",   state: dough });
  if (starter) entries.push({ mode: "starter", state: starter });

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map(({ mode, state }) => {
        const isDough = mode === "dough";
        const typeLabel = isDough ? "Dough" : "Starter refresh";
        const stepMap = isDough ? DOUGH_STEPS : STARTER_STEPS;
        const stepLabel = state.step != null ? stepMap[state.step] : undefined;
        const stepDesc = stepLabel
          ? `Step ${state.step}: ${stepLabel}`
          : state.step
          ? `Step ${state.step}`
          : "";

        const discard = () => {
          clearMode(mode);
          if (isDough) setDough(null);
          else setStarter(null);
        };

        return (
          <Card
            key={mode}
            className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30"
          >
            <CardContent className="flex items-center gap-3 p-3">
              <RotateCcw className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{typeLabel} in progress</div>
                <div className="text-xs text-muted-foreground truncate">
                  {stepDesc}
                  {state.parentLabel && ` · from ${state.parentLabel}`}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => nav(`/batch/new?resume=${mode}`)}>Resume</Button>
                <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
