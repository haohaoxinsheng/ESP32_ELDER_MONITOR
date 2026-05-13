#pragma once

#include <Arduino.h>

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
  bool nightLight = true;
  bool nightWakeMonitor = true;
  bool nightWakeLight = true;
  bool curtainAuto = true;
  bool alarmLight = true;
  bool fanVentilation = true;
  bool buzzerAlarm = true;
  bool sosServo = true;
  bool noMotionWarning = true;
  uint32_t updatedAtMs = 0;
  bool valid = false;
};
