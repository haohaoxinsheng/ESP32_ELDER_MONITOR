// MQ-2 烟雾/可燃气体配置：定义 ADC 引脚和预警/危险阈值。
#pragma once

#include <Arduino.h>

namespace Mq2Config {
constexpr uint8_t AOUT_PIN = 3;
constexpr uint16_t WARN_RAW = 1900;
constexpr uint16_t DANGER_RAW = 2400;
}  // namespace Mq2Config
