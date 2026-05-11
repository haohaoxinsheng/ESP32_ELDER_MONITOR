#pragma once

#include <Arduino.h>

namespace CloudConfig {
constexpr bool ENABLE_WIFI = false;
constexpr bool ENABLE_ALIYUN_MQTT = false;
constexpr bool ENABLE_WEB_MIRROR = false;

constexpr const char* WIFI_SSID = "YOUR_WIFI_SSID";
constexpr const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

constexpr const char* ALIYUN_REGION_ID = "cn-shanghai";
constexpr const char* ALIYUN_PRODUCT_KEY = "YOUR_PRODUCT_KEY";
constexpr const char* ALIYUN_DEVICE_NAME = "YOUR_DEVICE_NAME";
constexpr const char* ALIYUN_DEVICE_SECRET = "YOUR_DEVICE_SECRET";

// 示例：http://192.168.1.10:3000/api/telemetry
constexpr const char* WEB_MIRROR_URL = "http://YOUR_SERVER_IP:3000/api/telemetry";
constexpr const char* WEB_MIRROR_TOKEN = "change-me";

constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t MQTT_RECONNECT_INTERVAL_MS = 5000;
constexpr uint32_t CLOUD_PUBLISH_INTERVAL_MS = 5000;
constexpr uint16_t MQTT_PORT = 8883;
}  // namespace CloudConfig

