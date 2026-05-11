#pragma once

#include <Arduino.h>

struct TelemetryPayload {
  float temperatureC = NAN;
  float humidity = NAN;
  float lux = NAN;
  uint16_t mq135Raw = 0;
  uint16_t mq7Raw = 0;
  uint16_t fsrRaw = 0;
  bool pirMotion = false;
  bool vibration = false;
  bool sos = false;
  bool fallDetected = false;
  bool dark = false;
  bool nightActivity = false;
  bool alarmAny = false;
  bool pushRequired = false;
  bool fanOn = false;
  bool ledOn = false;
  const char* dangerLevel = "normal";
  const char* alarmText = "NORMAL";
};
