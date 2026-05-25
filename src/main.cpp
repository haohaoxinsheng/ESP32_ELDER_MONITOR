// 固件主入口：完成串口、硬件、云端初始化，并在 loop 中调度监测任务。
#include <Arduino.h>

#include "cloud/aliyun_client.h"
#include "devices/onboard_rgb_status.h"
#include "monitor/monitor_actuators.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_state.h"
#include "monitor/monitor_tasks.h"

// 上电初始化：依次启动串口、状态灯、GPIO/传感器、云端连接，并输出硬件自检结果。
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

// 主循环保持非阻塞：高频刷新状态，其余任务由各自的时间间隔控制执行节奏。
void loop() {
  const uint32_t now = millis();
  Monitor::updateFastState();
  Monitor::runSensorTask(now);
  Monitor::runDisplayTask(now);
  Monitor::runSerialTask(now);
  Monitor::runCloudPublishTask(now);
  Monitor::updateActuators();
}
