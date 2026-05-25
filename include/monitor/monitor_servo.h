// 舵机驱动接口：封装窗帘与 SOS 动作的非阻塞舵机控制流程。
#pragma once

#include <Arduino.h>

namespace Monitor {
namespace ServoDrive {
enum class Command : uint8_t {
  Idle = 0,
  CurtainOpen,
  CurtainClose,
  Sos
};

void setupPin();
void begin();
void driveCurtain(bool enabled, bool dark);
void driveSos(bool enabled, bool active);
void updateStandby();
bool isActive();
}  // namespace ServoDrive
}  // namespace Monitor
