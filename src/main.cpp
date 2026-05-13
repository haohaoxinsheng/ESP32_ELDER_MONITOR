#include <Arduino.h>

#include "cloud/aliyun_client.h"
#include "devices/onboard_rgb_status.h"
#include "monitor/monitor_actuators.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_state.h"
#include "monitor/monitor_tasks.h"

void setup() {
  Serial.begin(115200);
  delay(200);

  OnboardRgbStatus::showUploadStarting();
  Monitor::setupPins();
  Monitor::setupDevices();
  AliyunClient::begin();
  OnboardRgbStatus::showUploadSuccess();

  Monitor::lastMotionMs = millis();
  Serial.println(F("ESP32 elder monitor started."));
  Serial.print(F("OLED="));
  Serial.print(Monitor::oledOk ? F("OK") : F("FAIL"));
  Serial.print(F(", BH1750="));
  Serial.println(Monitor::bh1750Ok ? F("OK") : F("FAIL"));
}

void loop() {
  const uint32_t now = millis();
  Monitor::updateFastState();
  Monitor::runSensorTask(now);
  Monitor::runDisplayTask(now);
  Monitor::runSerialTask(now);
  Monitor::runCloudPublishTask(now);
  Monitor::updateActuators();
}
