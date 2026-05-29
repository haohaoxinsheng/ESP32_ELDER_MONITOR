// 硬件初始化实现：配置 GPIO、ADC、I2C 设备、蜂鸣器、灯光、舵机和 SOS 按键。
#include "monitor/monitor_hardware.h"

#include <Wire.h>

#include "devices/actuator_config.h"
#include "devices/bh1750_config.h"
#include "devices/dht22_config.h"
#include "devices/fsr402_config.h"
#include "devices/mq2_config.h"
#include "devices/mq135_config.h"
#include "devices/mq7_config.h"
#include "devices/oled_config.h"
#include "devices/pir_config.h"
#include "devices/sos_button_config.h"
#include "devices/sw420_config.h"
#include "monitor/monitor_servo.h"
#include "monitor/monitor_state.h"

namespace Monitor {
// 统一设置蜂鸣器输出，兼容有源蜂鸣器和无源蜂鸣器两种接法。
void setBuzzer(bool on) {
  buzzerOn = on;
  if (ActuatorConfig::BUZZER_IS_ACTIVE) {
    const uint8_t activeLevel = ActuatorConfig::BUZZER_ACTIVE_HIGH ? HIGH : LOW;
    const uint8_t inactiveLevel = ActuatorConfig::BUZZER_ACTIVE_HIGH ? LOW : HIGH;
    digitalWrite(ActuatorConfig::BUZZER_PIN, on ? activeLevel : inactiveLevel);
    return;
  }

  if (on) {
    tone(ActuatorConfig::BUZZER_PIN, ActuatorConfig::PASSIVE_BUZZER_FREQUENCY_HZ);
  } else {
    noTone(ActuatorConfig::BUZZER_PIN);
  }
}

// 统一设置风扇继电器，兼容高电平触发和低电平触发模块。
void setFanRelay(bool on) {
  const uint8_t activeLevel = ActuatorConfig::FAN_RELAY_ACTIVE_HIGH ? HIGH : LOW;
  const uint8_t inactiveLevel = ActuatorConfig::FAN_RELAY_ACTIVE_HIGH ? LOW : HIGH;
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, on ? activeLevel : inactiveLevel);
}

// 统一设置外接 LED 灯，极性由 ActuatorConfig::LED_LIGHT_ACTIVE_HIGH 决定。
void setLedLight(bool on) {
  const uint8_t activeLevel = ActuatorConfig::LED_LIGHT_ACTIVE_HIGH ? HIGH : LOW;
  const uint8_t inactiveLevel = ActuatorConfig::LED_LIGHT_ACTIVE_HIGH ? LOW : HIGH;
  digitalWrite(ActuatorConfig::LED_LIGHT_PIN, on ? activeLevel : inactiveLevel);
}

bool sosRawLevel() {
  return digitalRead(SosButtonConfig::PIN) == HIGH;
}

// SOS 按键消抖读取：按下电平由 SosButtonConfig::ACTIVE_LOW 配置。
bool buttonPressed() {
  const bool reading = sosRawLevel();
  const uint32_t now = millis();

  if (reading != lastSosReading) {
    lastSosChangeMs = now;
    lastSosReading = reading;
  }

  if ((now - lastSosChangeMs) > SosButtonConfig::DEBOUNCE_MS) {
    stableSosState = reading;
  }

  return SosButtonConfig::ACTIVE_LOW ? stableSosState == LOW : stableSosState == HIGH;
}

// 配置所有 GPIO、ADC 分辨率和执行器默认状态。
void setupPins() {
  pinMode(PirConfig::OUT_PIN, INPUT);
  pinMode(Sw420Config::DOUT_PIN, INPUT);
  pinMode(SosButtonConfig::PIN, SosButtonConfig::USE_INTERNAL_PULLUP ? INPUT_PULLUP : INPUT);
  setFanRelay(false);
  pinMode(ActuatorConfig::BUZZER_PIN, OUTPUT);
  pinMode(ActuatorConfig::FAN_RELAY_PIN, OUTPUT);
  pinMode(ActuatorConfig::LED_LIGHT_PIN, OUTPUT);
  ServoDrive::setupPin();

  setBuzzer(false);
  setFanRelay(false);
  setLedLight(false);

  analogReadResolution(12);
  analogSetPinAttenuation(Mq2Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Mq135Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Mq7Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Fsr402Config::AOUT_PIN, ADC_11db);
}

// 初始化 I2C 设备、DHT22、舵机和 OLED 启动画面。
void setupDevices() {
  Wire.begin(OledConfig::SDA_PIN, OledConfig::SCL_PIN);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OledConfig::I2C_ADDR);

  bh1750Wire.begin(Bh1750Config::SDA_PIN, Bh1750Config::SCL_PIN);
  bh1750Ok = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,
                              Bh1750Config::I2C_ADDR,
                              &bh1750Wire);
  dht.begin();

  ServoDrive::begin();

  if (oledOk) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println(F("Elder Monitor"));
    display.println(F("Booting..."));
    display.display();
  }
}
}  // namespace Monitor
