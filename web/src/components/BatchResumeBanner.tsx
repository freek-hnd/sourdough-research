import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RotateCcw } from "lucide-react";

const WIZARD_STORAGE_KEY = "sourdough_batch_wizard";

interface WizardState {
  mode?: "choose" | "dough" | "starter";
  step?: number;
  parentLabel?: string;
}

const DOUGH_STEPS: Record<number, string> = {
  1: "Mix flour & water",
  2: "Add starter & salt",
  3: "Divide",
  4: "Assign stations",
};

const STARTER_STEPS: Record<number, string> = {
  1: "Choose parent starter",
  2: "Feed amounts",
};

function readState(): WizardState | null {
  try {
    const raw = localStorage.getItem(WIZARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState;
    // Ignore empty/choose-mode states — only show when there's real progress
    if (!parsed.mode || parsed.mode === "choose") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Banner shown on the dashboard when a batch wizard was left mid-flow.
 * The wizard already autosaves its state to localStorage — this just
 * surfaces that save so the user has an obvious way to jump back in,
 * instead of having to remember they were in the middle of something.
 */
export function BatchResumeBanner() {
  const nav = useNavigate();
  const [state, setState] = useState<WizardState | null>(() => readState());

  // Re-read when the tab regains focus in case the user cleared or
  // updated localStorage from another tab.
  useEffect(() => {
    const onFocus = () => setState(readState());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (!state) return null;

  const isDough = state.mode === "dough";
  const typeLabel = isDough ? "Dough" : "Starter refresh";
  const stepMap = isDough ? DOUGH_STEPS : STARTER_STEPS;
  const stepLabel = state.step != null ? stepMap[state.step] : undefined;
  const stepDesc = stepLabel
    ? `Step ${state.step}: ${stepLabel}`
    : state.step
    ? `Step ${state.step}`
    : "";

  const discard = () => {
    localStorage.removeItem(WIZARD_STORAGE_KEY);
    setState(null);
  };

  return (
    <Card className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="flex items-center gap-3 p-3">
        <RotateCcw className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">You have an unfinished batch</div>
          <div className="text-xs text-muted-foreground truncate">
            {typeLabel}
            {stepDesc && ` — ${stepDesc}`}
            {state.parentLabel && ` · from ${state.parentLabel}`}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => nav("/batch/new")}>Resume</Button>
          <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
        </div>
      </CardContent>
    </Card>
  );
}
