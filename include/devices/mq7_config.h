// MQ-7 一氧化碳传感器配置：定义 ADC 引脚和 CO 预警/危险阈值。
#pragma once

#include <Arduino.h>

namespace Mq7Config {
constexpr uint8_t AOUT_PIN = 5;
constexpr uint16_t WARN_RAW = 1900;
constexpr uint16_t DANGER_RAW = 2100;
}  // namespace Mq7Config
