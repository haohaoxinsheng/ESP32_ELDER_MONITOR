// MQ-135 空气质量传感器配置：定义 ADC 引脚和空气质量阈值。
#pragma once

#include <Arduino.h>

namespace Mq135Config {
constexpr uint8_t AOUT_PIN = 4;
constexpr uint16_t WARN_RAW = 2300;
constexpr uint16_t DANGER_RAW = 2800;
}  // namespace Mq135Config
