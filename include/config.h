// 全局时序配置：集中定义传感器采样、显示刷新、串口输出、跌倒判定和告警节奏。
#pragma once

#include <Arduino.h>

namespace Timing {
constexpr uint32_t SENSOR_INTERVAL_MS = 500;
constexpr uint32_t DISPLAY_INTERVAL_MS = 500;
constexpr uint32_t DISPLAY_PAGE_INTERVAL_MS = 2200;
constexpr uint32_t SERIAL_INTERVAL_MS = 1000;
constexpr uint16_t NO_MOTION_WARNING_MINUTES = 30;
constexpr uint32_t FALL_NO_MOTION_MS = 20UL * 1000UL;
constexpr uint32_t FALL_VIBRATION_WINDOW_MS = 90UL * 1000UL;
constexpr uint32_t ALERT_BEEP_INTERVAL_MS = 350;
constexpr uint32_t WARNING_BEEP_INTERVAL_MS = 650;
constexpr uint32_t CRITICAL_BLINK_INTERVAL_MS = 220;
constexpr uint32_t NIGHT_LIGHT_HOLD_MS = 5UL * 1000UL;
constexpr uint32_t SOS_ALARM_HOLD_MS = 4UL * 1000UL;
}  // namespace Timing
