#pragma once

#include <Arduino.h>

namespace Monitor {
void setBuzzer(bool on);
void setLedLight(bool on);
bool buttonPressed();
void setupPins();
void setupDevices();
}  // namespace Monitor
