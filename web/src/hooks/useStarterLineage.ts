import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LineageNode } from "@/lib/types";

interface FlatRow {
  id: string;
  short_id: string;
  batch_id: string;
  weight_g: number;
  generation: number;
  created_at: string;
  retired_at: string | null;
  container_type: string;
  parent_item_id: string | null;
  flour_g: number;
  water_g: number;
  starter_g: number;
}

function buildTree(rows: FlatRow[]): LineageNode[] {
  const nodeMap = new Map<string, LineageNode>();
  for (const row of rows) {
    nodeMap.set(row.id, { ...row, children: [] });
  }

  const roots: LineageNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_item_id && nodeMap.has(node.parent_item_id)) {
      nodeMap.get(node.parent_item_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function useStarterLineage(rootStarterId: string | undefined) {
  return useQuery({
    queryKey: ["starter_lineage", rootStarterId],
    enabled: !!rootStarterId,
    queryFn: async (): Promise<LineageNode[]> => {
      const { data, error } = await supabase.rpc("get_starter_lineage", {
        p_root_starter_id: rootStarterId!,
      });
      if (error) throw error;
      return buildTree((data ?? []) as FlatRow[]);
    },
    staleTime: 30_000,
  });
}
