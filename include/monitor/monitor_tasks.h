// 任务调度接口：声明主循环中按周期执行的快速状态、传感器、显示、串口和云端任务。
#pragma once

#include <Arduino.h>

namespace Monitor {
void updateFastState();
void runSensorTask(uint32_t now);
void runDisplayTask(uint32_t now);
void runSerialTask(uint32_t now);
void runCloudPublishTask(uint32_t now);
}  // namespace Monitor
