#include "cloud/aliyun_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/md.h>

#include "cloud/cloud_config.h"

namespace {
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

uint32_t lastMqttReconnectMs = 0;
uint32_t lastControlPullMs = 0;
uint32_t messageId = 1;
bool wifiStarted = false;
DeviceControlState deviceControl;

String hexEncode(const uint8_t* data, size_t length) {
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    out += hex[(data[i] >> 4) & 0x0F];
    out += hex[data[i] & 0x0F];
  }
  return out;
}

String hmacSha256Hex(const String& content, const char* secret) {
  uint8_t digest[32] = {0};
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(mdInfo,
                  reinterpret_cast<const uint8_t*>(secret),
                  strlen(secret),
                  reinterpret_cast<const uint8_t*>(content.c_str()),
                  content.length(),
                  digest);
  return hexEncode(digest, sizeof(digest));
}

String mqttHost() {
  return String(CloudConfig::ALIYUN_PRODUCT_KEY) + ".iot-as-mqtt." +
         CloudConfig::ALIYUN_REGION_ID + ".aliyuncs.com";
}

String mqttBaseClientId() {
  return String(CloudConfig::ALIYUN_PRODUCT_KEY) + "." + CloudConfig::ALIYUN_DEVICE_NAME;
}

String mqttClientId(const String& timestamp) {
  return mqttBaseClientId() + "|securemode=2,signmethod=hmacsha256,timestamp=" +
         timestamp + "|";
}

String mqttUsername() {
  return String(CloudConfig::ALIYUN_DEVICE_NAME) + "&" + CloudConfig::ALIYUN_PRODUCT_KEY;
}

String mqttPassword(const String& timestamp) {
  const String clientId = mqttBaseClientId();
  const String content = "clientId" + clientId + "deviceName" +
                         CloudConfig::ALIYUN_DEVICE_NAME + "productKey" +
                         CloudConfig::ALIYUN_PRODUCT_KEY + "timestamp" + timestamp;
  return hmacSha256Hex(content, CloudConfig::ALIYUN_DEVICE_SECRET);
}

String propertyPostTopic() {
  return String("/sys/") + CloudConfig::ALIYUN_PRODUCT_KEY + "/" +
         CloudConfig::ALIYUN_DEVICE_NAME + "/thing/event/property/post";
}

void addFinite(JsonObject params, const char* key, float value) {
  if (isnan(value)) {
    params[key] = nullptr;
  } else {
    params[key] = value;
  }
}

void setFinite(JsonDocument& doc, const char* key, float value) {
  if (isnan(value)) {
    doc[key] = nullptr;
  } else {
    doc[key] = value;
  }
}

void setThreshold(JsonObject doc, const char* key, uint16_t value) {
  doc[key] = value;
}

void setThreshold(JsonObject doc, const char* key, float value) {
  doc[key] = value;
}

uint16_t readRawThreshold(const JsonDocument& doc, const char* key, uint16_t current) {
  if (!doc[key].is<uint16_t>() && !doc[key].is<int>() && !doc[key].is<float>()) {
    return current;
  }
  const int value = doc[key].as<int>();
  return static_cast<uint16_t>(constrain(value, 0, 4095));
}

float readFloatThreshold(const JsonDocument& doc, const char* key, float current, float minValue, float maxValue) {
  if (!doc[key].is<float>() && !doc[key].is<int>()) {
    return current;
  }
  const float value = doc[key].as<float>();
  if (isnan(value)) {
    return current;
  }
  return constrain(value, minValue, maxValue);
}

bool readBoolControl(const JsonDocument& doc, const char* key, bool current) {
  if (!doc[key].is<bool>()) {
    return current;
  }
  return doc[key].as<bool>();
}

void normalizeControlThresholds() {
  if (deviceControl.mq135Warn > deviceControl.mq135Danger) {
    const uint16_t swap = deviceControl.mq135Warn;
    deviceControl.mq135Warn = deviceControl.mq135Danger;
    deviceControl.mq135Danger = swap;
  }
  if (deviceControl.mq2Warn > deviceControl.mq2Danger) {
    const uint16_t swap = deviceControl.mq2Warn;
    deviceControl.mq2Warn = deviceControl.mq2Danger;
    deviceControl.mq2Danger = swap;
  }
  if (deviceControl.mq7Warn > deviceControl.mq7Danger) {
    const uint16_t swap = deviceControl.mq7Warn;
    deviceControl.mq7Warn = deviceControl.mq7Danger;
    deviceControl.mq7Danger = swap;
  }
  if (deviceControl.tempLow > deviceControl.tempHigh) {
    const float swap = deviceControl.tempLow;
    deviceControl.tempLow = deviceControl.tempHigh;
    deviceControl.tempHigh = swap;
  }
  if (deviceControl.humidityLow > deviceControl.humidityHigh) {
    const float swap = deviceControl.humidityLow;
    deviceControl.humidityLow = deviceControl.humidityHigh;
    deviceControl.humidityHigh = swap;
  }
}

String buildAlinkPayload(const TelemetryPayload& payload) {
  JsonDocument doc;
  doc["id"] = String(messageId++);
  doc["version"] = "1.0.5";
  doc["method"] = "thing.event.property.post";

  JsonObject params = doc["params"].to<JsonObject>();
  addFinite(params, "Temperature", payload.temperatureC);
  addFinite(params, "Humidity", payload.humidity);
  addFinite(params, "LightLux", payload.lux);
  params["SmokeRaw"] = payload.mq2Raw;
  params["AirQualityRaw"] = payload.mq135Raw;
  params["CoRaw"] = payload.mq7Raw;
  params["PressureRaw"] = payload.fsrRaw;
  params["VibrationRaw"] = payload.vibrationRaw;
  params["Motion"] = payload.pirMotion ? 1 : 0;
  params["Vibration"] = payload.vibration ? 1 : 0;
  params["Sos"] = payload.sos ? 1 : 0;
  params["FallDetected"] = payload.fallDetected ? 1 : 0;
  params["Dark"] = payload.dark ? 1 : 0;
  params["BedOccupied"] = payload.bedOccupied ? 1 : 0;
  params["NightWakeActive"] = payload.nightWakeActive ? 1 : 0;
  params["NightActivity"] = payload.nightActivity ? 1 : 0;
  params["Alarm"] = payload.alarmAny ? 1 : 0;
  params["PushRequired"] = payload.pushRequired ? 1 : 0;
  params["FanOn"] = payload.fanOn ? 1 : 0;
  params["LedOn"] = payload.ledOn ? 1 : 0;
  params["DarkLightOn"] = payload.darkLightOn ? 1 : 0;
  params["NightLightOn"] = payload.nightLightOn ? 1 : 0;
  params["NightWakeLightOn"] = payload.nightWakeLightOn ? 1 : 0;
  params["AlarmLightOn"] = payload.alarmLightOn ? 1 : 0;
  params["DangerLevel"] = payload.dangerLevel;
  params["AlarmText"] = payload.alarmText;

  String output;
  serializeJson(doc, output);
  return output;
}

String buildMirrorPayload(const TelemetryPayload& payload) {
  JsonDocument doc;
  doc["deviceName"] = CloudConfig::ALIYUN_DEVICE_NAME;
  doc["productKey"] = CloudConfig::ALIYUN_PRODUCT_KEY;
  setFinite(doc, "temperatureC", payload.temperatureC);
  setFinite(doc, "humidity", payload.humidity);
  setFinite(doc, "lux", payload.lux);
  doc["mq2Raw"] = payload.mq2Raw;
  doc["mq135Raw"] = payload.mq135Raw;
  doc["mq7Raw"] = payload.mq7Raw;
  doc["fsrRaw"] = payload.fsrRaw;
  doc["vibrationRaw"] = payload.vibrationRaw;
  doc["pirMotion"] = payload.pirMotion;
  doc["vibration"] = payload.vibration;
  doc["sos"] = payload.sos;
  doc["fallDetected"] = payload.fallDetected;
  doc["dark"] = payload.dark;
  doc["bedOccupied"] = payload.bedOccupied;
  doc["nightWakeActive"] = payload.nightWakeActive;
  doc["nightActivity"] = payload.nightActivity;
  doc["alarmAny"] = payload.alarmAny;
  doc["pushRequired"] = payload.pushRequired;
  doc["fanOn"] = payload.fanOn;
  doc["ledOn"] = payload.ledOn;
  doc["darkLightOn"] = payload.darkLightOn;
  doc["nightLightOn"] = payload.nightLightOn;
  doc["nightWakeLightOn"] = payload.nightWakeLightOn;
  doc["alarmLightOn"] = payload.alarmLightOn;
  doc["dangerLevel"] = payload.dangerLevel;
  doc["alarmText"] = payload.alarmText;
  doc["uptimeMs"] = millis();

  JsonObject controls = doc["controls"].to<JsonObject>();
  controls["enableDht22"] = deviceControl.enableDht22;
  controls["enableBh1750"] = deviceControl.enableBh1750;
  controls["enableMq135"] = deviceControl.enableMq135;
  controls["enableMq2"] = deviceControl.enableMq2;
  controls["enableMq7"] = deviceControl.enableMq7;
  controls["enableFsr"] = deviceControl.enableFsr;
  controls["enablePir"] = deviceControl.enablePir;
  controls["enableSw420"] = deviceControl.enableSw420;
  controls["enableSos"] = deviceControl.enableSos;

  JsonObject thresholds = doc["thresholds"].to<JsonObject>();
  setThreshold(thresholds, "mq135Warn", deviceControl.mq135Warn);
  setThreshold(thresholds, "mq135Danger", deviceControl.mq135Danger);
  setThreshold(thresholds, "mq2Warn", deviceControl.mq2Warn);
  setThreshold(thresholds, "mq2Danger", deviceControl.mq2Danger);
  setThreshold(thresholds, "mq7Warn", deviceControl.mq7Warn);
  setThreshold(thresholds, "mq7Danger", deviceControl.mq7Danger);
  setThreshold(thresholds, "earthquakeWarn", deviceControl.earthquakeWarn);
  setThreshold(thresholds, "tempHigh", deviceControl.tempHigh);
  setThreshold(thresholds, "tempLow", deviceControl.tempLow);
  setThreshold(thresholds, "humidityHigh", deviceControl.humidityHigh);
  setThreshold(thresholds, "humidityLow", deviceControl.humidityLow);
  setThreshold(thresholds, "luxDark", deviceControl.luxDark);
  setThreshold(thresholds, "bedPresenceRaw", deviceControl.bedPresenceRaw);
  setThreshold(thresholds, "fsrPressure", deviceControl.fsrPressure);

  String output;
  serializeJson(doc, output);
  return output;
}

void connectWifi() {
  if (!CloudConfig::ENABLE_WIFI || WiFi.status() == WL_CONNECTED || wifiStarted) {
    return;
  }

  wifiStarted = true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(CloudConfig::WIFI_SSID, CloudConfig::WIFI_PASSWORD);

  const uint32_t startMs = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startMs < CloudConfig::WIFI_CONNECT_TIMEOUT_MS) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("WiFi connected, IP="));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("WiFi connect timeout."));
    wifiStarted = false;
  }
}

void reconnectMqtt() {
  if (!CloudConfig::ENABLE_ALIYUN_MQTT || WiFi.status() != WL_CONNECTED ||
      mqttClient.connected()) {
    return;
  }

  const uint32_t now = millis();
  if (now - lastMqttReconnectMs < CloudConfig::MQTT_RECONNECT_INTERVAL_MS) {
    return;
  }
  lastMqttReconnectMs = now;

  const String timestamp = String(millis());
  const String clientId = mqttClientId(timestamp);
  const String username = mqttUsername();
  const String password = mqttPassword(timestamp);

  Serial.print(F("Connecting Aliyun MQTT... "));
  if (mqttClient.connect(clientId.c_str(), username.c_str(), password.c_str())) {
    Serial.println(F("OK"));
  } else {
    Serial.print(F("failed, state="));
    Serial.println(mqttClient.state());
  }
}

void postMirror(const String& payload) {
  if (!CloudConfig::ENABLE_WEB_MIRROR || WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  http.begin(CloudConfig::WEB_MIRROR_URL);
  http.setTimeout(CloudConfig::WEB_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", CloudConfig::WEB_MIRROR_TOKEN);
  const int code = http.POST(payload);
  Serial.print(F("Web mirror HTTP="));
  Serial.println(code);
  http.end();
}

void applyControlJson(const JsonDocument& doc) {
  deviceControl.enableDht22 = readBoolControl(doc, "enableDht22", deviceControl.enableDht22);
  deviceControl.enableBh1750 = readBoolControl(doc, "enableBh1750", deviceControl.enableBh1750);
  deviceControl.enableMq135 = readBoolControl(doc, "enableMq135", deviceControl.enableMq135);
  deviceControl.enableMq2 = readBoolControl(doc, "enableMq2", deviceControl.enableMq2);
  deviceControl.enableMq7 = readBoolControl(doc, "enableMq7", deviceControl.enableMq7);
  deviceControl.enableFsr = readBoolControl(doc, "enableFsr", deviceControl.enableFsr);
  deviceControl.enablePir = readBoolControl(doc, "enablePir", deviceControl.enablePir);
  deviceControl.enableSw420 = readBoolControl(doc, "enableSw420", deviceControl.enableSw420);
  deviceControl.enableSos = readBoolControl(doc, "enableSos", deviceControl.enableSos);
  deviceControl.darkLight = readBoolControl(doc, "darkLight", deviceControl.darkLight);
  deviceControl.nightLight = readBoolControl(doc, "nightLight", deviceControl.nightLight);
  deviceControl.nightWakeMonitor = readBoolControl(doc, "nightWakeMonitor", deviceControl.nightWakeMonitor);
  deviceControl.nightWakeLight = readBoolControl(doc, "nightWakeLight", deviceControl.nightWakeLight);
  deviceControl.curtainAuto = readBoolControl(doc, "curtainAuto", deviceControl.curtainAuto);
  deviceControl.alarmLight = readBoolControl(doc, "alarmLight", deviceControl.alarmLight);
  deviceControl.fanVentilation = readBoolControl(doc, "fanVentilation", deviceControl.fanVentilation);
  deviceControl.buzzerAlarm = readBoolControl(doc, "buzzerAlarm", deviceControl.buzzerAlarm);
  deviceControl.sosServo = readBoolControl(doc, "sosServo", deviceControl.sosServo);
  deviceControl.noMotionWarning = readBoolControl(doc, "noMotionWarning", deviceControl.noMotionWarning);
  deviceControl.mq135Warn = readRawThreshold(doc, "mq135Warn", deviceControl.mq135Warn);
  deviceControl.mq135Danger = readRawThreshold(doc, "mq135Danger", deviceControl.mq135Danger);
  deviceControl.mq2Warn = readRawThreshold(doc, "mq2Warn", deviceControl.mq2Warn);
  deviceControl.mq2Danger = readRawThreshold(doc, "mq2Danger", deviceControl.mq2Danger);
  deviceControl.mq7Warn = readRawThreshold(doc, "mq7Warn", deviceControl.mq7Warn);
  deviceControl.mq7Danger = readRawThreshold(doc, "mq7Danger", deviceControl.mq7Danger);
  deviceControl.earthquakeWarn = readRawThreshold(doc, "earthquakeWarn", deviceControl.earthquakeWarn);
  deviceControl.tempHigh = readFloatThreshold(doc, "tempHigh", deviceControl.tempHigh, -20.0F, 80.0F);
  deviceControl.tempLow = readFloatThreshold(doc, "tempLow", deviceControl.tempLow, -20.0F, 80.0F);
  deviceControl.humidityHigh = readFloatThreshold(doc, "humidityHigh", deviceControl.humidityHigh, 0.0F, 100.0F);
  deviceControl.humidityLow = readFloatThreshold(doc, "humidityLow", deviceControl.humidityLow, 0.0F, 100.0F);
  deviceControl.luxDark = readFloatThreshold(doc, "luxDark", deviceControl.luxDark, 0.0F, 2000.0F);
  deviceControl.bedPresenceRaw = readRawThreshold(doc, "bedPresenceRaw", deviceControl.bedPresenceRaw);
  deviceControl.fsrPressure = readRawThreshold(doc, "fsrPressure", deviceControl.fsrPressure);
  normalizeControlThresholds();
  deviceControl.updatedAtMs = millis();
  deviceControl.valid = true;
}
}  // namespace

namespace AliyunClient {
void begin() {
  if (!CloudConfig::ENABLE_WIFI) {
    return;
  }

  connectWifi();
  secureClient.setInsecure();
  mqttClient.setServer(mqttHost().c_str(), CloudConfig::MQTT_PORT);
  mqttClient.setBufferSize(1024);
}

void loop() {
  if (!CloudConfig::ENABLE_WIFI) {
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    wifiStarted = false;
    connectWifi();
  }

  reconnectMqtt();
  mqttClient.loop();
  pullControlState();
}

bool publishTelemetry(const TelemetryPayload& payload) {
  if (!CloudConfig::ENABLE_WIFI) {
    return false;
  }

  const String mirrorPayload = buildMirrorPayload(payload);
  postMirror(mirrorPayload);

  if (!CloudConfig::ENABLE_ALIYUN_MQTT || !mqttClient.connected()) {
    return false;
  }

  const String alinkPayload = buildAlinkPayload(payload);
  const bool ok = mqttClient.publish(propertyPostTopic().c_str(), alinkPayload.c_str());
  Serial.print(F("Aliyun publish="));
  Serial.println(ok ? F("OK") : F("FAIL"));
  return ok;
}

bool pullControlState() {
  if (!CloudConfig::ENABLE_WEB_MIRROR || WiFi.status() != WL_CONNECTED) {
    return false;
  }

  const uint32_t now = millis();
  if (now - lastControlPullMs < CloudConfig::WEB_CONTROL_PULL_INTERVAL_MS) {
    return false;
  }
  lastControlPullMs = now;

  HTTPClient http;
  http.begin(CloudConfig::WEB_CONTROL_URL);
  http.setTimeout(CloudConfig::WEB_HTTP_TIMEOUT_MS);
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.print(F("Control pull HTTP="));
    Serial.println(code);
    http.end();
    return false;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, http.getStream());
  http.end();
  if (error) {
    Serial.print(F("Control JSON error="));
    Serial.println(error.c_str());
    return false;
  }

  applyControlJson(doc);
  Serial.println(F("Control state updated."));
  return true;
}

const DeviceControlState& controlState() {
  return deviceControl;
}

bool isWifiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool isMqttConnected() {
  return mqttClient.connected();
}
}  // namespace AliyunClient
