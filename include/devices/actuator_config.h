// 执行器引脚配置：定义蜂鸣器、风扇继电器、外接 LED 灯的 GPIO 和有效电平。
#pragma once

#include <Arduino.h>

namespace ActuatorConfig {
constexpr uint8_t BUZZER_PIN = 13;
constexpr uint8_t FAN_RELAY_PIN = 14;
constexpr uint8_t LED_LIGHT_PIN = 15;

constexpr bool BUZZER_ACTIVE_HIGH = true;
constexpr bool BUZZER_IS_ACTIVE = true;
constexpr bool LED_LIGHT_ACTIVE_HIGH = false;
constexpr uint16_t PASSIVE_BUZZER_FREQUENCY_HZ = 2000;
}  // namespace ActuatorConfig
