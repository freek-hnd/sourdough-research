# ESP32 firmware

Reads SCD4x (CO2/temp/RH), VL53L5CX (8x8 ToF), and a DS18B20 probe.
Publishes measurements to MQTT every `INTERVAL_SEC` (300s by default),
NTP-aligned. Heartbeats every 60s. Diagnostic events on the `/diag`
topic for post-mortem debugging of clock/network stalls.

## Folder contents

```
esp32/src/
├── src.ino                       ← Arduino IDE entry point (stub)
├── main.cpp                      ← the real firmware code
├── device_config.h.example       ← template for per-device settings
└── device_config.h               ← YOUR settings (gitignored, you create this)
```

`device_config.h` holds **everything that differs between ESP32s**:
WiFi credentials, MQTT broker IP, and the station ID. It's gitignored
so `git pull` never overwrites it.

---

## Arduino IDE workflow (recommended — no copy-pasting)

### One-time setup

1. Open a terminal. If the repo isn't cloned yet:
   ```bash
   git clone https://github.com/freek-hnd/sourdough-research.git ~/Documents/GitHub/sourdough-research
   ```

2. Create your `device_config.h`:
   ```bash
   cd ~/Documents/GitHub/sourdough-research/esp32/src
   cp device_config.h.example device_config.h
   ```

3. Edit `device_config.h` and fill in your real values:
   ```c
   #define DEVICE_STATION_ID  2                  // 2 = first ESP32
   #define DEVICE_WIFI_SSID   "jouw-wifi"
   #define DEVICE_WIFI_PASS   "jouw-wachtwoord"
   #define DEVICE_MQTT_SERVER "192.168.x.y"      // Pi IP
   #define DEVICE_MQTT_PORT   1883
   ```

4. In Arduino IDE: **File → Open** → navigate to
   `sourdough-research/esp32/src/src.ino` and open it.

5. Install the required libraries via **Tools → Manage Libraries**:
   - `PubSubClient` by Nick O'Leary
   - `ArduinoJson` by Benoit Blanchon
   - `Sensirion I2C SCD4x`
   - `OneWire` by Paul Stoffregen
   - `DallasTemperature` by Miles Burton
   - `SparkFun VL53L5CX Arduino Library`

6. **Tools → Board → ESP32 → ESP32 Dev Module**, pick the **Port**,
   click **Upload**.

### Every time there's an update

```bash
cd ~/Documents/GitHub/sourdough-research
git pull
```

Back in Arduino IDE, click **Upload** again. Done.

- `main.cpp` updates via `git pull`
- `device_config.h` stays untouched (gitignored)
- Zero copy-pasting, zero merge drama

### Flashing a second/third ESP32

Only **one line** needs to change per device — `DEVICE_STATION_ID`:

```c
#define DEVICE_STATION_ID  3    // was 2 for the first device
```

Flip the line, flash, flip it back if you want. All other settings
(WiFi, MQTT) stay the same across devices.

---

## Migrating from the old `secrets.h` name

If you already had `esp32/src/secrets.h` from an earlier version,
just rename it and replace the macro prefix:

```bash
mv esp32/src/secrets.h esp32/src/device_config.h
```

Then in `device_config.h`, replace `SECRET_` with `DEVICE_` on every
line (five occurrences). Both filenames stay gitignored so nothing
can leak.

---

## PlatformIO workflow (alternative)

Same repo works with PlatformIO out of the box:

```bash
cd ~/Documents/GitHub/sourdough-research/esp32
cp src/device_config.h.example src/device_config.h
# edit src/device_config.h
pio run -t upload
```

`.ino` files sitting next to `.cpp` files are compiled normally by
the Arduino framework — both toolchains see the same source.
