#pragma once

#include <Arduino.h>

namespace ActuatorConfig {
constexpr uint8_t BUZZER_PIN = 13;
constexpr uint8_t FAN_RELAY_PIN = 14;
constexpr uint8_t LED_LIGHT_PIN = 15;
constexpr uint8_t SERVO_PWM_PIN = 16;

constexpr uint8_t SERVO_NORMAL_ANGLE = 10;
constexpr uint8_t SERVO_SOS_ANGLE = 90;
}  // namespace ActuatorConfig
