#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <BH1750.h>
#include <DHT.h>
#include <ESP32Servo.h>

#include "config.h"
#include "cloud/aliyun_client.h"
#include "cloud/cloud_config.h"
#include "devices/actuator_config.h"
#include "devices/bh1750_config.h"
#include "devices/dht22_config.h"
#include "devices/fsr402_config.h"
#include "devices/mq2_config.h"
#include "devices/mq135_config.h"
#include "devices/mq7_config.h"
#include "devices/oled_config.h"
#include "devices/onboard_rgb_status.h"
#include "devices/pir_config.h"
#include "devices/sos_button_config.h"
#include "devices/sw420_config.h"
#include "telemetry_payload.h"

// 全局静态对象：OLED 显示、光照传感器、温湿度传感器、舵机
namespace {
Adafruit_SSD1306 display(OledConfig::WIDTH, OledConfig::HEIGHT, &Wire, OledConfig::RESET_PIN);
BH1750 lightMeter;
TwoWire bh1750Wire(1);
DHT dht(Dht22Config::DATA_PIN, Dht22Config::TYPE);
Servo servo;

// 传感器数据结构：保存当前读取到的环境与状态信息
struct SensorData {
  float temperatureC = NAN;
  float humidity = NAN;
  float lux = NAN;
  uint16_t mq2Raw = 0;
  uint16_t mq135Raw = 0;
  uint16_t mq7Raw = 0;
  uint16_t fsrRaw = 0;
  uint16_t vibrationRaw = 0;
  bool pirMotion = false;
  bool vibration = false;
  bool sos = false;
};

// 警报状态结构：根据传感器数据判断各种告警与危险等级
struct AlarmState {
  bool airWarning = false;
  bool airDanger = false;
  bool smokeWarning = false;
  bool smokeDanger = false;
  bool coWarning = false;
  bool coDanger = false;
  bool tempHumidity = false;
  bool tempLow = false;
  bool humidityLow = false;
  bool pressure = false;
  bool vibration = false;
  bool noMotion = false;
  bool fallDetected = false;
  bool sos = false;
  bool any = false;
  bool critical = false;
  bool pushRequired = false;
};

// 活动状态结构：用于检测是否处于夜间活动状态
struct ActivityState {
  bool dark = false;
  bool nightActivity = false;
};

SensorData data;
AlarmState alarmState;
ActivityState activityState;

uint32_t lastSensorReadMs = 0;
uint32_t lastDisplayMs = 0;
uint32_t lastSerialMs = 0;
uint32_t lastMotionMs = 0;
uint32_t lastNightActivityMs = 0;
uint32_t lastVibrationMs = 0;
uint32_t lastBeepToggleMs = 0;
uint32_t lastLedBlinkMs = 0;
bool buzzerOn = false;
bool lastAlarmAny = false;
bool ledBlinkOn = false;
bool lastSosReading = HIGH;
bool stableSosState = HIGH;
uint32_t lastSosChangeMs = 0;
uint32_t lastCloudPublishMs = 0;

bool oledOk = false;
bool bh1750Ok = false;
bool fanOn = false;
bool ledOn = false;

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

// SOS 按键去抖：读取按键状态并保证稳定后返回按下状态
bool buttonPressed() {
  const bool reading = digitalRead(SosButtonConfig::PIN);
  const uint32_t now = millis();

  if (reading != lastSosReading) {
    lastSosChangeMs = now;
    lastSosReading = reading;
  }

  if ((now - lastSosChangeMs) > SosButtonConfig::DEBOUNCE_MS) {
    stableSosState = reading;
  }

  return stableSosState == LOW;
}

// 读取全部传感器值并保存到数据结构中
void readSensors() {
  const DeviceControlState& controls = AliyunClient::controlState();
  data.temperatureC = controls.enableDht22 ? dht.readTemperature() : NAN;
  data.humidity = controls.enableDht22 ? dht.readHumidity() : NAN;
  data.lux = controls.enableBh1750 && bh1750Ok ? lightMeter.readLightLevel() : NAN;
  if (data.lux < 0) {
    data.lux = NAN;
  }
  data.mq2Raw = controls.enableMq2 ? analogRead(Mq2Config::AOUT_PIN) : 0;
  data.mq135Raw = controls.enableMq135 ? analogRead(Mq135Config::AOUT_PIN) : 0;
  data.mq7Raw = controls.enableMq7 ? analogRead(Mq7Config::AOUT_PIN) : 0;
  data.fsrRaw = controls.enableFsr ? analogRead(Fsr402Config::AOUT_PIN) : 0;
  data.pirMotion = controls.enablePir && digitalRead(PirConfig::OUT_PIN) == HIGH;
  data.vibration = controls.enableSw420 && digitalRead(Sw420Config::DOUT_PIN) == HIGH;
  data.vibrationRaw = data.vibration ? 4095 : 0;
  data.sos = controls.enableSos && buttonPressed();

  if (data.pirMotion) {
    lastMotionMs = millis();
  }

  if (data.vibration) {
    lastVibrationMs = millis();
  }
}

// 更新夜间活动状态：若光照暗且有人移动，则保持夜间活动标记
void updateActivityState() {
  const uint32_t now = millis();
  const DeviceControlState& controls = AliyunClient::controlState();
  activityState.dark = controls.enableBh1750 && !isnan(data.lux) && data.lux <= Bh1750Config::NIGHT_ACTIVITY_LUX;

  if (controls.enablePir && activityState.dark && data.pirMotion) {
    lastNightActivityMs = now;
  }

  activityState.nightActivity =
      activityState.dark && (now - lastNightActivityMs <= Timing::NIGHT_LIGHT_HOLD_MS);
}

void updateAlarmState() {
  const uint32_t now = millis();
  const DeviceControlState& controls = AliyunClient::controlState();
  alarmState.airWarning = controls.enableMq135 && data.mq135Raw >= Mq135Config::WARN_RAW;
  alarmState.airDanger = controls.enableMq135 && data.mq135Raw >= Mq135Config::DANGER_RAW;
  alarmState.smokeWarning = controls.enableMq2 && data.mq2Raw >= Mq2Config::WARN_RAW;
  alarmState.smokeDanger = controls.enableMq2 && data.mq2Raw >= Mq2Config::DANGER_RAW;
  alarmState.coWarning = controls.enableMq7 && data.mq7Raw >= Mq7Config::WARN_RAW;
  alarmState.coDanger = controls.enableMq7 && data.mq7Raw >= Mq7Config::DANGER_RAW;
  alarmState.tempHumidity =
      controls.enableDht22 &&
      ((!isnan(data.temperatureC) && data.temperatureC >= Dht22Config::TEMP_HIGH_C) ||
       (!isnan(data.humidity) && data.humidity >= Dht22Config::HUMIDITY_HIGH_PERCENT));
  alarmState.tempLow = controls.enableDht22 && !isnan(data.temperatureC) && data.temperatureC <= Dht22Config::TEMP_LOW_C;
  alarmState.humidityLow = controls.enableDht22 && !isnan(data.humidity) && data.humidity <= Dht22Config::HUMIDITY_LOW_PERCENT;
  alarmState.pressure = controls.enableFsr && data.fsrRaw >= Fsr402Config::PRESS_WARN_RAW;
  alarmState.vibration = controls.enableSw420 && data.vibration;
  alarmState.noMotion = controls.noMotionWarning && (now - lastMotionMs) >= Timing::NO_MOTION_WARNING_MS;
  alarmState.fallDetected =
      alarmState.pressure &&
      (now - lastVibrationMs <= Timing::FALL_VIBRATION_WINDOW_MS) &&
      (now - lastMotionMs >= Timing::FALL_NO_MOTION_MS);
  // 只有在检测到压力、振动和长时间无运动时才判定为跌倒
  alarmState.sos = controls.enableSos && data.sos;
  alarmState.critical = alarmState.coDanger || alarmState.fallDetected || alarmState.sos;
  alarmState.pushRequired = alarmState.critical || alarmState.airDanger || alarmState.smokeDanger || alarmState.noMotion;
  alarmState.any = alarmState.airWarning || alarmState.airDanger ||
                   alarmState.smokeWarning || alarmState.smokeDanger ||
                   alarmState.coWarning || alarmState.coDanger || alarmState.tempHumidity ||
                   alarmState.tempLow || alarmState.humidityLow ||
                   alarmState.pressure || alarmState.vibration ||
                   alarmState.noMotion || alarmState.fallDetected || alarmState.sos;
}

// 控制执行器：风扇、指示灯、蜂鸣器、舵机根据当前警报状态和活动状态动作
void updateActuators() {
  const DeviceControlState& controls = AliyunClient::controlState();
  const bool needVentilation =
      alarmState.airDanger || alarmState.smokeWarning || alarmState.coWarning || alarmState.tempHumidity;
  fanOn = needVentilation && controls.fanVentilation;
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, fanOn ? HIGH : LOW);

  const bool bedOccupied = controls.enableFsr && data.fsrRaw >= Fsr402Config::BED_OCCUPIED_RAW;
  const bool nightWakeLight = controls.nightWakeLight && controls.enablePir && activityState.dark && !bedOccupied && data.pirMotion;
  const bool autoLight = (controls.nightLight && activityState.nightActivity) || nightWakeLight;
  const bool alarmLight = controls.alarmLight && alarmState.any;
  ledOn = autoLight || alarmLight;
  if (alarmState.critical && controls.alarmLight) {
    const uint32_t now = millis();
    if (now - lastLedBlinkMs >= Timing::CRITICAL_BLINK_INTERVAL_MS) {
      lastLedBlinkMs = now;
      ledBlinkOn = !ledBlinkOn;
    }
    digitalWrite(ActuatorConfig::LED_LIGHT_PIN, ledBlinkOn ? HIGH : LOW);
  } else {
    digitalWrite(ActuatorConfig::LED_LIGHT_PIN, ledOn ? HIGH : LOW);
  }

  if (alarmState.sos && controls.sosServo) {
    servo.write(ActuatorConfig::SERVO_SOS_ANGLE);
  } else if (activityState.dark && controls.curtainAuto) {
    servo.write(ActuatorConfig::SERVO_CURTAIN_CLOSED_ANGLE);
  } else {
    servo.write(ActuatorConfig::SERVO_NORMAL_ANGLE);
  }

  if (!alarmState.any || !controls.buzzerAlarm) {
    setBuzzer(false);
    lastAlarmAny = false;
    return;
  }
  // 仅在有警报时才进入蜂鸣与报警逻辑

  if (!lastAlarmAny) {
    lastAlarmAny = true;
    lastBeepToggleMs = millis();
    setBuzzer(true);
  }

  if (alarmState.coDanger || alarmState.smokeDanger) {
    setBuzzer(true);
    return;
  }

  const uint32_t now = millis();
  const uint32_t interval = alarmState.critical ? Timing::ALERT_BEEP_INTERVAL_MS : Timing::WARNING_BEEP_INTERVAL_MS;
  if (now - lastBeepToggleMs >= interval) {
    lastBeepToggleMs = now;
    setBuzzer(!buzzerOn);
  }
}

const char* primaryAlarmText() {
  if (alarmState.coDanger) return "CO DANGER";
  if (alarmState.fallDetected) return "FALL DETECTED";
  if (alarmState.sos) return "SOS BUTTON";
  if (alarmState.smokeDanger) return "SMOKE DANGER";
  if (alarmState.airDanger) return "AIR DANGER";
  if (alarmState.smokeWarning) return "SMOKE WARNING";
  if (alarmState.coWarning) return "CO WARNING";
  if (alarmState.airWarning) return "AIR WARNING";
  if (alarmState.tempHumidity) return "TEMP/HUMID";
  if (alarmState.tempLow) return "TEMP LOW";
  if (alarmState.humidityLow) return "HUMID LOW";
  if (alarmState.vibration) return "VIBRATION";
  if (alarmState.pressure) return "PRESSURE";
  if (alarmState.noMotion) return "NO MOTION";
  if (activityState.nightActivity) return "NIGHT MOVE";
  return "NORMAL";
}

const char* dangerLevelText() {
  if (alarmState.coDanger) return "co_critical";
  if (alarmState.fallDetected || alarmState.sos) return "critical";
  if (alarmState.smokeDanger) return "danger";
  if (alarmState.airDanger) return "danger";
  if (alarmState.any) return "warning";
  if (activityState.nightActivity) return "activity";
  return "normal";
}

const char* fallStatusText() {
  return alarmState.fallDetected ? "YES" : "SAFE";
}

const char* airStatusText() {
  if (alarmState.airDanger) return "DANGER";
  if (alarmState.airWarning) return "WARN";
  return "OK";
}

const char* smokeStatusText() {
  if (alarmState.smokeDanger) return "DANGER";
  if (alarmState.smokeWarning) return "WARN";
  return "OK";
}

const char* coStatusText() {
  if (alarmState.coDanger) return "DANGER";
  if (alarmState.coWarning) return "WARN";
  return "OK";
}

struct DisplayAlert {
  const char* item = "";
  const char* level = "";
  const char* valueLabel = "";
  float value = NAN;
  const char* limitLabel = "";
  float limit = NAN;
  const char* unit = "";
  bool integerValue = false;
};

void addDisplayAlert(DisplayAlert* alerts,
                     uint8_t& count,
                     const char* item,
                     const char* level,
                     const char* valueLabel,
                     float value,
                     const char* limitLabel,
                     float limit,
                     const char* unit,
                     bool integerValue) {
  DisplayAlert& alert = alerts[count++];
  alert.item = item;
  alert.level = level;
  alert.valueLabel = valueLabel;
  alert.value = value;
  alert.limitLabel = limitLabel;
  alert.limit = limit;
  alert.unit = unit;
  alert.integerValue = integerValue;
}

uint8_t collectDisplayAlerts(DisplayAlert* alerts) {
  uint8_t count = 0;

  if (alarmState.coDanger) {
    addDisplayAlert(alerts, count, "MQ7 CO", "CRITICAL", "Value", data.mq7Raw,
                    "Limit", Mq7Config::DANGER_RAW, "", true);
  } else if (alarmState.coWarning) {
    addDisplayAlert(alerts, count, "MQ7 CO", "WARNING", "Value", data.mq7Raw,
                    "Limit", Mq7Config::WARN_RAW, "", true);
  }

  if (alarmState.smokeDanger) {
    addDisplayAlert(alerts, count, "MQ2 GAS", "DANGER", "Value", data.mq2Raw,
                    "Limit", Mq2Config::DANGER_RAW, "", true);
  } else if (alarmState.smokeWarning) {
    addDisplayAlert(alerts, count, "MQ2 GAS", "WARNING", "Value", data.mq2Raw,
                    "Limit", Mq2Config::WARN_RAW, "", true);
  }

  if (alarmState.airDanger) {
    addDisplayAlert(alerts, count, "MQ135 AIR", "DANGER", "Value", data.mq135Raw,
                    "Limit", Mq135Config::DANGER_RAW, "", true);
  } else if (alarmState.airWarning) {
    addDisplayAlert(alerts, count, "MQ135 AIR", "WARNING", "Value", data.mq135Raw,
                    "Limit", Mq135Config::WARN_RAW, "", true);
  }

  if (!isnan(data.temperatureC) && data.temperatureC >= Dht22Config::TEMP_HIGH_C) {
    addDisplayAlert(alerts, count, "TEMP HIGH", "WARNING", "Value", data.temperatureC,
                    "Limit", Dht22Config::TEMP_HIGH_C, "C", false);
  } else if (alarmState.tempLow) {
    addDisplayAlert(alerts, count, "TEMP LOW", "WARNING", "Value", data.temperatureC,
                    "Limit", Dht22Config::TEMP_LOW_C, "C", false);
  }

  if (!isnan(data.humidity) && data.humidity >= Dht22Config::HUMIDITY_HIGH_PERCENT) {
    addDisplayAlert(alerts, count, "HUMID HIGH", "WARNING", "Value", data.humidity,
                    "Limit", Dht22Config::HUMIDITY_HIGH_PERCENT, "%", false);
  } else if (alarmState.humidityLow) {
    addDisplayAlert(alerts, count, "HUMID LOW", "WARNING", "Value", data.humidity,
                    "Limit", Dht22Config::HUMIDITY_LOW_PERCENT, "%", false);
  }

  if (alarmState.fallDetected) {
    addDisplayAlert(alerts, count, "FALL", "CRITICAL", "State", 1,
                    "Need", 1, "", true);
  }

  if (alarmState.sos) {
    addDisplayAlert(alerts, count, "SOS BUTTON", "CRITICAL", "State", 1,
                    "Need", 1, "", true);
  }

  if (alarmState.pressure) {
    addDisplayAlert(alerts, count, "FSR PRESS", "WARNING", "Value", data.fsrRaw,
                    "Limit", Fsr402Config::PRESS_WARN_RAW, "", true);
  }

  if (alarmState.vibration) {
    addDisplayAlert(alerts, count, "VIBRATION", "WARNING", "State", 1,
                    "Need", 1, "", true);
  }

  if (alarmState.noMotion) {
    addDisplayAlert(alerts, count, "NO MOTION", "WARNING", "State", 1,
                    "Need", 1, "", true);
  }

  return count;
}

void printDisplayValue(float value, const char* unit, bool integerValue) {
  if (isnan(value)) {
    display.print(F("--"));
  } else if (integerValue) {
    display.print(static_cast<uint16_t>(value));
  } else {
    display.print(value, 1);
  }
  display.print(unit);
}

void printCompactValue(float value, const char* unit, bool integerValue) {
  if (isnan(value)) {
    display.print(F("--"));
  } else if (integerValue) {
    display.print(static_cast<uint16_t>(value));
  } else {
    display.print(value, 0);
  }
  display.print(unit);
}

void drawHeader(const char* stateText) {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("HOME MONITOR"));
  display.setCursor(92, 0);
  display.print(stateText);
  display.drawFastHLine(0, 10, OledConfig::WIDTH, SSD1306_WHITE);
}

void drawEnvironmentStrip(uint8_t y) {
  display.setTextSize(1);
  display.setCursor(0, y);
  display.print(F("T "));
  if (isnan(data.temperatureC)) display.print(F("--"));
  else display.print(data.temperatureC, 1);
  display.print(F("C"));

  display.setCursor(47, y);
  display.print(F("H "));
  if (isnan(data.humidity)) display.print(F("--"));
  else display.print(data.humidity, 0);
  display.print(F("%"));

  display.setCursor(84, y);
  display.print(F("L "));
  if (isnan(data.lux)) display.print(F("--"));
  else display.print(data.lux, 0);
}

void drawFooterStatus(uint8_t y) {
  display.setTextSize(1);
  display.setCursor(0, y);
  display.print(F("PIR "));
  display.print(data.pirMotion ? F("MOVE") : F("STILL"));

  display.setCursor(66, y);
  display.print(F("B "));
  display.print(buzzerOn ? F("ON") : F("OFF"));

  display.setCursor(98, y);
  display.print(F("F "));
  display.print(fanOn ? F("ON") : F("OFF"));
}

// OLED 显示内容：0.96 寸 I2C 屏只展示关键状态，便于现场快速查看
void drawDisplay() {
  if (!oledOk) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  DisplayAlert alerts[12];
  const uint8_t alertCount = collectDisplayAlerts(alerts);

  if (alertCount == 0) {
    drawHeader("OK");
    drawEnvironmentStrip(14);

    display.setTextSize(2);
    display.setCursor(14, 28);
    display.print(F("NORMAL"));

    display.setTextSize(1);
    display.setCursor(23, 47);
    display.print(F("All readings safe"));
    drawFooterStatus(56);
    display.display();
    return;
  }

  const uint8_t index = (millis() / Timing::DISPLAY_PAGE_INTERVAL_MS) % alertCount;
  const DisplayAlert& alert = alerts[index];

  drawHeader(alert.level);

  display.setCursor(0, 13);
  display.print(index + 1);
  display.print(F("/"));
  display.print(alertCount);
  display.print(F(" "));
  display.print(alert.item);

  display.drawRect(0, 24, OledConfig::WIDTH, 28, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(6, 31);
  if (strcmp(alert.level, "CRITICAL") == 0) {
    display.print(F("CRITICAL"));
  } else if (strcmp(alert.level, "DANGER") == 0) {
    display.print(F("DANGER"));
  } else {
    display.print(F("WARNING"));
  }

  display.setTextSize(1);
  display.setCursor(0, 55);
  display.print(F("V "));
  printCompactValue(alert.value, alert.unit, alert.integerValue);
  display.setCursor(50, 55);
  display.print(F("L "));
  printCompactValue(alert.limit, alert.unit, alert.integerValue);
  display.setCursor(98, 55);
  display.print(F("B "));
  display.print(buzzerOn ? F("ON") : F("OFF"));

  display.display();
}

// 将当前传感器读数和状态输出到串口，便于调试和日志记录
void printSerialLog() {
  Serial.print(F("tempC="));
  Serial.print(data.temperatureC);
  Serial.print(F(",humidity="));
  Serial.print(data.humidity);
  Serial.print(F(",lux="));
  Serial.print(data.lux);
  Serial.print(F(",mq2="));
  Serial.print(data.mq2Raw);
  Serial.print(F(",mq135="));
  Serial.print(data.mq135Raw);
  Serial.print(F(",mq7="));
  Serial.print(data.mq7Raw);
  Serial.print(F(",fsr="));
  Serial.print(data.fsrRaw);
  Serial.print(F(",vibrationRaw="));
  Serial.print(data.vibrationRaw);
  Serial.print(F(",pir="));
  Serial.print(data.pirMotion);
  Serial.print(F(",dark="));
  Serial.print(activityState.dark);
  Serial.print(F(",nightActivity="));
  Serial.print(activityState.nightActivity);
  Serial.print(F(",vibration="));
  Serial.print(data.vibration);
  Serial.print(F(",sos="));
  Serial.print(data.sos);
  Serial.print(F(",fall="));
  Serial.print(alarmState.fallDetected);
  Serial.print(F(",level="));
  Serial.print(dangerLevelText());
  Serial.print(F(",alarm="));
  Serial.print(primaryAlarmText());
  Serial.print(F(",buzzer="));
  Serial.print(buzzerOn);
  Serial.print(F(",wifi="));
  Serial.print(AliyunClient::isWifiConnected());
  Serial.print(F(",mqtt="));
  Serial.println(AliyunClient::isMqttConnected());
}

// 组装待发送到云端的遥测数据包
TelemetryPayload buildTelemetryPayload() {
  TelemetryPayload payload;
  payload.temperatureC = data.temperatureC;
  payload.humidity = data.humidity;
  payload.lux = data.lux;
  payload.mq2Raw = data.mq2Raw;
  payload.mq135Raw = data.mq135Raw;
  payload.mq7Raw = data.mq7Raw;
  payload.fsrRaw = data.fsrRaw;
  payload.vibrationRaw = data.vibrationRaw;
  payload.pirMotion = data.pirMotion;
  payload.vibration = data.vibration;
  payload.sos = data.sos;
  payload.fallDetected = alarmState.fallDetected;
  payload.dark = activityState.dark;
  const DeviceControlState& controls = AliyunClient::controlState();
  payload.bedOccupied = controls.enableFsr && data.fsrRaw >= Fsr402Config::BED_OCCUPIED_RAW;
  payload.nightWakeActive = controls.enablePir && activityState.dark && !payload.bedOccupied && data.pirMotion;
  payload.nightActivity = activityState.nightActivity;
  payload.alarmAny = alarmState.any;
  payload.pushRequired = alarmState.pushRequired;
  payload.fanOn = fanOn;
  payload.ledOn = ledOn;
  payload.dangerLevel = dangerLevelText();
  payload.alarmText = primaryAlarmText();
  return payload;
}

// 初始化引脚：输入传感器和输出执行器
void setupPins() {
  pinMode(PirConfig::OUT_PIN, INPUT);
  pinMode(Sw420Config::DOUT_PIN, INPUT);
  pinMode(SosButtonConfig::PIN, INPUT_PULLUP);
  pinMode(ActuatorConfig::BUZZER_PIN, OUTPUT);
  pinMode(ActuatorConfig::FAN_RELAY_PIN, OUTPUT);
  pinMode(ActuatorConfig::LED_LIGHT_PIN, OUTPUT);

  setBuzzer(false);
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, LOW);
  digitalWrite(ActuatorConfig::LED_LIGHT_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(Mq2Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Mq135Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Mq7Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Fsr402Config::AOUT_PIN, ADC_11db);
}

// 初始化外设设备：OLED、BH1750、DHT22、舵机
void setupDevices() {
  Wire.begin(OledConfig::SDA_PIN, OledConfig::SCL_PIN);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OledConfig::I2C_ADDR);

  bh1750Wire.begin(Bh1750Config::SDA_PIN, Bh1750Config::SCL_PIN);
  bh1750Ok = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,
                              Bh1750Config::I2C_ADDR,
                              &bh1750Wire);
  dht.begin();

  servo.setPeriodHertz(50);
  servo.attach(ActuatorConfig::SERVO_PWM_PIN, 500, 2400);
  servo.write(ActuatorConfig::SERVO_NORMAL_ANGLE);

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
}  // namespace

void setup() {
  // 初始化串口与硬件外设，并启动阿里云客户端
  Serial.begin(115200);
  delay(200);
  OnboardRgbStatus::showUploadStarting();
  setupPins();
  setupDevices();
  AliyunClient::begin();
  OnboardRgbStatus::showUploadSuccess();
  lastMotionMs = millis();
  Serial.println(F("ESP32 elder monitor started."));
  Serial.print(F("OLED="));
  Serial.print(oledOk ? F("OK") : F("FAIL"));
  Serial.print(F(", BH1750="));
  Serial.println(bh1750Ok ? F("OK") : F("FAIL"));
}

void loop() {
  const uint32_t now = millis();

  // 主循环：实时更新按键、云端状态、活动和警报状态
  data.sos = AliyunClient::controlState().enableSos && buttonPressed();
  AliyunClient::loop();
  updateActivityState();
  updateAlarmState();

  if (now - lastSensorReadMs >= Timing::SENSOR_INTERVAL_MS) {
    lastSensorReadMs = now;
    readSensors();
    updateActivityState();
    updateAlarmState();
    updateActuators();
  }

  if (now - lastDisplayMs >= Timing::DISPLAY_INTERVAL_MS) {
    lastDisplayMs = now;
    drawDisplay();
  }

  if (now - lastSerialMs >= Timing::SERIAL_INTERVAL_MS) {
    lastSerialMs = now;
    printSerialLog();
  }

  if (now - lastCloudPublishMs >= CloudConfig::CLOUD_PUBLISH_INTERVAL_MS) {
    lastCloudPublishMs = now;
    AliyunClient::publishTelemetry(buildTelemetryPayload());
  }

  updateActuators();
}
