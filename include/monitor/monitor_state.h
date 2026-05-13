#pragma once

#include <Arduino.h>
#include <Adafruit_SSD1306.h>
#include <BH1750.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <Wire.h>

#include "telemetry_payload.h"

namespace Monitor {
struct SensorData {
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
};

struct AlarmState {
  bool airWarning = false;
  bool airDanger = false;
  bool smokeWarning = false;
  bool smokeDanger = false;
  bool coWarning = false;
  bool coDanger = false;
  bool tempHumidity = false;
  bool tempLow = false;
  bool humidityLow = false;
  bool pressure = false;
  bool vibration = false;
  bool noMotion = false;
  bool fallDetected = false;
  bool sos = false;
  bool any = false;
  bool critical = false;
  bool pushRequired = false;
};

struct ActivityState {
  bool dark = false;
  bool nightActivity = false;
};

extern Adafruit_SSD1306 display;
extern BH1750 lightMeter;
extern TwoWire bh1750Wire;
extern DHT dht;
extern Servo servo;

extern SensorData data;
extern AlarmState alarmState;
extern ActivityState activityState;

extern uint32_t lastSensorReadMs;
extern uint32_t lastDisplayMs;
extern uint32_t lastSerialMs;
extern uint32_t lastMotionMs;
extern uint32_t lastNightActivityMs;
extern uint32_t lastVibrationMs;
extern uint32_t lastBeepToggleMs;
extern uint32_t lastLedBlinkMs;
extern uint32_t lastSosChangeMs;
extern uint32_t lastCloudPublishMs;

extern bool buzzerOn;
extern bool lastAlarmAny;
extern bool ledBlinkOn;
extern bool lastSosReading;
extern bool stableSosState;
extern bool nightActivitySeen;

extern bool oledOk;
extern bool bh1750Ok;
extern bool fanOn;
extern bool ledOn;
extern bool darkLightOn;
extern bool nightLightOn;
extern bool nightWakeLightOn;
extern bool alarmLightOn;

bool isBedOccupied(const DeviceControlState& controls);
bool isVentilationNeeded();
const char* primaryAlarmText();
const char* dangerLevelText();
}  // namespace Monitor
