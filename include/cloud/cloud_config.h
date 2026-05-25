// 云端连接配置：定义 WiFi、阿里云 IoT、Web 镜像地址、令牌和网络超时参数。
#pragma once

#include <Arduino.h>

#if __has_include("cloud/cloud_secrets.h")
#include "cloud/cloud_secrets.h"
#else
namespace CloudSecrets {
constexpr const char* WIFI_SSID = "YOUR_WIFI_SSID";
constexpr const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

constexpr const char* ALIYUN_PRODUCT_KEY = "YOUR_PRODUCT_KEY";
constexpr const char* ALIYUN_DEVICE_NAME = "YOUR_DEVICE_NAME";
constexpr const char* ALIYUN_DEVICE_SECRET = "YOUR_DEVICE_SECRET";

constexpr const char* WEB_MIRROR_TOKEN = "YOUR_DEVICE_TOKEN";
}  // namespace CloudSecrets
#endif

namespace CloudConfig {
constexpr bool ENABLE_WIFI = true;
constexpr bool ENABLE_ALIYUN_MQTT = false;
constexpr bool ENABLE_WEB_MIRROR = true;

constexpr const char* WIFI_SSID = CloudSecrets::WIFI_SSID;
constexpr const char* WIFI_PASSWORD = CloudSecrets::WIFI_PASSWORD;

constexpr const char* ALIYUN_REGION_ID = "cn-shanghai";
constexpr const char* ALIYUN_PRODUCT_KEY = CloudSecrets::ALIYUN_PRODUCT_KEY;
constexpr const char* ALIYUN_DEVICE_NAME = CloudSecrets::ALIYUN_DEVICE_NAME;
constexpr const char* ALIYUN_DEVICE_SECRET = CloudSecrets::ALIYUN_DEVICE_SECRET;

// 示例：http://192.168.1.10:3001/api/telemetry
constexpr const char* WEB_MIRROR_URL = "http://59.110.166.166/api/telemetry";
constexpr const char* WEB_CONTROL_URL = "http://59.110.166.166/api/control";
constexpr const char* WEB_MIRROR_TOKEN = CloudSecrets::WEB_MIRROR_TOKEN;

constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t MQTT_RECONNECT_INTERVAL_MS = 5000;
constexpr uint32_t CLOUD_PUBLISH_INTERVAL_MS = 500;
constexpr uint32_t WEB_CONTROL_PULL_INTERVAL_MS = 500;
constexpr uint32_t WEB_HTTP_TIMEOUT_MS = 1000;
constexpr uint16_t MQTT_PORT = 8883;
}  // namespace CloudConfig
