// 舵机配置：定义 PWM 引脚、待机/窗帘/SOS 角度和保持时间。
#pragma once

#include <Arduino.h>

namespace ServoConfig {
constexpr uint8_t PWM_PIN = 16;

constexpr uint8_t STANDBY_ANGLE = 90;
constexpr uint8_t CURTAIN_OPEN_ANGLE = 180;
constexpr uint8_t CURTAIN_CLOSED_ANGLE = 0;
constexpr uint8_t SOS_ANGLE = 180;
constexpr uint16_t CURTAIN_HOLD_MS = 900;
constexpr uint16_t SOS_HOLD_MS = 600;
constexpr uint16_t STOP_HOLD_MS = 200;
}  // namespace ServoConfig
