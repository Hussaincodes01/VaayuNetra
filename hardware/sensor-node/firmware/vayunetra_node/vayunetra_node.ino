// VayuNetra sensor node: ESP32 + Figaro TGS2611-E00 + Bosch BME280, solar powered.
// Reads every INTERVAL_S seconds, keeps readings in RTC memory through deep sleep, uploads batches to
// POST /api/sensors/ingest. Reference firmware: untested on hardware. Libraries: Adafruit BME280,
// ArduinoJson (v7).
//
// Wiring: TGS2611 heater on the always-on 5 V rail (it must stay warm); its sensing element in series
// with a load resistor RL between 5 V and GND, the midpoint through a divider into ADC pin SENSOR_PIN.
// BME280 on I2C (SDA 21, SCL 22).

#include <Adafruit_BME280.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

// --- set before flashing ---------------------------------------------------------------------
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";
const char* INGEST_URL = "https://vayunetra-india.vercel.app/api/sensors/ingest";
const char* DEVICE_KEY = "";          // from Sensors -> Register a real sensor node (shown once)
const float RL_OHMS = 10000.0;        // load resistor
const float R0_OHMS = 20000.0;        // sensor resistance at the calibration reference concentration
const float DIVIDER = 2.0;            // ADC divider ratio (5 V circuit into the 3.3 V ADC)
const int SENSOR_PIN = 34;
// ---------------------------------------------------------------------------------------------

struct Reading {
  uint32_t at;        // unix seconds (UTC)
  float rs_ratio;     // Rs / R0
  float temp_c, rh_pct, pressure_hpa, battery_v;
};

const int CAPACITY = 144;  // one day at 10-minute readings
RTC_DATA_ATTR Reading buffer[CAPACITY];
RTC_DATA_ATTR int count = 0;
RTC_DATA_ATTR uint32_t intervalS = 600;

Adafruit_BME280 bme;

float readRsRatio() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(SENSOR_PIN);
  float vout = (mv / 16.0f) / 1000.0f * DIVIDER;  // volts across RL
  if (vout <= 0.01f) return NAN;
  float rs = RL_OHMS * (5.0f - vout) / vout;
  return rs / R0_OHMS;
}

float readBattery() {
  // Battery through a 1:2 divider on pin 35 (adjust for your board).
  return analogReadMilliVolts(35) / 1000.0f * 2.0f;
}

bool connectWifi() {
  if (strlen(WIFI_SSID) == 0) return false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

bool syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 20; i++) {
    if (time(nullptr) > 1700000000) return true;
    delay(250);
  }
  return false;
}

void isoTime(uint32_t t, char* out, size_t n) {
  time_t tt = t;
  struct tm g;
  gmtime_r(&tt, &g);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &g);
}

// Send the buffer; on success clear it and take the interval the server asks for.
bool upload() {
  if (count == 0) return true;
  JsonDocument doc;
  JsonArray arr = doc["readings"].to<JsonArray>();
  char iso[24];
  for (int i = 0; i < count; i++) {
    JsonObject r = arr.add<JsonObject>();
    isoTime(buffer[i].at, iso, sizeof iso);
    r["at"] = iso;
    if (!isnan(buffer[i].rs_ratio)) r["rs_ratio"] = buffer[i].rs_ratio;
    r["temp_c"] = buffer[i].temp_c;
    r["rh_pct"] = buffer[i].rh_pct;
    r["pressure_hpa"] = buffer[i].pressure_hpa;
    r["battery_v"] = buffer[i].battery_v;
  }
  String body;
  serializeJson(doc, body);
  WiFiClientSecure tls;
  tls.setInsecure();  // replace with the server's root certificate for production units
  HTTPClient http;
  http.begin(tls, INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_KEY);
  int code = http.POST(body);
  if (code == 200) {
    JsonDocument res;
    if (!deserializeJson(res, http.getString()) && res["interval_s"].is<uint32_t>())
      intervalS = constrain(res["interval_s"].as<uint32_t>(), 60u, 3600u);
    count = 0;
  }
  http.end();
  return code == 200;
}

void setup() {
  Wire.begin(21, 22);
  bool haveBme = bme.begin(0x76) || bme.begin(0x77);
  bool online = connectWifi();
  if (online) syncTime();

  if (time(nullptr) > 1700000000) {  // only keep readings with a real timestamp
    Reading r;
    r.at = time(nullptr);
    r.rs_ratio = readRsRatio();
    r.temp_c = haveBme ? bme.readTemperature() : NAN;
    r.rh_pct = haveBme ? bme.readHumidity() : NAN;
    r.pressure_hpa = haveBme ? bme.readPressure() / 100.0f : NAN;
    r.battery_v = readBattery();
    if (count == CAPACITY) {  // full: drop the oldest
      memmove(buffer, buffer + 1, sizeof(Reading) * (CAPACITY - 1));
      count--;
    }
    buffer[count++] = r;
  }

  if (online) upload();
  WiFi.disconnect(true);
  esp_sleep_enable_timer_wakeup((uint64_t)intervalS * 1000000ULL);
  esp_deep_sleep_start();
}

void loop() {}
