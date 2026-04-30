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
import { useLogEvent, useDeleteEvent, useRetireStarter, useEndSession, useAssignStation } from "@/hooks/useMutations";
import { useStations } from "@/hooks/useStations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StationStatusDot } from "@/components/StationStatus";
import { TofHeatmap } from "@/components/TofHeatmap";
import { SessionPlots } from "@/components/SessionPlots";
import { useBakeState } from "@/hooks/useBakeState";
import { formatElapsed, formatTime } from "@/lib/utils";
import { Trash2, RefreshCw, Archive } from "lucide-react";

const QUICK_ACTIONS = [
  { name: "stretch_fold", label: "🤲 Fold" },
  { name: "shape", label: "🫳 Shape" },
  { name: "temp_check", label: "🌡️ Temp" },
  { name: "to_fridge", label: "❄️ → Fridge" },
  { name: "from_fridge", label: "☀️ ← Fridge" },
];

// The Hanna pH meter lives on the Pi (station 1), so connect/disconnect
// events must target that station — regardless of the item's own station.
const HANNA_STATION_ID = 1;

export function ItemDetailPage() {
  const { shortId } = useParams<{ shortId: string }>();
  const nav = useNavigate();
  const { data: item, isLoading } = useItem(shortId);
  const { data: session } = useActiveSessionForItem(item?.id);
  const { data: measurement } = useLatestMeasurement(item?.station_id);
  const { data: events } = useItemEvents(item?.id);
  const logEvent = useLogEvent();
  const deleteEvent = useDeleteEvent();
  const retireStarter = useRetireStarter();
  const endSession = useEndSession();
  const assignStation = useAssignStation();
  const { data: bakeInfo } = useBakeState(item?.id);
  const { data: stations = [] } = useStations();
  const [stationDialogOpen, setStationDialogOpen] = useState(false);
  const [pendingStationId, setPendingStationId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const undoTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  if (isLoading || !item) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;

  const batch = item.batch as {
    root_starter?: { name: string } | null;
    parent_item_id?: string | null;
  } | null;
  const starterName = batch?.root_starter?.name;
  // Show this item's own weight, not the sum across all siblings in
  // the batch (those each have their own row to look at).
  const itemWeight = item.weight_g;
  const isActiveStarter = item.type === "starter" && !item.retired_at;

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

  function openStationDialog() {
    if (!item) return;
    setPendingStationId(item.station_id ?? null);
    setStationDialogOpen(true);
  }

  function confirmAssignStation() {
    if (!item) return;
    assignStation.mutate(
      {
        item_id: item.id,
        station_id: pendingStationId,
        // Use the item's creation timestamp as the session start so a
        // late-assigned station retroactively covers the time since
        // the dough/starter was actually mixed.
        started_at: item.created_at,
      },
      {
        onSuccess: () => {
          toast.success(
            pendingStationId == null
              ? "Station removed"
              : `Assigned to station ${pendingStationId}`,
          );
          setStationDialogOpen(false);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-2xl font-bold">{item.short_id}</h1>
          <div className="flex gap-2">
            <Badge variant="secondary">{item.type}</Badge>
            {item.generation > 0 && <Badge variant="outline">Gen {item.generation}</Badge>}
            {item.station_id && (
              <button
                type="button"
                onClick={openStationDialog}
                className="inline-flex items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Change station"
              >
                <StationStatusDot stationId={item.station_id} />
                <Badge>Station {item.station_id}</Badge>
              </button>
            )}
          </div>
        </div>
        {starterName && (
          <p className="text-sm text-muted-foreground">{starterName}</p>
        )}
        {itemWeight != null && (
          <p className="text-sm text-muted-foreground">Weight: {Math.round(itemWeight)} g</p>
        )}
        {item.retired_at && (
          <p className="text-sm text-destructive">Retired</p>
        )}
        {session && (
          <p className="text-sm text-muted-foreground">Running for {formatElapsed(session.started_at)}</p>
        )}
      </div>

      {isActiveStarter && (
        <div className="flex gap-2">
          <Button
            className="flex-1 h-12"
            onClick={() => nav(`/batch/new?parent=${item.id}`)}
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh this starter
          </Button>
          <Button
            variant="outline"
            className="h-12"
            onClick={() => {
              retireStarter.mutate(item.id, {
                onSuccess: () => toast.success("Starter retired"),
                onError: (err) => toast.error((err as Error).message),
              });
            }}
          >
            <Archive className="size-4" />
          </Button>
        </div>
      )}

      {/* Late-assign a station when one was forgotten at refresh time.
          Clicking the badge above does the same thing for items that
          already have a station. */}
      {!item.station_id && !item.retired_at && (
        <Button
          variant="outline"
          className="h-12 w-full"
          onClick={openStationDialog}
        >
          🛰 Assign station
        </Button>
      )}

      {item.station_id && (
        <>
          <Card>
            <CardContent className="grid grid-cols-4 gap-2 p-4 text-center">
              <Stat label="CO₂" value={measurement?.co2_ppm} unit="ppm" />
              <Stat label="Temp" value={measurement?.scd_temp_c ?? measurement?.ds18b20_temp_c} unit="°C" />
              <Stat label="Height" value={measurement?.tof_median_mm} unit="mm" />
              <Stat label="Weight" value={measurement?.load_cell_g} unit="g" />
            </CardContent>
          </Card>
          {/* Inline time-series for at-a-glance fermentation tracking.
              The 3D ToF section is collapsed by default since it's heavy
              to render. The dedicated /plot page below stays available
              for fullscreen viewing. */}
          <SessionPlots
            stationId={item.station_id}
            startedAt={session?.started_at ?? item.created_at}
            endedAt={session?.ended_at ?? null}
            sessionId={session?.id}
            itemId={item.id}
          />
          <Link to={`/item/${item.short_id}/plot`} className="block">
            <Button variant="outline" className="h-12 w-full">📈 Open plots fullscreen</Button>
          </Link>
        </>
      )}

      {measurement?.tof_grid && Array.isArray(measurement.tof_grid) && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">ToF grid</h2>
            <TofHeatmap
              grid={measurement.tof_grid as number[]}
              median={measurement.tof_median_mm}
              min={measurement.tof_min_mm}
              max={measurement.tof_max_mm}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-14 border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
          onClick={() => fire("measurement_start")}
        >▶ Start measuring</Button>
        <Button
          variant="outline"
          className="h-14 border-rose-500 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
          onClick={() => fire("measurement_stop")}
        >⏹ Stop measuring</Button>
      </div>

      {session && (
        <Button
          variant="outline"
          className="h-12 w-full border-destructive text-destructive hover:bg-destructive/10"
          onClick={() => {
            // Log event markers, then end the session
            logEvent.mutate({
              event_name: "measurement_stop",
              session_id: session.id,
              station_id: item.station_id ?? null,
            });
            logEvent.mutate({
              event_name: "session_end",
              session_id: session.id,
              station_id: item.station_id ?? null,
            });
            endSession.mutate(session.id, {
              onSuccess: () => toast.success("Session ended"),
              onError: (err) => toast.error((err as Error).message),
            });
          }}
        >⏹ End session</Button>
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

      {/* Station adjustment events — log when the rig was bumped or moved
          so we can flag bad stretches of data later. */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">⚠ Station</h2>
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-12 whitespace-normal text-xs border-amber-500 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
              onClick={() => fire("station_adjusted")}
            >Adjusted</Button>
            <Button
              variant="outline"
              className="h-12 whitespace-normal text-xs border-amber-500 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
              onClick={() => fire("station_adjusted_horizontal")}
            >Moved horizontally</Button>
            <Button
              variant="outline"
              className="h-12 whitespace-normal text-xs border-amber-500 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
              onClick={() => fire("station_adjusted_vertical")}
            >Moved vertically</Button>
          </div>
        </CardContent>
      </Card>

      {/* pH meter controls (Hanna HI98103 lives on the Pi — station 1) */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">🧪 pH meter</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-12"
              onClick={() => {
                logEvent.mutate(
                  { event_name: "ph_start", session_id: session?.id ?? null, station_id: HANNA_STATION_ID },
                  { onSuccess: () => toast.success("pH connect requested") },
                );
              }}
            >🔗 Connect</Button>
            <Button
              variant="outline"
              className="h-12"
              onClick={() => {
                logEvent.mutate(
                  { event_name: "ph_stop", session_id: session?.id ?? null, station_id: HANNA_STATION_ID },
                  { onSuccess: () => toast.success("pH disconnect requested") },
                );
              }}
            >🔌 Disconnect</Button>
            <Button
              variant="outline"
              className="h-12 border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
              onClick={() => {
                logEvent.mutate(
                  { event_name: "ph_record_start", session_id: session?.id ?? null, station_id: HANNA_STATION_ID },
                  { onSuccess: () => toast.success("pH recording started") },
                );
              }}
            >▶ Start recording</Button>
            <Button
              variant="outline"
              className="h-12 border-rose-500 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
              onClick={() => {
                logEvent.mutate(
                  { event_name: "ph_record_stop", session_id: session?.id ?? null, station_id: HANNA_STATION_ID },
                  { onSuccess: () => toast.success("pH recording stopped") },
                );
              }}
            >⏹ Stop recording</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Connect/disconnect control the BLE link. Start/stop recording are
            just timestamp markers for later analysis.
          </p>
        </CardContent>
      </Card>

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

      {item.type === "dough" && bakeInfo?.state === "no-bake" && (
        <Link to={`/outcome/${item.short_id}`} className="block">
          <Button className="h-12 w-full">🔥 Start bake</Button>
        </Link>
      )}
      {item.type === "dough" && bakeInfo?.state === "baking" && (
        <Link to={`/outcome/${item.short_id}`} className="block">
          <Button className="h-12 w-full bg-orange-600 hover:bg-orange-700 text-white">
            🧊 End bake (in oven)
          </Button>
        </Link>
      )}
      {item.type === "dough" && bakeInfo?.state === "awaiting-results" && (
        <Link to={`/outcome/${item.short_id}`} className="block">
          <Button variant="destructive" className="h-12 w-full">
            📝 Log bake results
          </Button>
        </Link>
      )}
      <Button variant="ghost" className="w-full" onClick={() => nav("/")}>Back</Button>

      {/* Station assignment dialog. Triggered both from the badge and
          the 'Assign station' button when no station is set. */}
      <Dialog open={stationDialogOpen} onOpenChange={setStationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {item.station_id ? "Change station" : "Assign station"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The session start time stays the same — the station change is
              applied retroactively to the existing session.
            </p>
            <Select
              value={pendingStationId?.toString() ?? "__none__"}
              onValueChange={(v) =>
                setPendingStationId(
                  v === "__none__" || v == null ? null : Number(v),
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No station">
                  {pendingStationId == null
                    ? "No station"
                    : `#${pendingStationId} ${stations.find((s) => s.id === pendingStationId)?.label ?? ""}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No station (remove)</SelectItem>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    #{s.id} {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setStationDialogOpen(false)}
              >Cancel</Button>
              <Button
                className="flex-1"
                disabled={
                  assignStation.isPending ||
                  (pendingStationId ?? null) === (item.station_id ?? null)
                }
                onClick={confirmAssignStation}
              >Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
