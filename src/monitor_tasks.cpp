// 主循环任务实现：按时间片调度快速状态、传感器读取、OLED、串口和云端发布。
#include "monitor/monitor_tasks.h"

#include "cloud/aliyun_client.h"
#include "cloud/cloud_config.h"
#include "config.h"
#include "monitor/monitor_actuators.h"
#include "monitor/monitor_display.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_sensors.h"
#include "monitor/monitor_state.h"
#include "monitor/monitor_telemetry.h"

namespace Monitor {
// 快速状态任务：每轮循环处理 SOS、云端控制拉取、活动状态和告警状态。
void updateFastState() {
  data.sos = AliyunClient::controlState().enableSos && buttonPressed();
  AliyunClient::loop();
  updateActivityState();
  updateAlarmState();
}

// 传感器周期任务：按采样间隔读取传感器，并立即刷新告警和执行器联动。
void runSensorTask(uint32_t now) {
  if (now - lastSensorReadMs < Timing::SENSOR_INTERVAL_MS) {
    return;
  }

  lastSensorReadMs = now;
  readSensors();
  updateActivityState();
  updateAlarmState();
  updateActuators();
}

// OLED 周期任务：避免屏幕刷新阻塞主循环。
void runDisplayTask(uint32_t now) {
  if (now - lastDisplayMs < Timing::DISPLAY_INTERVAL_MS) {
    return;
  }

  lastDisplayMs = now;
  drawDisplay();
}

// 串口日志周期任务：输出调试数据，便于接开发板时排查传感器和网络状态。
void runSerialTask(uint32_t now) {
  if (now - lastSerialMs < Timing::SERIAL_INTERVAL_MS) {
    return;
  }

  lastSerialMs = now;
  printSerialLog();
}

// 云端发布任务：按配置间隔把当前遥测推送到 Web 镜像和可选的阿里云 MQTT。
void runCloudPublishTask(uint32_t now) {
  if (now - lastCloudPublishMs < CloudConfig::CLOUD_PUBLISH_INTERVAL_MS) {
    return;
  }

  lastCloudPublishMs = now;
  AliyunClient::publishTelemetry(buildTelemetryPayload());
}
}  // namespace Monitor
