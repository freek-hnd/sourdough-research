# Sourdough Research Platform

Citizen-science platform for predicting sourdough fermentation dynamics from real-time sensor measurements. Part of PhD research at VU Amsterdam.

## Architecture

```
ESP32 ×9 --MQTT/WiFi--> RPi Zero 2W --batch sync--> Supabase (Postgres) <-- Web App (Vite+React)
                         (Mosquitto + SQLite)                                  ↑
                         + Hanna pH (BT)                              phone / laptop / tablet
                         + Inkbird probes (BT)                        on any network
                         + own sensors (station #1)
```

All stations measure at NTP-aligned wall-clock intervals (default 5 min). The RPi is data-collection-only. All user interaction happens via the React web app talking directly to Supabase.

## Monorepo layout

| Dir | Purpose |
|-----|---------|
| `web/` | Vite + React + shadcn/ui app (deployed to Vercel) |
| `rpi/` | Python data collector running on Raspberry Pi Zero 2W |
| `esp32/` | PlatformIO firmware for ESP32 sensor stations |
| `supabase/` | SQL migrations + seed data |

## Database schema (12 tables)

| Table | Purpose |
|-------|---------|
| `root_starters` | Source starters (name, origin, received date) |
| `stations` | Physical measurement stations (RPi + 9 ESP32) |
| `batches` | A mix event — parent of 1+ items |
| `items` | A single ball of dough or jar of starter |
| `sessions` | Assignment of an item to a station for a time window |
| `measurements` | Station sensor readings (ToF, CO₂, temp, humidity, load cell) |
| `ph_readings` | Hanna pH meter readings (roaming device) |
| `inkbird_readings` | Inkbird 4-probe temperature (roaming) |
| `events` | Time-stamped user events (fold, shape, fridge, etc.) |
| `outcomes` | Bake outcome (oven temp, duration, loaf weight) |
| `ratings` | Post-bake sensory ratings (JSONB scores) |
| `photos` | Loaf photos (Supabase Storage refs) |

## Setup

### Supabase
1. Create a new Supabase project.
2. Run `supabase/migrations/001_initial_schema.sql` via the SQL editor or MCP.
3. Run `supabase/seed.sql` to seed stations 1–10.
4. Create a public storage bucket named `loaf-photos`.

### RPi (data collector)
```bash
cd rpi
pip install -r requirements.txt
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_KEY=<service_role_key>
python main.py
```

### ESP32 firmware
Open `esp32/` in PlatformIO, set WiFi + MQTT constants in `src/main.cpp`, flash one device per station.

### Web app
```bash
cd web
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Deploy via `git push` → Vercel.

## Running each component

| Component | Command |
|-----------|---------|
| Web dev server | `cd web && npm run dev` |
| RPi collector | `cd rpi && python main.py` |
| ESP32 flash | PlatformIO: Upload |
| DB migrations | via Supabase SQL editor or `mcp__supabase__apply_migration` |
