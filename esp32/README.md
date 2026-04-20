# ESP32 firmware

Reads SCD4x (CO2/temp/RH), VL53L5CX (8x8 ToF), and a DS18B20 probe.
Publishes measurements to MQTT every `INTERVAL_SEC` (300s by default),
NTP-aligned. Heartbeats every 60s. Diagnostic events on the `/diag`
topic for post-mortem debugging of clock/network stalls.

## Folder contents

```
esp32/src/
├── src.ino             ← Arduino IDE entry point (essentially empty)
├── main.cpp            ← the real firmware code
├── secrets.h.example   ← template for WiFi/MQTT credentials
└── secrets.h           ← YOUR credentials (gitignored, you create this)
```

Both `src.ino` and `main.cpp` are needed: Arduino IDE requires a
`.ino` file that matches the folder name (`src` → `src.ino`), and it
automatically compiles every `.cpp`/`.h` file in the same folder
alongside it. So the real code stays in `main.cpp` but Arduino IDE is
happy because it sees `src.ino`.

---

## Arduino IDE workflow (recommended — no copy-pasting)

### One-time setup

1. Open a terminal and make sure you already cloned the repo. If not:
   ```bash
   git clone https://github.com/freek-hnd/sourdough-research.git ~/Documents/GitHub/sourdough-research
   ```

2. Create your `secrets.h` next to `main.cpp`:
   ```bash
   cd ~/Documents/GitHub/sourdough-research/esp32/src
   cp secrets.h.example secrets.h
   ```

3. Open `secrets.h` in any editor and fill in your real values:
   ```c
   #define SECRET_WIFI_SSID   "jouw-wifi-naam"
   #define SECRET_WIFI_PASS   "jouw-wifi-wachtwoord"
   #define SECRET_MQTT_SERVER "192.168.x.y"     // Pi IP on your LAN
   #define SECRET_MQTT_PORT   1883
   #define SECRET_STATION_ID  2                 // 2 = first ESP32, 3 = second, etc.
   ```
   (Station 1 is the Raspberry Pi, so ESP32s start at 2.)

4. In Arduino IDE: **File → Open** → navigate to
   `sourdough-research/esp32/src/src.ino` and open it.

5. Install the required libraries via *Tools → Manage Libraries*:
   - `PubSubClient` by Nick O'Leary
   - `ArduinoJson` by Benoit Blanchon
   - `Sensirion I2C SCD4x`
   - `OneWire` by Paul Stoffregen
   - `DallasTemperature` by Miles Burton
   - `SparkFun VL53L5CX Arduino Library`

6. Select board: **Tools → Board → ESP32 → ESP32 Dev Module**,
   pick the right **Port**, then click **Upload** (→ arrow button).

That's it. You're set up.

### Every time there's an update

In a terminal:
```bash
cd ~/Documents/GitHub/sourdough-research
git pull
```

Then in Arduino IDE, click **Upload** again. Done.

- `main.cpp` updates via `git pull`
- `secrets.h` stays untouched (gitignored)
- You never copy-paste anything

### Flashing a second (or third) ESP32

Only `secrets.h` differs between devices. Either:
- Edit `SECRET_STATION_ID` in the same `secrets.h`, flash, then change it back, or
- Keep per-device copies: `secrets.h.station2`, `secrets.h.station3`, and
  symlink/rename the one you need before flashing.

---

## PlatformIO workflow (alternative)

Same repo works with PlatformIO out of the box:

```bash
cd ~/Documents/GitHub/sourdough-research/esp32
cp src/secrets.h.example src/secrets.h
# edit src/secrets.h
pio run -t upload
```

`.ino` files are compiled by PlatformIO just like `.cpp`, so `src.ino`
sitting next to `main.cpp` doesn't cause problems.
