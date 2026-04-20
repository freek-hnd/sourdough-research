#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <Wire.h>
#include <SensirionI2cScd4x.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <SparkFun_VL53L5CX_Library.h>
#include "esp_task_wdt.h"

// Per-device config (WiFi, MQTT broker, station ID).
// Preferred: device_config.h (copy from device_config.h.example).
// Also accepted: the older secrets.h name, for people who haven't
// migrated yet. device_config.h wins if both exist.
#if __has_include("device_config.h")
  #include "device_config.h"
#elif __has_include("secrets.h")
  #include "secrets.h"
#else
  #error "Missing device_config.h — copy device_config.h.example to device_config.h and edit it."
#endif

// Backward-compat shims: if the config file still uses the old SECRET_*
// prefix (from before the rename to DEVICE_*), map them through so the
// rest of the code can use DEVICE_* uniformly.
#if !defined(DEVICE_WIFI_SSID)   && defined(SECRET_WIFI_SSID)
  #define DEVICE_WIFI_SSID   SECRET_WIFI_SSID
#endif
#if !defined(DEVICE_WIFI_PASS)   && defined(SECRET_WIFI_PASS)
  #define DEVICE_WIFI_PASS   SECRET_WIFI_PASS
#endif
#if !defined(DEVICE_MQTT_SERVER) && defined(SECRET_MQTT_SERVER)
  #define DEVICE_MQTT_SERVER SECRET_MQTT_SERVER
#endif
#if !defined(DEVICE_MQTT_PORT)   && defined(SECRET_MQTT_PORT)
  #define DEVICE_MQTT_PORT   SECRET_MQTT_PORT
#endif
#if !defined(DEVICE_STATION_ID)  && defined(SECRET_STATION_ID)
  #define DEVICE_STATION_ID  SECRET_STATION_ID
#endif

// STATION_ID may also be supplied via -DSTATION_ID=N (platformio build flag)
// to override what's in device_config.h; otherwise use the device_config value.
#ifndef STATION_ID
#define STATION_ID DEVICE_STATION_ID
#endif
#ifndef INTERVAL_SEC
#define INTERVAL_SEC 300
#endif

// --- Pin config --------------------------------------------------------------
#define I2C_SDA 21
#define I2C_SCL 22
#define ONE_WIRE_BUS 4

static const char* WIFI_SSID   = DEVICE_WIFI_SSID;
static const char* WIFI_PASS   = DEVICE_WIFI_PASS;
static const char* MQTT_SERVER = DEVICE_MQTT_SERVER;
static const uint16_t MQTT_PORT = DEVICE_MQTT_PORT;

static const char* NTP_SERVER  = "pool.ntp.org";
static const long  GMT_OFFSET  = 0;
static const int   DST_OFFSET  = 0;

static const uint32_t HEARTBEAT_INTERVAL_MS = 60000;

WiFiClient netClient;
PubSubClient mqtt(netClient);

char measurementsTopic[64];
char statusTopic[64];
char diagTopic[64];
char clientId[32];

uint32_t lastHeartbeatMs = 0;
time_t   lastMeasurementEpoch = 0;

// --- Diagnostic state tracking ----------------------------------------------
// Keep short histories of time_t and millis() so we can detect stale/frozen
// time, backwards jumps, and forward jumps (all suspects for the "measurements
// stop but heartbeat continues" symptom).
static time_t  prevTime = 0;
static uint32_t prevTimeCheckMs = 0;
static uint32_t stuckTimeCount = 0;
static uint32_t loopIterations = 0;
static uint32_t lastDiagPublishMs = 0;
static uint32_t diagSeq = 0;
static uint32_t wifiReconnectCount = 0;
static uint32_t mqttReconnectCount = 0;
static uint32_t fallbackPublishCount = 0;

// --- Sensor globals ----------------------------------------------------------

// SCD4x (CO2, temperature, humidity)
#ifdef NO_ERROR
#undef NO_ERROR
#endif
#define NO_ERROR 0

SensirionI2cScd4x scd4x;
static char scdErrorMsg[64];
static int16_t scdError;
static uint16_t latestCO2 = 0;
static float latestScdTempC = NAN;
static float latestScdHumidity = NAN;
static bool scdInitOk = false;

// DS18B20 (probe temperature)
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature probeSensor(&oneWire);
static bool dsInitOk = false;

// VL53L5CX (8x8 ToF distance)
SparkFun_VL53L5CX tof;
VL53L5CX_ResultsData tofData;
static bool tofInitOk = false;
static bool tofHasData = false;

// --- Data sample struct ------------------------------------------------------
struct SensorSample {
  bool  haveToF = false;
  float tofMedianMm = 0, tofMinMm = 0, tofMaxMm = 0;
  int   tofGrid[64] = {0};

  bool  haveSCD = false;
  float co2Ppm = 0, scdTempC = 0, scdHumidityPct = 0;

  bool  haveDS = false;
  float ds18b20TempC = 0;

  bool  haveIR = false;
  float irSurfaceTempC = 0;

  bool  haveLoad = false;
  float loadCellG = 0;
};

// --- Helpers -----------------------------------------------------------------

static void sortUint16(uint16_t arr[], int n) {
  for (int i = 0; i < n - 1; i++) {
    for (int j = i + 1; j < n; j++) {
      if (arr[j] < arr[i]) {
        uint16_t tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
  }
}

static uint16_t computeMedianDistance(VL53L5CX_ResultsData* data) {
  uint16_t vals[64];
  int count = 0;
  for (int i = 0; i < 64; i++) {
    uint16_t d = data->distance_mm[i];
    if (d > 0 && d < 4000) {
      vals[count++] = d;
    }
  }
  if (count == 0) return 0;
  sortUint16(vals, count);
  if (count % 2 == 1) return vals[count / 2];
  return (vals[count / 2 - 1] + vals[count / 2]) / 2;
}

// --- Sensor init (called once in setup) --------------------------------------

static void initSCD4x() {
  scd4x.begin(Wire, SCD41_I2C_ADDR_62);
  delay(30);

  scdError = scd4x.wakeUp();
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] wakeUp error: %s\n", scdErrorMsg);
  }

  scdError = scd4x.stopPeriodicMeasurement();
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] stopPeriodicMeasurement error: %s\n", scdErrorMsg);
  }

  scdError = scd4x.reinit();
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] reinit error: %s\n", scdErrorMsg);
    return;
  }

  uint64_t serialNumber = 0;
  scdError = scd4x.getSerialNumber(serialNumber);
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] getSerialNumber error: %s\n", scdErrorMsg);
    return;
  }
  Serial.printf("[scd4x] serial=0x%08lX%08lX\n",
    (uint32_t)(serialNumber >> 32), (uint32_t)(serialNumber & 0xFFFFFFFF));

  scdError = scd4x.startPeriodicMeasurement();
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] startPeriodicMeasurement error: %s\n", scdErrorMsg);
    return;
  }

  scdInitOk = true;
  Serial.println("[scd4x] ok");
}

static void initDS18B20() {
  probeSensor.begin();
  dsInitOk = true;
  Serial.println("[ds18b20] ok");
}

static void initToF() {
  if (!tof.begin()) {
    Serial.println("[vl53l5cx] not found on I2C");
    return;
  }

  tof.setResolution(8 * 8);
  tof.setRangingFrequency(5);

  if (!tof.startRanging()) {
    Serial.println("[vl53l5cx] failed to start ranging");
    return;
  }

  tofInitOk = true;
  Serial.println("[vl53l5cx] ok (8x8 @ 5Hz)");
}

// --- Sensor reads (called on each measurement tick) --------------------------

static void readSCD41(SensorSample& s) {
  if (!scdInitOk) return;

  // Poll for ready data (SCD4x measures every ~5s internally)
  bool dataReady = false;
  scdError = scd4x.getDataReadyStatus(dataReady);
  if (scdError != NO_ERROR || !dataReady) return;

  uint16_t co2 = 0;
  float temp = 0.0f;
  float rh = 0.0f;
  scdError = scd4x.readMeasurement(co2, temp, rh);
  if (scdError != NO_ERROR) {
    errorToString(scdError, scdErrorMsg, sizeof(scdErrorMsg));
    Serial.printf("[scd4x] readMeasurement error: %s\n", scdErrorMsg);
    return;
  }

  // Cache latest values
  latestCO2 = co2;
  latestScdTempC = temp;
  latestScdHumidity = rh;

  s.haveSCD = true;
  s.co2Ppm = (float)co2;
  s.scdTempC = temp;
  s.scdHumidityPct = rh;
}

static void readDS18B20(SensorSample& s) {
  if (!dsInitOk) return;

  probeSensor.requestTemperatures();
  float t = probeSensor.getTempCByIndex(0);

  if (t == DEVICE_DISCONNECTED_C || t < -50.0f || t > 125.0f) {
    Serial.println("[ds18b20] disconnected or out of range");
    return;
  }

  s.haveDS = true;
  s.ds18b20TempC = t;
}

static void readToF(SensorSample& s) {
  if (!tofInitOk) return;

  if (!tof.isDataReady()) return;

  if (!tof.getRangingData(&tofData)) {
    Serial.println("[vl53l5cx] getRangingData failed");
    return;
  }

  tofHasData = true;
  uint16_t medianMm = computeMedianDistance(&tofData);

  // Compute min and max from valid distances
  uint16_t minMm = 0xFFFF, maxMm = 0;
  for (int i = 0; i < 64; i++) {
    uint16_t d = tofData.distance_mm[i];
    if (d > 0 && d < 4000) {
      if (d < minMm) minMm = d;
      if (d > maxMm) maxMm = d;
    }
  }
  if (minMm == 0xFFFF) minMm = 0;

  s.haveToF = true;
  s.tofMedianMm = (float)medianMm;
  s.tofMinMm = (float)minMm;
  s.tofMaxMm = (float)maxMm;
  for (int i = 0; i < 64; i++) {
    s.tofGrid[i] = (int)tofData.distance_mm[i];
  }
}

static void readIR(SensorSample&)       { /* TODO: MLX90614 */ }
static void readLoadCell(SensorSample&) { /* TODO: HX711 */ }

// --- Networking --------------------------------------------------------------
static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[wifi] ok ip=%s\n", WiFi.localIP().toString().c_str());
}

static void syncTime() {
  configTime(GMT_OFFSET, DST_OFFSET, NTP_SERVER);
  Serial.print("[ntp] syncing");
  time_t now = 0;
  while (now < 1700000000) {
    delay(500);
    Serial.print(".");
    time(&now);
  }
  Serial.printf("\n[ntp] ok epoch=%ld\n", (long)now);
}

static void connectMqtt() {
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setBufferSize(2048);
  while (!mqtt.connected()) {
    Serial.printf("[mqtt] connecting as %s...", clientId);
    if (mqtt.connect(clientId, nullptr, nullptr, statusTopic, 1, true, "offline")) {
      Serial.println(" ok");
      mqtt.publish(statusTopic, "online", true);
    } else {
      Serial.printf(" fail rc=%d, retry in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

// --- ISO8601 UTC -------------------------------------------------------------
static void formatIso8601(time_t t, char* out, size_t n) {
  struct tm tm_utc;
  gmtime_r(&t, &tm_utc);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

// --- Publishers --------------------------------------------------------------
static void publishMeasurement(time_t alignedEpoch) {
  SensorSample s;
  readToF(s); readSCD41(s); readDS18B20(s); readIR(s); readLoadCell(s);

  StaticJsonDocument<2048> doc;
  doc["station_id"] = STATION_ID;
  char ts[32]; formatIso8601(alignedEpoch, ts, sizeof(ts));
  doc["ts"] = ts;

  if (s.haveToF) {
    doc["tof_median_mm"] = s.tofMedianMm;
    doc["tof_min_mm"]    = s.tofMinMm;
    doc["tof_max_mm"]    = s.tofMaxMm;
    JsonArray grid = doc.createNestedArray("tof_grid");
    for (int i = 0; i < 64; i++) grid.add(s.tofGrid[i]);
  }
  if (s.haveSCD) {
    doc["co2_ppm"]          = s.co2Ppm;
    doc["scd_temp_c"]       = s.scdTempC;
    doc["scd_humidity_pct"] = s.scdHumidityPct;
  }
  if (s.haveDS)   doc["ds18b20_temp_c"]    = s.ds18b20TempC;
  if (s.haveIR)   doc["ir_surface_temp_c"] = s.irSurfaceTempC;
  if (s.haveLoad) doc["load_cell_g"]       = s.loadCellG;

  char buf[2048];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  bool ok = mqtt.publish(measurementsTopic, (const uint8_t*)buf, n, false);
  Serial.printf("[pub] %s bytes=%u ok=%d\n", ts, (unsigned)n, ok);
}

static void publishHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["station_id"] = STATION_ID;
  doc["uptime_s"]   = (uint32_t)(millis() / 1000);
  doc["rssi"]       = WiFi.RSSI();
  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(statusTopic, (const uint8_t*)buf, n, true);
}

// --- Diagnostics -------------------------------------------------------------
// Publish a rich snapshot of internal clock + network state to /diag. Called
// every 60s and immediately on any detected anomaly. Goes to a separate topic
// so it can be captured by the Pi without polluting measurement/status data.
static void publishDiag(const char* reason, const char* extra = nullptr) {
  diagSeq++;
  time_t now = 0;
  time(&now);
  uint32_t nowMs = millis();

  StaticJsonDocument<512> doc;
  doc["station_id"]            = STATION_ID;
  doc["seq"]                   = diagSeq;
  doc["reason"]                = reason;
  // Dual clock — this is the whole point. Compare time_t vs millis to see
  // which one is misbehaving during an incident.
  doc["time_t"]                = (int64_t)now;
  doc["millis"]                = nowMs;
  doc["uptime_s"]              = nowMs / 1000;
  // State that feeds the NTP-aligned publish condition
  doc["lastMeasurementEpoch"]  = (int64_t)lastMeasurementEpoch;
  doc["aligned"]               = (int64_t)((now / INTERVAL_SEC) * INTERVAL_SEC);
  doc["secsSinceLastMeas"]     = (int64_t)(now > 0 ? (now - lastMeasurementEpoch) : -1);
  // Network
  doc["wifiStatus"]            = (int)WiFi.status();
  doc["rssi"]                  = WiFi.RSSI();
  doc["mqttState"]             = mqtt.state();
  doc["mqttConnected"]         = mqtt.connected();
  // Health counters
  doc["loopIter"]              = loopIterations;
  doc["stuckTimeCount"]        = stuckTimeCount;
  doc["wifiReconnects"]        = wifiReconnectCount;
  doc["mqttReconnects"]        = mqttReconnectCount;
  doc["fallbackPublishes"]     = fallbackPublishCount;
  doc["freeHeap"]              = ESP.getFreeHeap();
  if (extra) doc["extra"]      = extra;

  char buf[512];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  bool ok = mqtt.publish(diagTopic, (const uint8_t*)buf, n, false);
  Serial.printf("[diag] seq=%u reason=%s time=%lld lastMeas=%lld mqtt=%d ok=%d\n",
                (unsigned)diagSeq, reason, (long long)now,
                (long long)lastMeasurementEpoch, mqtt.state(), ok);
  lastDiagPublishMs = nowMs;
}

// Check the time_t clock for anomalies and publish a diag event if anything
// looks wrong. Called on every loop iteration — cheap because it only compares
// a couple of ints and publishes on edge transitions.
static void checkTimeAnomalies(time_t now, uint32_t nowMs) {
  // First call — just seed
  if (prevTime == 0 && prevTimeCheckMs == 0) {
    prevTime = now;
    prevTimeCheckMs = nowMs;
    return;
  }

  int64_t dMs   = (int64_t)nowMs - (int64_t)prevTimeCheckMs;
  int64_t dTime = (int64_t)now   - (int64_t)prevTime;

  // 1. time_t is invalid (0 or pre-2024). Only report once every 30s to
  //    avoid flooding.
  if (now > 0 && now < 1704067200 /* 2024-01-01 */ && dMs > 30000) {
    publishDiag("time_invalid", "time_t below 2024");
    prevTime = now;
    prevTimeCheckMs = nowMs;
    return;
  }

  // Only compare if >=2s of millis have passed — too small a window is noisy.
  if (dMs < 2000) return;

  // 2. time_t froze — millis advanced but time_t didn't
  if (dTime == 0) {
    stuckTimeCount++;
    if (stuckTimeCount == 3) {
      // Only publish once we've seen it 3 times in a row (6+ seconds stuck)
      publishDiag("time_stuck", "time_t not advancing");
    }
  } else {
    stuckTimeCount = 0;
  }

  // 3. time_t went backwards
  if (dTime < -5) {
    char extra[64];
    snprintf(extra, sizeof(extra), "dTime=%lld dMs=%lld", (long long)dTime, (long long)dMs);
    publishDiag("time_backwards", extra);
  }

  // 4. time_t jumped forward much more than millis (big NTP correction)
  if (dTime > (dMs / 1000) + 60) {
    char extra[64];
    snprintf(extra, sizeof(extra), "dTime=%lld dMs=%lld", (long long)dTime, (long long)dMs);
    publishDiag("time_jumped_forward", extra);
  }

  // 5. The condition that would actually cause the bug: alignment stuck
  //    (lastMeasurementEpoch >= current aligned). Only meaningful once we've
  //    had at least one measurement published.
  if (lastMeasurementEpoch > 0 && now > 0) {
    time_t currentAligned = (now / INTERVAL_SEC) * INTERVAL_SEC;
    int64_t lag = (int64_t)now - (int64_t)lastMeasurementEpoch;
    // If it's been 2x the interval or more since last measurement, and
    // the aligned boundary is not ahead of lastMeasurementEpoch, the
    // publish condition is wedged.
    if (lag > 2 * INTERVAL_SEC && currentAligned <= lastMeasurementEpoch) {
      // Debounce — only publish once per minute
      static uint32_t lastWedgeDiag = 0;
      if (nowMs - lastWedgeDiag > 60000) {
        lastWedgeDiag = nowMs;
        char extra[96];
        snprintf(extra, sizeof(extra), "lag=%llds aligned=%lld <= lastMeas=%lld",
                 (long long)lag, (long long)currentAligned, (long long)lastMeasurementEpoch);
        publishDiag("alignment_wedged", extra);
      }
    }
  }

  prevTime = now;
  prevTimeCheckMs = nowMs;
}

// --- Setup / Loop ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  snprintf(clientId, sizeof(clientId), "station-%d", STATION_ID);
  snprintf(measurementsTopic, sizeof(measurementsTopic),
           "sourdough/station/%d/measurements", STATION_ID);
  snprintf(statusTopic, sizeof(statusTopic),
           "sourdough/station/%d/status", STATION_ID);
  snprintf(diagTopic, sizeof(diagTopic),
           "sourdough/station/%d/diag", STATION_ID);

  // I2C bus — must init before SCD4x and VL53L5CX
  Wire.begin(I2C_SDA, I2C_SCL);

  // Init sensors in order (matches working reference firmware)
  initSCD4x();
  initDS18B20();
  initToF();

  connectWifi();
  syncTime();
  connectMqtt();

  Serial.println("[setup] complete");

  // Enable watchdog only after WiFi + NTP + MQTT are up. If the loop hangs
  // for >60s without resetting it, the ESP32 hard-resets.
  //
  // ESP32 Arduino core 3.x (ESP-IDF 5.x) changed the API from
  //   esp_task_wdt_init(timeout, panic)
  // to
  //   esp_task_wdt_init(const esp_task_wdt_config_t*)
  // We pick the right one at compile time based on the core version.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms     = 60000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  esp_task_wdt_init(&wdt_config);
#else
  esp_task_wdt_init(60, true);
#endif
  esp_task_wdt_add(NULL);
  Serial.println("[wdt] watchdog started (60s)");

  // First diag publish — captures the post-boot state so we have a reference
  // for what "healthy" looks like on this device.
  publishDiag("boot");
}

void loop() {
  esp_task_wdt_reset();
  loopIterations++;

  // Track WiFi/MQTT reconnects with diagnostics so we can correlate with
  // measurement gaps in post-mortem analysis.
  if (WiFi.status() != WL_CONNECTED) {
    wifiReconnectCount++;
    publishDiag("wifi_reconnect");  // best-effort; may fail if MQTT is down too
    connectWifi();
  }
  if (!mqtt.connected()) {
    mqttReconnectCount++;
    int rc = mqtt.state();
    char extra[32];
    snprintf(extra, sizeof(extra), "prevState=%d", rc);
    connectMqtt();
    publishDiag("mqtt_reconnect", extra);
  }
  mqtt.loop();

  time_t now;
  time(&now);

  uint32_t nowMs = millis();
  static uint32_t lastMeasurementMs = 0;
  static uint32_t lastNtpSyncMs = 0;

  // Watch the clock for anomalies every iteration.
  checkTimeAnomalies(now, nowMs);

  // NTP-aligned interval: fire when epoch crosses a boundary.
  time_t aligned = (now / INTERVAL_SEC) * INTERVAL_SEC;
  if (aligned != lastMeasurementEpoch && now >= aligned) {
    lastMeasurementEpoch = aligned;
    publishMeasurement(aligned);
    lastMeasurementMs = nowMs;
  }

  // Fallback: if no measurement published for >10 minutes (NTP drifted or
  // alignment got stuck), force-publish so the station doesn't go silent.
  if (lastMeasurementMs == 0) lastMeasurementMs = nowMs;
  if (nowMs - lastMeasurementMs > 10UL * 60UL * 1000UL) {
    fallbackPublishCount++;
    Serial.println("[fallback] no measurement for 10min, forcing publish");
    publishDiag("fallback_triggered");
    publishMeasurement(now > 0 ? now : (time_t)(nowMs / 1000));
    lastMeasurementMs = nowMs;
  }

  // Periodic NTP resync to prevent long-term clock drift. Log time before
  // and after so we can see if resync caused a big jump.
  if (nowMs - lastNtpSyncMs > 6UL * 60UL * 60UL * 1000UL) {
    lastNtpSyncMs = nowMs;
    time_t beforeResync = 0;
    time(&beforeResync);
    configTime(GMT_OFFSET, DST_OFFSET, NTP_SERVER);
    time_t afterResync = 0;
    time(&afterResync);
    Serial.println("[ntp] resynced");
    char extra[64];
    snprintf(extra, sizeof(extra), "before=%lld after=%lld",
             (long long)beforeResync, (long long)afterResync);
    publishDiag("ntp_resync", extra);
  }

  // Periodic diagnostic heartbeat — every 60s even when nothing anomalous.
  // Gives us a rolling baseline of time_t vs millis to compare against when
  // something goes wrong.
  if (nowMs - lastDiagPublishMs > 60000UL) {
    publishDiag("periodic");
  }

  uint32_t ms = millis();
  if (ms - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = ms;
    publishHeartbeat();
  }

  delay(100);
}
