// BH1750 光照传感器配置：定义 I2C 引脚、地址和暗环境阈值。
#pragma once

#include <Arduino.h>

namespace Bh1750Config {
constexpr uint8_t SDA_PIN = 17;
constexpr uint8_t SCL_PIN = 18;
constexpr uint8_t I2C_ADDR = 0x23;
constexpr float NIGHT_ACTIVITY_LUX = 80.0F;
}  // namespace Bh1750Config
