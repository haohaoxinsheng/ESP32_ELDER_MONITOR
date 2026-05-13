#pragma once

#include <Arduino.h>

namespace Monitor {
void updateFastState();
void runSensorTask(uint32_t now);
void runDisplayTask(uint32_t now);
void runSerialTask(uint32_t now);
void runCloudPublishTask(uint32_t now);
}  // namespace Monitor
