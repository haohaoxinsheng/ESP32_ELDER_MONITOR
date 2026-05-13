#pragma once

#include <Arduino.h>

namespace Monitor {
void readSensors();
void updateActivityState();
void updateAlarmState();
}  // namespace Monitor
