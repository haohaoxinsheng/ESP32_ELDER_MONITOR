#pragma once

#include <Arduino.h>

#include "config.h"

struct TelemetryPayload {
  float temperatureC = NAN;
  float humidity = NAN;
  float lux = NAN;
  uint16_t mq2Raw = 0;
  uint16_t mq135Raw = 0;
  uint16_t mq7Raw = 0;
  uint16_t fsrRaw = 0;
  uint16_t vibrationRaw = 0;
  bool pirMotion = false;
  bool vibration = false;
  bool sos = false;
  bool fallDetected = false;
  bool dark = false;
  bool bedOccupied = false;
  bool nightWakeActive = false;
  bool nightActivity = false;
  bool alarmAny = false;
  bool pushRequired = false;
  bool fanOn = false;
  bool ledOn = false;
  bool darkLightOn = false;
  bool nightLightOn = false;
  bool nightWakeLightOn = false;
  bool alarmLightOn = false;
  const char* dangerLevel = "normal";
  const char* alarmText = "NORMAL";
};

struct DeviceControlState {
  bool enableDht22 = true;
  bool enableBh1750 = true;
  bool enableMq135 = true;
  bool enableMq2 = true;
  bool enableMq7 = true;
  bool enableFsr = true;
  bool enablePir = true;
  bool enableSw420 = true;
  bool enableSos = true;
  bool darkLight = true;
  bool nightLight = true;
  bool nightWakeMonitor = true;
  bool nightWakeLight = true;
  bool curtainAuto = true;
  bool alarmLight = true;
  bool fanVentilation = true;
  bool buzzerAlarm = true;
  bool sosServo = true;
  bool noMotionWarning = true;
  uint16_t mq135Warn = 2300;
  uint16_t mq135Danger = 2800;
  uint16_t mq2Warn = 1900;
  uint16_t mq2Danger = 2400;
  uint16_t mq7Warn = 1900;
  uint16_t mq7Danger = 2100;
  uint16_t earthquakeWarn = 2600;
  float tempHigh = 32.0F;
  float tempLow = 10.0F;
  float humidityHigh = 80.0F;
  float humidityLow = 25.0F;
  float luxDark = 60.0F;
  uint16_t bedPresenceRaw = 1200;
  uint16_t fsrPressure = 2300;
  uint16_t noMotionMinutes = Timing::NO_MOTION_WARNING_MINUTES;
  uint32_t updatedAtMs = 0;
  bool valid = false;
};
