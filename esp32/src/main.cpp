#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

#ifndef STATION_ID
#define STATION_ID 2
#endif
#ifndef INTERVAL_SEC
#define INTERVAL_SEC 300
#endif

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

// --- Sensor stubs ---------------------------------------------------------
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

static void readToF(SensorSample&)      { /* TODO: VL53L5CX */ }
static void readSCD41(SensorSample&)    { /* TODO: SCD41 I2C */ }
static void readDS18B20(SensorSample&)  { /* TODO: OneWire */ }
static void readIR(SensorSample&)       { /* TODO: MLX90614 */ }
static void readLoadCell(SensorSample&) { /* TODO: HX711 */ }

// --- Networking -----------------------------------------------------------
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

// --- ISO8601 UTC ----------------------------------------------------------
static void formatIso8601(time_t t, char* out, size_t n) {
  struct tm tm_utc;
  gmtime_r(&t, &tm_utc);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

// --- Publishers -----------------------------------------------------------
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

// --- Setup / Loop ---------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  snprintf(clientId, sizeof(clientId), "station-%d", STATION_ID);
  snprintf(measurementsTopic, sizeof(measurementsTopic),
           "sourdough/station/%d/measurements", STATION_ID);
  snprintf(statusTopic, sizeof(statusTopic),
           "sourdough/station/%d/status", STATION_ID);

  connectWifi();
  syncTime();
  connectMqtt();
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
