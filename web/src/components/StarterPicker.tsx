import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveStarters } from "@/hooks/useActiveStarters";
import { useRootStarters } from "@/hooks/useRootStarters";
import { formatAge } from "@/lib/utils";

interface StarterPickerProps {
  onSelect: (params: {
    parentItemId: string | null;
    parentGeneration: number;
    rootStarterId: string;
    label: string;
  }) => void;
}

export function StarterPicker({ onSelect }: StarterPickerProps) {
  const { data: groups, isLoading } = useActiveStarters();
  const { data: rootStarters } = useRootStarters();

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  // Root starters that have no active children — offer "First refresh"
  const activeRootIds = new Set((groups ?? []).map((g) => g.rootStarter.id));
  const unstarted = (rootStarters ?? []).filter((rs) => !activeRootIds.has(rs.id));

  return (
    <div className="space-y-4">
      {(groups ?? []).map((group) => (
        <div key={group.rootStarter.id} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {group.rootStarter.name}
            <span className="ml-1 opacity-60">({group.rootStarter.origin})</span>
          </h3>
          <div className="space-y-1">
            {group.items.map((item) => (
              <Card
                key={item.id}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => onSelect({
                  parentItemId: item.id,
                  parentGeneration: item.generation,
                  rootStarterId: group.rootStarter.id,
                  label: `${item.short_id} (Gen ${item.generation})`,
                })}
              >
                <CardContent className="flex items-center gap-2 px-4 py-3">
                  <span className="font-mono text-sm font-medium">{item.short_id}</span>
                  <Badge variant="secondary" className="text-xs">Gen {item.generation}</Badge>
                  <span className="text-xs text-muted-foreground">{formatAge(item.created_at)}</span>
                  {item.weight_g > 0 && (
                    <span className="text-xs text-muted-foreground">{item.weight_g}g</span>
                  )}
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground">{item.container_type}</span>
                </CardContent>
              </Card>
            ))}
            {/* Option to create a fresh gen-1 from this root */}
            <Card
              className="cursor-pointer border-dashed hover:bg-accent/50"
              onClick={() => onSelect({
                parentItemId: null,
                parentGeneration: 0,
                rootStarterId: group.rootStarter.id,
                label: `New from ${group.rootStarter.name}`,
              })}
            >
              <CardContent className="px-4 py-3 text-center text-sm text-muted-foreground">
                + First refresh from root
              </CardContent>
            </Card>
          </div>
        </div>
      ))}

      {unstarted.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">No active children</h3>
          {unstarted.map((rs) => (
            <Card
              key={rs.id}
              className="cursor-pointer border-dashed hover:bg-accent/50"
              onClick={() => onSelect({
                parentItemId: null,
                parentGeneration: 0,
                rootStarterId: rs.id,
                label: `New from ${rs.name}`,
              })}
            >
              <CardContent className="flex items-center gap-2 px-4 py-3">
                <span className="text-sm font-medium">{rs.name}</span>
                <span className="text-xs text-muted-foreground">({rs.origin})</span>
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">+ First refresh</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
