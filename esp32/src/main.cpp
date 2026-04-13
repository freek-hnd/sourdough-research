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

#ifndef STATION_ID
#define STATION_ID 2
#endif
#ifndef INTERVAL_SEC
#define INTERVAL_SEC 300
#endif

// --- Pin config --------------------------------------------------------------
#define I2C_SDA 21
#define I2C_SCL 22
#define ONE_WIRE_BUS 4

static const char* WIFI_SSID   = "CHANGE_ME";
static const char* WIFI_PASS   = "CHANGE_ME";
static const char* MQTT_SERVER = "192.168.1.10";
static const uint16_t MQTT_PORT = 1883;

static const char* NTP_SERVER  = "pool.ntp.org";
static const long  GMT_OFFSET  = 0;
static const int   DST_OFFSET  = 0;

static const uint32_t HEARTBEAT_INTERVAL_MS = 60000;

WiFiClient netClient;
PubSubClient mqtt(netClient);

char measurementsTopic[64];
char statusTopic[64];
char clientId[32];

uint32_t lastHeartbeatMs = 0;
time_t   lastMeasurementEpoch = 0;

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

// --- Setup / Loop ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  snprintf(clientId, sizeof(clientId), "station-%d", STATION_ID);
  snprintf(measurementsTopic, sizeof(measurementsTopic),
           "sourdough/station/%d/measurements", STATION_ID);
  snprintf(statusTopic, sizeof(statusTopic),
           "sourdough/station/%d/status", STATION_ID);

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
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  time_t now;
  time(&now);

  // NTP-aligned interval: fire when epoch crosses a boundary.
  time_t aligned = (now / INTERVAL_SEC) * INTERVAL_SEC;
  if (aligned != lastMeasurementEpoch && now >= aligned) {
    lastMeasurementEpoch = aligned;
    publishMeasurement(aligned);
  }

  uint32_t ms = millis();
  if (ms - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = ms;
    publishHeartbeat();
  }

  delay(100);
}
