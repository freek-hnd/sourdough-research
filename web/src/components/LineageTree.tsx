import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LineageNode } from "@/lib/types";
import { formatAge } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface LineageTreeProps {
  nodes: LineageNode[];
}

export function LineageTree({ nodes }: LineageTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth }: { node: LineageNode; depth: number }) {
  const nav = useNavigate();
  const isActive = !node.retired_at;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="group relative flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => nav(`/item/${node.short_id}`)}
      >
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-border"
            style={{ left: `${(depth - 1) * 24 + 19}px` }}
          />
        )}
        {depth > 0 && (
          <div
            className="absolute h-px w-3 border-t border-border"
            style={{ left: `${(depth - 1) * 24 + 19}px`, top: "22px" }}
          />
        )}

        <span className="font-mono text-sm font-medium">{node.short_id}</span>
        <Badge variant="secondary" className="text-xs">Gen {node.generation}</Badge>
        <span className="text-xs text-muted-foreground">{formatAge(node.created_at)}</span>
        {node.weight_g > 0 && (
          <span className="text-xs text-muted-foreground">{node.weight_g}g</span>
        )}

        <div className="flex-1" />

        {isActive ? (
          <Badge className="text-xs">active</Badge>
        ) : (
          <Badge variant="outline" className="text-xs opacity-50">retired</Badge>
        )}

        {isActive && (
          <Button
            size="xs"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              nav(`/batch/new?parent=${node.id}`);
            }}
          >
            <RefreshCw className="size-3" />
          </Button>
        )}
      </div>

      {hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
