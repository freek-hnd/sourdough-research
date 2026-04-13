import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useRootStarters } from "@/hooks/useRootStarters";
import { useStarterLineage } from "@/hooks/useStarterLineage";
import { useCreateRootStarter } from "@/hooks/useMutations";
import { LineageTree } from "@/components/LineageTree";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

export function StartersPage() {
  const { data: starters, isLoading } = useRootStarters();
  const create = useCreateRootStarter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Starters</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm">+ New</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>Register new starter</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Origin</Label><Input value={origin} onChange={(e) => setOrigin(e.target.value)} /></div>
              <div className="space-y-1"><Label>Description</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} /></div>
              <Button
                className="w-full"
                disabled={!name || !origin || create.isPending}
                onClick={async () => {
                  try {
                    await create.mutateAsync({ name, origin, description: desc || undefined });
                    toast.success("Starter added");
                    setOpen(false);
                    setName(""); setOrigin(""); setDesc("");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !starters || starters.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No starters yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {starters.map((s) => (
            <StarterSection key={s.id} id={s.id} name={s.name} origin={s.origin} description={s.description} />
          ))}
        </div>
      )}
    </div>
  );
}

function StarterSection({ id, name, origin, description }: { id: string; name: string; origin: string; description: string | null }) {
  const nav = useNavigate();
  const [expanded, setExpanded] = useState(true);
  const { data: tree, isLoading } = useStarterLineage(expanded ? id : undefined);

  return (
    <Card>
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <div className="flex-1">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{origin}{description ? ` — ${description}` : ""}</div>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            nav(`/batch/new?parent=root_${id}`);
          }}
        >
          <RefreshCw className="size-3 mr-1" />
          Refresh
        </Button>
      </button>
      {expanded && (
        <div className="border-t px-2 py-2">
          {isLoading ? (
            <Skeleton className="mx-2 h-8 w-full" />
          ) : !tree || tree.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">
              No refreshes yet. Start your first refresh to begin the lineage.
            </div>
          ) : (
            <LineageTree nodes={tree} />
          )}
        </div>
      )}
    </Card>
  );
}
