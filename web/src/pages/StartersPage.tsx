import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCreateRootStarter } from "@/hooks/useMutations";

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
        <div className="space-y-2">
          {starters.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{s.name}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div>Origin: {s.origin}</div>
                {s.description && <div className="mt-1">{s.description}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
