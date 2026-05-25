// DHT22 温湿度传感器配置：定义数据引脚、传感器类型和舒适度阈值。
#pragma once

#include <Arduino.h>

namespace Dht22Config {
constexpr uint8_t DATA_PIN = 7;
constexpr uint8_t TYPE = 22;
constexpr float TEMP_HIGH_C = 36.0F;
constexpr float TEMP_LOW_C = 10.0F;
constexpr float HUMIDITY_HIGH_PERCENT = 80.0F;
constexpr float HUMIDITY_LOW_PERCENT = 25.0F;
}  // namespace Dht22Config
