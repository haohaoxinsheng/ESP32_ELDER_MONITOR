// 固件应用层实现：集中管理启动流程和非阻塞主循环调度。
#include "monitor/monitor_app.h"

#include <Arduino.h>

#include "cloud/aliyun_client.h"
#include "devices/onboard_rgb_status.h"
#include "monitor/monitor_actuators.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_state.h"
#include "monitor/monitor_tasks.h"

namespace Monitor {
// 上电初始化：依次启动串口、状态灯、GPIO/传感器、云端连接，并输出硬件自检结果。
void begin() {
  Serial.begin(115200);
  delay(200);

  OnboardRgbStatus::showUploadStarting();
  setupPins();
  setupDevices();
  AliyunClient::begin();
  OnboardRgbStatus::showUploadSuccess();

  lastMotionMs = millis();
  Serial.println(F("ESP32 elder monitor started."));
  Serial.print(F("OLED="));
  Serial.print(oledOk ? F("OK") : F("FAIL"));
  Serial.print(F(", BH1750="));
  Serial.println(bh1750Ok ? F("OK") : F("FAIL"));
}

// 主循环保持非阻塞：高频刷新状态，其余任务由各自的时间间隔控制执行节奏。
void run() {
  const uint32_t now = millis();
  updateFastState();
  runSensorTask(now);
  runDisplayTask(now);
  runSerialTask(now);
  runCloudPublishTask(now);
  updateActuators();
}
}  // namespace Monitor
