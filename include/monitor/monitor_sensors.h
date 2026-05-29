// 传感器采集接口：声明环境、气体、压力、人体、振动和 SOS 状态读取与告警推导函数。
#pragma once

#include <Arduino.h>

namespace Monitor {
void readSensors();
void updateSosState();
void updateActivityState();
void updateAlarmState();
}  // namespace Monitor
