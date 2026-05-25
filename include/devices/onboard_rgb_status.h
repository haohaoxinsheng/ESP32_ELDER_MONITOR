// 板载 RGB 状态灯工具：在上传、启动和运行阶段提供简单状态反馈。
#pragma once

#include <Arduino.h>

namespace OnboardRgbStatus {
constexpr bool ENABLED = true;
constexpr uint8_t PIN = 48;
constexpr uint8_t BLUE_R = 0;
constexpr uint8_t BLUE_G = 0;
constexpr uint8_t BLUE_B = 64;
constexpr uint8_t PINK_R = 64;
constexpr uint8_t PINK_G = 0;
constexpr uint8_t PINK_B = 32;
constexpr uint32_t SUCCESS_BLINK_MS = 3000;
constexpr uint32_t SUCCESS_BLINK_INTERVAL_MS = 200;

inline void setColor(uint8_t red, uint8_t green, uint8_t blue) {
  if (!ENABLED) return;
  neopixelWrite(PIN, red, green, blue);
}

inline void off() {
  setColor(0, 0, 0);
}

inline void showUploadStarting() {
  setColor(BLUE_R, BLUE_G, BLUE_B);
}

inline void showUploadSuccess() {
  if (!ENABLED) return;

  const uint32_t startedMs = millis();
  bool ledOn = false;
  while (millis() - startedMs < SUCCESS_BLINK_MS) {
    ledOn = !ledOn;
    if (ledOn) {
      setColor(PINK_R, PINK_G, PINK_B);
    } else {
      off();
    }
    delay(SUCCESS_BLINK_INTERVAL_MS);
  }
  off();
}
}  // namespace OnboardRgbStatus
