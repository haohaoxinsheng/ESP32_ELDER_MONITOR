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
void updateFastState() {
  data.sos = AliyunClient::controlState().enableSos && buttonPressed();
  AliyunClient::loop();
  updateActivityState();
  updateAlarmState();
}

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

void runDisplayTask(uint32_t now) {
  if (now - lastDisplayMs < Timing::DISPLAY_INTERVAL_MS) {
    return;
  }

  lastDisplayMs = now;
  drawDisplay();
}

void runSerialTask(uint32_t now) {
  if (now - lastSerialMs < Timing::SERIAL_INTERVAL_MS) {
    return;
  }

  lastSerialMs = now;
  printSerialLog();
}

void runCloudPublishTask(uint32_t now) {
  if (now - lastCloudPublishMs < CloudConfig::CLOUD_PUBLISH_INTERVAL_MS) {
    return;
  }

  lastCloudPublishMs = now;
  AliyunClient::publishTelemetry(buildTelemetryPayload());
}
}  // namespace Monitor
