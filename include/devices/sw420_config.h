// SW-420 振动传感器配置：定义数字输入引脚和振动告警阈值。
#pragma once

#include <Arduino.h>

namespace Sw420Config {
constexpr uint8_t DOUT_PIN = 11;
}  // namespace Sw420Config
