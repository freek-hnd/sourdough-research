import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOpenSessions, suggestedEnd, reasonText } from "@/hooks/useSessions";

function formatLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Dashboard banner that lists open sessions which look like they should
 * have ended. Renders nothing when none qualify.
 *
 * Each row links to /sessions?session=<id> so the user lands on the
 * Sessions page with the right session pre-selected and the suggested
 * end time pre-filled.
 */
export function SessionsAttentionBanner() {
  const { data: open } = useOpenSessions();

  if (!open || open.length === 0) return null;

  const flagged = open
    .map((s) => ({ s, sug: suggestedEnd(s) }))
    .filter((x): x is { s: typeof x.s; sug: NonNullable<typeof x.sug> } => x.sug != null);

  if (flagged.length === 0) return null;

  const top = flagged.slice(0, 5);

  return (
    <Card className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <h3 className="text-sm font-semibold">Sessions needing end time</h3>
          <span className="ml-auto text-xs text-muted-foreground">{flagged.length}</span>
        </div>

        <div className="space-y-1">
          {top.map(({ s, sug }) => (
            <div
              key={s.id}
              className="flex items-center gap-2 text-xs"
              title={reasonText(sug.reason)}
            >
              <span className="font-mono font-medium">{s.item_short_id}</span>
              <span className="text-muted-foreground">— {sug.reason}</span>
              <span className="ml-auto truncate text-muted-foreground">
                suggested: {formatLocal(sug.at)}
              </span>
              <Link to={`/sessions?session=${s.id}`}>
                <Button size="xs" variant="outline">Fix →</Button>
              </Link>
            </div>
          ))}
        </div>

        {flagged.length > 5 && (
          <Link
            to="/sessions"
            className="block text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
          >
            See all ({flagged.length})
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
