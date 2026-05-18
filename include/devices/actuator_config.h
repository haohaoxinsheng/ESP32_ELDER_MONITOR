#pragma once

#include <Arduino.h>

namespace ActuatorConfig {
constexpr uint8_t BUZZER_PIN = 13;
constexpr uint8_t FAN_RELAY_PIN = 14;
constexpr uint8_t LED_LIGHT_PIN = 15;
constexpr uint8_t SERVO_PWM_PIN = 16;

constexpr bool BUZZER_ACTIVE_HIGH = true;
constexpr bool BUZZER_IS_ACTIVE = true;
constexpr bool LED_LIGHT_ACTIVE_HIGH = false;
constexpr uint16_t PASSIVE_BUZZER_FREQUENCY_HZ = 2000;

constexpr uint8_t SERVO_NORMAL_ANGLE = 10;
constexpr uint8_t SERVO_CURTAIN_OPEN_ANGLE = 180;
constexpr uint8_t SERVO_CURTAIN_CLOSED_ANGLE = 70;
constexpr uint8_t SERVO_SOS_ANGLE = 90;
}  // namespace ActuatorConfig
