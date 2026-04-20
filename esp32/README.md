# ESP32 firmware

Reads SCD4x (CO2/temp/RH), VL53L5CX (8x8 ToF), and a DS18B20 probe.
Publishes measurements to MQTT every `INTERVAL_SEC` (300s by default),
NTP-aligned. Heartbeats every 60s. Diagnostic events on the `/diag`
topic for post-mortem debugging of clock/network stalls.

## First-time setup

1. **Copy the credentials template and fill it in:**
   ```bash
   cp src/secrets.h.example src/secrets.h
   $EDITOR src/secrets.h
   ```
   `src/secrets.h` is gitignored so your WiFi/MQTT credentials never
   leave your machine. Each ESP32 gets its own `STATION_ID` here
   (2, 3, 4, ... — station 1 is the Pi).

2. **Flash.** Either PlatformIO (`pio run -t upload`) or Arduino IDE
   (see below).

## Updating the firmware after git pull

Just pull. Your `secrets.h` is untouched because it's not in git.

```bash
git pull
# re-flash however you usually do
```

No merge conflicts on credentials, no re-entering your WiFi password.

## Arduino IDE workflow

Arduino IDE wants a folder with a `.ino` file inside named after the
folder. To use this repo directly:

1. Clone the repo somewhere on disk (e.g. `~/Arduino/sour-station`).
2. Rename or symlink `esp32/src` so the folder name matches a `.ino`
   inside, or just open the sketch folder and point Arduino at
   `main.cpp` (Arduino 2.x accepts `.cpp` files next to the `.ino`).
3. Create `secrets.h` next to `main.cpp` (copy from the example).
4. Select board: *ESP32 Dev Module*, port, and upload.
5. For updates: `git pull` in the repo folder, then re-upload.
   `secrets.h` is preserved because git ignores it.

Install the same libraries listed in `platformio.ini` via Arduino's
Library Manager:
- `PubSubClient` by Nick O'Leary
- `ArduinoJson` by Benoit Blanchon
- `Sensirion I2C SCD4x`
- `OneWire` by Paul Stoffregen
- `DallasTemperature` by Miles Burton
- `SparkFun VL53L5CX Arduino Library`

## Flashing multiple ESP32s

Per device, edit the one line in `secrets.h`:

```c
#define SECRET_STATION_ID  3   // <-- change per device
```

Everything else stays the same across all your stations.
