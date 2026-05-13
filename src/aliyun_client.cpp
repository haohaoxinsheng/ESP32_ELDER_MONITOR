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

String buildAlinkPayload(const TelemetryPayload& payload) {
  JsonDocument doc;
  doc["id"] = String(messageId++);
  doc["version"] = "1.0";
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
  doc["temperatureC"] = isnan(payload.temperatureC) ? 0 : payload.temperatureC;
  doc["humidity"] = isnan(payload.humidity) ? 0 : payload.humidity;
  doc["lux"] = isnan(payload.lux) ? 0 : payload.lux;
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
  doc["dangerLevel"] = payload.dangerLevel;
  doc["alarmText"] = payload.alarmText;
  doc["uptimeMs"] = millis();

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
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", CloudConfig::WEB_MIRROR_TOKEN);
  const int code = http.POST(payload);
  Serial.print(F("Web mirror HTTP="));
  Serial.println(code);
  http.end();
}

void applyControlJson(const JsonDocument& doc) {
  deviceControl.enableDht22 = doc["enableDht22"] | deviceControl.enableDht22;
  deviceControl.enableBh1750 = doc["enableBh1750"] | deviceControl.enableBh1750;
  deviceControl.enableMq135 = doc["enableMq135"] | deviceControl.enableMq135;
  deviceControl.enableMq2 = doc["enableMq2"] | deviceControl.enableMq2;
  deviceControl.enableMq7 = doc["enableMq7"] | deviceControl.enableMq7;
  deviceControl.enableFsr = doc["enableFsr"] | deviceControl.enableFsr;
  deviceControl.enablePir = doc["enablePir"] | deviceControl.enablePir;
  deviceControl.enableSw420 = doc["enableSw420"] | deviceControl.enableSw420;
  deviceControl.enableSos = doc["enableSos"] | deviceControl.enableSos;
  deviceControl.nightLight = doc["nightLight"] | deviceControl.nightLight;
  deviceControl.nightWakeMonitor = doc["nightWakeMonitor"] | deviceControl.nightWakeMonitor;
  deviceControl.nightWakeLight = doc["nightWakeLight"] | deviceControl.nightWakeLight;
  deviceControl.curtainAuto = doc["curtainAuto"] | deviceControl.curtainAuto;
  deviceControl.alarmLight = doc["alarmLight"] | deviceControl.alarmLight;
  deviceControl.fanVentilation = doc["fanVentilation"] | deviceControl.fanVentilation;
  deviceControl.buzzerAlarm = doc["buzzerAlarm"] | deviceControl.buzzerAlarm;
  deviceControl.sosServo = doc["sosServo"] | deviceControl.sosServo;
  deviceControl.noMotionWarning = doc["noMotionWarning"] | deviceControl.noMotionWarning;
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
