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
