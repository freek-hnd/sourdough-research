import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCompleteSessions,
  useOpenSessions,
  suggestedEnd,
  reasonText,
  type SessionWithItem,
} from "@/hooks/useSessions";
import { SessionPlots } from "@/components/SessionPlots";
import { formatElapsed } from "@/lib/utils";

function formatLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

/** Color the open session option based on whether it needs an end. */
function statusEmoji(s: SessionWithItem): "🔴" | "🟡" | "🟢" {
  const sug = suggestedEnd(s);
  if (!sug) return "🟢";
  if (sug.reason === "reused" || sug.reason === "outcome" || sug.reason === "retired") {
    return "🔴";
  }
  return "🟡";
}

/** Convert ISO timestamp to the format expected by <input type="datetime-local">. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const preselectedId = params.get("session");

  const open = useOpenSessions();
  const complete = useCompleteSessions();

  const [openSelected, setOpenSelected] = useState<string | null>(null);
  const [completeSelected, setCompleteSelected] = useState<string | null>(null);

  // Pre-select an open session from ?session= query param.
  useEffect(() => {
    if (preselectedId && open.data) {
      const exists = open.data.some((s) => s.id === preselectedId);
      if (exists) setOpenSelected(preselectedId);
    }
  }, [preselectedId, open.data]);

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-lg font-semibold">Sessions</h1>

      {/* Open sessions */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Open sessions</h2>
        {open.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !open.data || open.data.length === 0 ? (
          <Card>
            <CardContent className="p-3 text-sm text-muted-foreground">
              No open sessions.
            </CardContent>
          </Card>
        ) : (
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={openSelected ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setOpenSelected(v);
              setCompleteSelected(null);
              if (v) setParams({ session: v }, { replace: true });
              else setParams({}, { replace: true });
            }}
          >
            <option value="">— pick an open session —</option>
            {open.data.map((s) => (
              <option key={s.id} value={s.id}>
                {statusEmoji(s)} {s.item_short_id} | Stn {s.station_id} | {formatLocal(s.started_at)} ({formatElapsed(s.started_at)})
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Open session detail */}
      {openSelected && open.data && (
        <OpenSessionDetail
          session={open.data.find((s) => s.id === openSelected)!}
          onSaved={() => {
            setOpenSelected(null);
            setParams({}, { replace: true });
          }}
        />
      )}

      <hr className="border-border" />

      {/* Complete sessions */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Complete sessions</h2>
        {complete.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !complete.data || complete.data.length === 0 ? (
          <Card>
            <CardContent className="p-3 text-sm text-muted-foreground">
              No completed sessions yet.
            </CardContent>
          </Card>
        ) : (
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={completeSelected ?? ""}
            onChange={(e) => {
              setCompleteSelected(e.target.value || null);
              setOpenSelected(null);
            }}
          >
            <option value="">— pick a complete session —</option>
            {complete.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.item_short_id} | Stn {s.station_id} | {formatLocal(s.started_at)} → {formatLocal(s.ended_at!)} ({formatDuration(s.started_at, s.ended_at!)})
              </option>
            ))}
          </select>
        )}
      </section>

      {completeSelected && complete.data && (() => {
        const s = complete.data.find((x) => x.id === completeSelected);
        if (!s) return null;
        return (
          <SessionPlots
            stationId={s.station_id}
            startedAt={s.started_at}
            endedAt={s.ended_at}
            sessionId={s.id}
            itemId={s.item_id}
          />
        );
      })()}
    </div>
  );
}

// =====================================================================
// Open session detail — plots + suggested end time + confirm button
// =====================================================================

function OpenSessionDetail({
  session,
  onSaved,
}: {
  session: SessionWithItem;
  onSaved: () => void;
}) {
  const sug = useMemo(() => suggestedEnd(session), [session]);
  const qc = useQueryClient();

  // Datetime picker pre-filled with the suggested end time, or "now".
  const initialIso = sug?.at ?? new Date().toISOString();
  const [picker, setPicker] = useState(toDatetimeLocalValue(initialIso));

  // Reset picker if the user switches to a different session.
  useEffect(() => {
    setPicker(toDatetimeLocalValue(sug?.at ?? new Date().toISOString()));
  }, [sug?.at, session.id]);

  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    try {
      // datetime-local has no timezone — interpret as local time.
      const localDate = new Date(picker);
      const { error } = await supabase
        .from("sessions")
        .update({ ended_at: localDate.toISOString() })
        .eq("id", session.id);
      if (error) throw error;
      toast.success("Session ended");
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {sug && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-3 space-y-1">
            <div className="text-sm font-medium">
              Suggested end: {formatLocal(sug.at)}{" "}
              <Badge variant="outline" className="ml-1 text-[10px]">
                {sug.reason}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">{reasonText(sug.reason)}</div>
          </CardContent>
        </Card>
      )}

      <SessionPlots
        stationId={session.station_id}
        startedAt={session.started_at}
        endedAt={null}
        suggestedEndAt={sug?.at ?? null}
        sessionId={session.id}
        itemId={session.item_id}
      />

      <Card>
        <CardContent className="p-3 space-y-2">
          <Label>Confirm end time</Label>
          <Input
            type="datetime-local"
            value={picker}
            onChange={(e) => setPicker(e.target.value)}
          />
          <Button
            className="h-12 w-full"
            disabled={saving || !picker}
            onClick={confirm}
          >
            Confirm end time
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
