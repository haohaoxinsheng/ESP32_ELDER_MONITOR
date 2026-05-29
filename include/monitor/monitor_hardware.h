// 硬件初始化接口：声明 GPIO、传感器、蜂鸣器、灯光和 SOS 按键相关基础函数。
#pragma once

#include <Arduino.h>

namespace Monitor {
void setBuzzer(bool on);
void setFanRelay(bool on);
void setLedLight(bool on);
bool sosRawLevel();
bool buttonPressed();
void setupPins();
void setupDevices();
}  // namespace Monitor
