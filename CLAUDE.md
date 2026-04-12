# CLAUDE.md — Sourdough Research Platform

## ⚠️ Start elke sessie met deze check

Voordat je iets doet: verifieer de MCP verbinding en het juiste project.

1. Voer uit: `SELECT current_database(), current_user;`
2. Verifieer dat project ref overeenkomt met onderstaande
3. Als de verbinding faalt: lees `~/.claude/settings.local.json` en `.mcp.json`, diagnose en fix

**STOP als je niet zeker bent welk project je raakt.**

## Project identifiers
```
Supabase project ref:  kacbiyxnyfvsdkhddodl
Supabase project URL:  https://kacbiyxnyfvsdkhddodl.supabase.co
MCP server name:       supabase-sour (NIET de default `supabase`)
Vercel project:        sour (team: freek-hnds-projects)
Vercel URL:            https://sour-five.vercel.app
GitHub repo:           https://github.com/freek-hnd/sourdough-research
Lokale repo:           ~/projects/sourdough-research
Knowledge vault:       ~/knowledge-vault/sour/
```

## Supabase MCP — regels
- Gebruik ALTIJD `mcp__supabase-sour__execute_sql` voor DB queries (NIET `mcp__supabase__...`)
- Gebruik NOOIT Supabase CLI, psql, of lokale containers
- Gebruik NOOIT een andere project ref dan hierboven
- Bij twijfel over welk project: STOP en vraag

## Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Data fetching**: TanStack Query v5 (React Query) + Supabase JS client
- **Backend**: Supabase (Postgres + Storage)
- **Data collection**: Python on RPi Zero 2W (paho-mqtt, SQLite, requests)
- **Firmware**: ESP32 with PlatformIO (Arduino framework)
- **Deploy**: Vercel (frontend), Supabase (DB + storage)

## Project structure
```
sourdough-research/
├── CLAUDE.md
├── web/              # Vite + React app (shadcn/ui)
├── rpi/              # Python data collector (runs on RPi)
├── esp32/            # PlatformIO firmware
└── supabase/         # Migrations + seed
```

## Frontend conventions

### shadcn/ui — always use existing components
Before building any UI element, check if shadcn/ui has it:
- Buttons, inputs, selects, textareas → shadcn primitives
- Dialogs, sheets, popovers → shadcn overlays
- Cards, badges, separators → shadcn layout
- Tabs, accordion → shadcn navigation
- Toast for feedback → shadcn sonner

Install components as needed: `npx shadcn@latest add [component]`
Never build custom components when a shadcn equivalent exists.

### Styling
- Use Tailwind utility classes, never inline styles
- Use shadcn/ui's CSS variables for colors — don't hardcode colors
- Mobile-first: this app is primarily used on a phone with flour on your hands
- Big tap targets (min 44px), generous spacing, readable fonts

### Data fetching
```typescript
// Always use TanStack Query for server state:
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Queries — stale time 30s for live data, 5min for reference data
const { data: items } = useQuery({
  queryKey: ['items', 'active'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('items')
      .select('*, batch:batches(*), station:stations(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  staleTime: 30_000,
});

// Mutations — always invalidate related queries
const createBatch = useMutation({
  mutationFn: async (batch: NewBatch) => {
    const { data, error } = await supabase.from('batches').insert(batch).select().single();
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['batches'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  },
});
```

### File structure (web/)
```
src/
├── components/
│   ├── ui/              # shadcn/ui components (auto-generated)
│   ├── dashboard/       # Dashboard-specific components
│   ├── batches/         # Batch wizard components
│   ├── items/           # Item detail + quick actions
│   ├── outcomes/        # Outcome + rating forms
│   └── layout/          # Shell, nav, header
├── hooks/               # Custom hooks (useActiveItems, useSessions, etc.)
├── lib/
│   ├── supabase.ts      # Supabase client
│   ├── types.ts         # TypeScript types matching DB schema
│   ├── utils.ts         # short_id generator, formatters
│   └── queries.ts       # Shared query keys + fetchers
├── pages/               # Route pages (react-router)
└── App.tsx
```

### Component patterns
```typescript
// Page components are thin — logic lives in hooks:
export function DashboardPage() {
  const { data: activeItems, isLoading } = useActiveItems();
  const { data: recentEvents } = useRecentEvents(10);

  if (isLoading) return <Skeleton />;

  return (
    <div className="space-y-4 p-4">
      <ActiveItemsList items={activeItems} />
      <EventFeed events={recentEvents} />
    </div>
  );
}
```

## Supabase conventions

### RLS — always on
Every table has RLS enabled. For now, use permissive policies (single user).
When adding a table, always add RLS + policy in the same migration.

### CHECK constraints — verify before INSERT
```sql
-- Before inserting, check what values are valid:
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'my_table'::regclass AND contype = 'c';
```

A CHECK constraint violation fails silently via the anon client — the insert returns no error but writes nothing.

### Column names — always verify
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'my_table'
ORDER BY ordinal_position;
```

Never guess column names. Claude Code sometimes invents names that don't exist.

### Timestamps
All timestamps are `TIMESTAMPTZ` stored in UTC. The frontend formats them to local time for display.

## Python (RPi) conventions
- Python 3.11+, no virtual env needed
- Minimal dependencies: `paho-mqtt`, `requests`, `sqlite3` (stdlib)
- Never use the heavy `supabase-py` client on Pi Zero — use `requests` for REST API
- All sensor-reading code should handle errors gracefully and never crash the main loop
- Config from environment variables with sensible defaults

## Commit format
```
feat: new feature
fix: bug fix
refactor: restructuring
chore: maintenance
```

## Known DB values
| Table | Column | Valid values |
|-------|--------|-------------|
| batches | type | 'starter', 'dough' |
| items | type | 'starter', 'dough' |
| stations | device_type | 'esp32', 'rpi' |
| items | inkbird_probe | 1, 2, 3, 4 (or NULL) |

## Deployment
- Deploy frontend via `git push` → Vercel CI/CD, not via Vercel CLI or MCP
- Veelvoorkomende eerste-deploy failures: RLS 403, CORS, enum mismatch
- Bij caching issues: wacht 30s en probeer opnieuw

## Code conventions
- TypeScript altijd — nooit `any`
- Verifieer imports zijn echt unused voor je ze verwijdert
- Bij similarly-named componenten: controleer het exacte bestandspad
- Voer na elke edit batch uit: `npx tsc --noEmit`

## Sessie werkwijze
Begin elke feature met een plan: gebruik TodoWrite om alle files en stappen te listen vóórdat je begint met editen. Wacht op goedkeuring.

Kleine commits, niet marathon sessies:
- Schema eerst → apart commit
- Backend (RPi) → apart commit
- Frontend → apart commit
- Elke commit moet zelfstandig deploybaar zijn

Bij bug fixes: schrijf eerst een beschrijving van wat er mis gaat, dan pas code. Nooit gokken.

Na elke sessie: update `~/knowledge-vault/sour/sessions.md` met wat er gebouwd is, bugs, en next steps.

## Debug workflow
1. Frontend: browser dev tools → Network tab → check Supabase responses
2. RPi: `journalctl -u sourdough -f` for service logs
3. Supabase: Dashboard → Logs → API logs
4. Always check actual DB state before assuming a bug is in the code
