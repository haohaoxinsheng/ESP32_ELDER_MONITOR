// 云端客户端接口：声明 WiFi/MQTT/Web 镜像发布、控制拉取和连接状态查询入口。
#pragma once

#include <Arduino.h>

#include "telemetry_payload.h"

namespace AliyunClient {
void begin();
void loop();
bool publishTelemetry(const TelemetryPayload& payload);
bool pullControlState();
const DeviceControlState& controlState();
bool isWifiConnected();
bool isMqttConnected();
}  // namespace AliyunClient
