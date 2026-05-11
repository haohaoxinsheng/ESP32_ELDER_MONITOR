#pragma once

#include <Arduino.h>

namespace OledConfig {
constexpr uint8_t SDA_PIN = 8;
constexpr uint8_t SCL_PIN = 9;
constexpr uint8_t WIDTH = 128;
constexpr uint8_t HEIGHT = 64;
constexpr int8_t RESET_PIN = -1;
constexpr uint8_t I2C_ADDR = 0x3C;
}  // namespace OledConfig
