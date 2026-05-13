#pragma once

#include <Arduino.h>

namespace Timing {
constexpr uint32_t SENSOR_INTERVAL_MS = 2000;
constexpr uint32_t DISPLAY_INTERVAL_MS = 500;
constexpr uint32_t DISPLAY_PAGE_INTERVAL_MS = 2200;
constexpr uint32_t SERIAL_INTERVAL_MS = 3000;
constexpr uint32_t NO_MOTION_WARNING_MS = 30UL * 60UL * 1000UL;
constexpr uint32_t FALL_NO_MOTION_MS = 60UL * 1000UL;
constexpr uint32_t FALL_VIBRATION_WINDOW_MS = 90UL * 1000UL;
constexpr uint32_t ALERT_BEEP_INTERVAL_MS = 350;
constexpr uint32_t WARNING_BEEP_INTERVAL_MS = 650;
constexpr uint32_t CRITICAL_BLINK_INTERVAL_MS = 220;
constexpr uint32_t NIGHT_LIGHT_HOLD_MS = 90UL * 1000UL;
}  // namespace Timing
