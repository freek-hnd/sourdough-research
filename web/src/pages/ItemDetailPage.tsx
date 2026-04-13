import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useActiveSessionForItem,
  useItem,
  useItemEvents,
  useLatestMeasurement,
} from "@/hooks/useItem";
import { useLogEvent, useDeleteEvent } from "@/hooks/useMutations";
import { formatElapsed, formatTime } from "@/lib/utils";
import { Trash2 } from "lucide-react";

const QUICK_ACTIONS = [
  { name: "stretch_fold", label: "🤲 Fold" },
  { name: "shape", label: "🫳 Shape" },
  { name: "temp_check", label: "🌡️ Temp" },
  { name: "to_fridge", label: "❄️ → Fridge" },
  { name: "from_fridge", label: "☀️ ← Fridge" },
  { name: "ph_start", label: "🧪 pH start" },
];

export function ItemDetailPage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading } = useItem(shortId);
  const { data: session } = useActiveSessionForItem(item?.id);
  const { data: measurement } = useLatestMeasurement(item?.station_id);
  const { data: events } = useItemEvents(item?.id);
  const logEvent = useLogEvent();
  const deleteEvent = useDeleteEvent();
  const [note, setNote] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const undoTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  if (isLoading || !item) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;

  const batch = item.batch as { root_starter?: { name: string } | null } | null;
  const starterName = batch?.root_starter?.name;

  function fire(name: string) {
    if (!item) return;
    logEvent.mutate(
      { event_name: name, session_id: session?.id ?? null, station_id: item.station_id ?? null },
      {
        onSuccess: (data) => {
          const eventId = data.id;
          const toastId = toast.success(name, {
            action: {
              label: "Undo",
              onClick: () => {
                const timer = undoTimers.current.get(eventId);
                if (timer) clearTimeout(timer);
                undoTimers.current.delete(eventId);
                deleteEvent.mutate(eventId);
                toast.dismiss(toastId);
              },
            },
            duration: 5000,
          });
          const timer = setTimeout(() => undoTimers.current.delete(eventId), 5000);
          undoTimers.current.set(eventId, timer);
        },
      },
    );
  }

  function handleDeleteEvent(eventId: string, name: string) {
    deleteEvent.mutate(eventId, {
      onSuccess: () => toast.success(`Deleted: ${name}`),
      onError: (err) => toast.error((err as Error).message),
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-2xl font-bold">{item.short_id}</h1>
          <div className="flex gap-2">
            <Badge variant="secondary">{item.type}</Badge>
            {item.station_id && <Badge>Station {item.station_id}</Badge>}
          </div>
        </div>
        {starterName && (
          <p className="text-sm text-muted-foreground">{starterName}</p>
        )}
        {session && (
          <p className="text-sm text-muted-foreground">Running for {formatElapsed(session.started_at)}</p>
        )}
      </div>

      {item.station_id && (
        <Card>
          <CardContent className="grid grid-cols-4 gap-2 p-4 text-center">
            <Stat label="CO₂" value={measurement?.co2_ppm} unit="ppm" />
            <Stat label="Temp" value={measurement?.scd_temp_c ?? measurement?.ds18b20_temp_c} unit="°C" />
            <Stat label="Height" value={measurement?.tof_median_mm} unit="mm" />
            <Stat label="Weight" value={measurement?.load_cell_g} unit="g" />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <Button
            key={a.name}
            variant="outline"
            className="h-16 whitespace-normal text-sm"
            onClick={() => fire(a.name)}
          >{a.label}</Button>
        ))}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger render={<Button variant="outline" className="h-16">📝 Note</Button>} />
          <SheetContent side="bottom">
            <SheetHeader><SheetTitle>Add note</SheetTitle></SheetHeader>
            <div className="p-4 space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
              <Button
                className="w-full"
                disabled={!note}
                onClick={() => {
                  logEvent.mutate(
                    { event_name: "note", notes: note, session_id: session?.id ?? null, station_id: item.station_id ?? null },
                    {
                      onSuccess: (data) => {
                        const eventId = data.id;
                        const toastId = toast.success("Note saved", {
                          action: {
                            label: "Undo",
                            onClick: () => {
                              deleteEvent.mutate(eventId);
                              toast.dismiss(toastId);
                            },
                          },
                          duration: 5000,
                        });
                        setNote("");
                        setSheetOpen(false);
                      },
                    },
                  );
                }}
              >Save note</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Event history</h2>
        <div className="space-y-1 text-sm">
          {(events ?? []).map((e) => (
            <div
              key={e.id}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <span className="w-14 shrink-0 text-muted-foreground">{formatTime(e.occurred_at)}</span>
              <span className="flex-1">{e.event_name}</span>
              {e.notes && <span className="text-muted-foreground truncate max-w-[30%]">{e.notes}</span>}
              <button
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                onClick={() => handleDeleteEvent(e.id, e.event_name)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {(!events || events.length === 0) && (
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground">
              No events yet.
            </div>
          )}
        </div>
      </section>

      {item.type === "dough" && (
        <Link to={`/outcome/${item.short_id}`} className="block">
          <Button variant="destructive" className="h-12 w-full">End session → Bake</Button>
        </Link>
      )}
      <Button variant="ghost" className="w-full" onClick={() => nav("/")}>Back</Button>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null | undefined; unit: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value != null ? `${Math.round(value * 10) / 10}` : "—"}
      </div>
      <div className="text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}
