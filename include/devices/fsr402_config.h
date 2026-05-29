// FSR402 压力传感器配置：定义 ADC 引脚、床位占用和压力告警阈值。
#pragma once

#include <Arduino.h>

namespace Fsr402Config {
constexpr uint8_t AOUT_PIN = 6;
constexpr uint16_t BED_OCCUPIED_RAW = 1200;
constexpr uint16_t PRESS_WARN_RAW = 2300;
constexpr uint16_t PRESS_CLEAR_MARGIN_RAW = 180;
constexpr uint32_t PRESS_ALARM_HOLD_MS = 1500;
}  // namespace Fsr402Config
