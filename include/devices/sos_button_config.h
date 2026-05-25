// SOS 按键配置：定义按键输入引脚和消抖时间。
#pragma once

#include <Arduino.h>

namespace SosButtonConfig {
constexpr uint8_t PIN = 12;
constexpr uint32_t DEBOUNCE_MS = 60;
}  // namespace SosButtonConfig
