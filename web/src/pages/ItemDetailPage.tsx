import { useState } from "react";
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
import { useLogEvent } from "@/hooks/useMutations";
import { formatElapsed, formatTime } from "@/lib/utils";

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
  const [note, setNote] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading || !item) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;

  function fire(name: string) {
    if (!item) return;
    logEvent.mutate(
      { event_name: name, session_id: session?.id ?? null, station_id: item.station_id ?? null },
      { onSuccess: () => toast.success(name) },
    );
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
                      onSuccess: () => {
                        toast.success("Note saved");
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
        <ul className="space-y-1 text-sm">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-14 text-muted-foreground">{formatTime(e.occurred_at)}</span>
              <span className="flex-1">{e.event_name}</span>
              {e.notes && <span className="text-muted-foreground truncate max-w-[40%]">{e.notes}</span>}
            </li>
          ))}
          {(!events || events.length === 0) && (
            <li className="text-muted-foreground">No events yet.</li>
          )}
        </ul>
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
