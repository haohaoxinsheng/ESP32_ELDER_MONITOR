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
#include "devices/mq135_config.h"
#include "devices/mq7_config.h"
#include "devices/oled_config.h"
#include "devices/pir_config.h"
#include "devices/sos_button_config.h"
#include "devices/sw420_config.h"
#include "telemetry_payload.h"

// 全局静态对象：OLED 显示、光照传感器、温湿度传感器、舵机
namespace {
Adafruit_SSD1306 display(OledConfig::WIDTH, OledConfig::HEIGHT, &Wire, OledConfig::RESET_PIN);
BH1750 lightMeter;
DHT dht(Dht22Config::DATA_PIN, Dht22Config::TYPE);
Servo servo;

// 传感器数据结构：保存当前读取到的环境与状态信息
struct SensorData {
  float temperatureC = NAN;
  float humidity = NAN;
  float lux = NAN;
  uint16_t mq135Raw = 0;
  uint16_t mq7Raw = 0;
  uint16_t fsrRaw = 0;
  bool pirMotion = false;
  bool vibration = false;
  bool sos = false;
};

// 警报状态结构：根据传感器数据判断各种告警与危险等级
struct AlarmState {
  bool airWarning = false;
  bool airDanger = false;
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
bool ledBlinkOn = false;
bool lastSosReading = HIGH;
bool stableSosState = HIGH;
uint32_t lastSosChangeMs = 0;
uint32_t lastCloudPublishMs = 0;

bool oledOk = false;
bool bh1750Ok = false;
bool fanOn = false;
bool ledOn = false;

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
  data.temperatureC = dht.readTemperature();
  data.humidity = dht.readHumidity();
  data.lux = bh1750Ok ? lightMeter.readLightLevel() : NAN;
  data.mq135Raw = analogRead(Mq135Config::AOUT_PIN);
  data.mq7Raw = analogRead(Mq7Config::AOUT_PIN);
  data.fsrRaw = analogRead(Fsr402Config::AOUT_PIN);
  data.pirMotion = digitalRead(PirConfig::OUT_PIN) == HIGH;
  data.vibration = digitalRead(Sw420Config::DOUT_PIN) == HIGH;
  data.sos = buttonPressed();

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
  activityState.dark = !isnan(data.lux) && data.lux <= Bh1750Config::NIGHT_ACTIVITY_LUX;

  if (activityState.dark && data.pirMotion) {
    lastNightActivityMs = now;
  }

  activityState.nightActivity =
      activityState.dark && (now - lastNightActivityMs <= Timing::NIGHT_LIGHT_HOLD_MS);
}

void updateAlarmState() {
  const uint32_t now = millis();
  alarmState.airWarning = data.mq135Raw >= Mq135Config::WARN_RAW;
  alarmState.airDanger = data.mq135Raw >= Mq135Config::DANGER_RAW;
  alarmState.coWarning = data.mq7Raw >= Mq7Config::WARN_RAW;
  alarmState.coDanger = data.mq7Raw >= Mq7Config::DANGER_RAW;
  alarmState.tempHumidity =
      (!isnan(data.temperatureC) && data.temperatureC >= Dht22Config::TEMP_HIGH_C) ||
      (!isnan(data.humidity) && data.humidity >= Dht22Config::HUMIDITY_HIGH_PERCENT);
  alarmState.tempLow = !isnan(data.temperatureC) && data.temperatureC <= Dht22Config::TEMP_LOW_C;
  alarmState.humidityLow = !isnan(data.humidity) && data.humidity <= Dht22Config::HUMIDITY_LOW_PERCENT;
  alarmState.pressure = data.fsrRaw >= Fsr402Config::PRESS_WARN_RAW;
  alarmState.vibration = data.vibration;
  alarmState.noMotion = (now - lastMotionMs) >= Timing::NO_MOTION_WARNING_MS;
  alarmState.fallDetected =
      alarmState.pressure &&
      (now - lastVibrationMs <= Timing::FALL_VIBRATION_WINDOW_MS) &&
      (now - lastMotionMs >= Timing::FALL_NO_MOTION_MS);
  // 只有在检测到压力、振动和长时间无运动时才判定为跌倒
  alarmState.sos = data.sos;
  alarmState.critical = alarmState.coDanger || alarmState.fallDetected || alarmState.sos;
  alarmState.pushRequired = alarmState.critical || alarmState.airDanger || alarmState.noMotion;
  alarmState.any = alarmState.airWarning || alarmState.coWarning || alarmState.tempHumidity ||
                   alarmState.tempLow || alarmState.humidityLow ||
                   alarmState.pressure || alarmState.vibration ||
                   alarmState.noMotion || alarmState.fallDetected || alarmState.sos;
}

// 控制执行器：风扇、指示灯、蜂鸣器、舵机根据当前警报状态和活动状态动作
void updateActuators() {
  const bool needVentilation =
      alarmState.airDanger || alarmState.coWarning || alarmState.tempHumidity;
  fanOn = needVentilation;
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, needVentilation ? HIGH : LOW);

  const bool autoLight = activityState.nightActivity;
  ledOn = autoLight || alarmState.any;
  if (alarmState.critical) {
    const uint32_t now = millis();
    if (now - lastLedBlinkMs >= Timing::CRITICAL_BLINK_INTERVAL_MS) {
      lastLedBlinkMs = now;
      ledBlinkOn = !ledBlinkOn;
    }
    digitalWrite(ActuatorConfig::LED_LIGHT_PIN, ledBlinkOn ? HIGH : LOW);
  } else {
    digitalWrite(ActuatorConfig::LED_LIGHT_PIN, ledOn ? HIGH : LOW);
  }

  servo.write(alarmState.sos ? ActuatorConfig::SERVO_SOS_ANGLE : ActuatorConfig::SERVO_NORMAL_ANGLE);

  if (!alarmState.any) {
    digitalWrite(ActuatorConfig::BUZZER_PIN, LOW);
    buzzerOn = false;
    return;
  }
  // 仅在有警报时才进入蜂鸣与报警逻辑

  if (alarmState.coDanger) {
    digitalWrite(ActuatorConfig::BUZZER_PIN, HIGH);
    buzzerOn = true;
    return;
  }

  const uint32_t now = millis();
  const uint32_t interval = alarmState.critical ? Timing::ALERT_BEEP_INTERVAL_MS : Timing::WARNING_BEEP_INTERVAL_MS;
  if (now - lastBeepToggleMs >= interval) {
    lastBeepToggleMs = now;
    buzzerOn = !buzzerOn;
    digitalWrite(ActuatorConfig::BUZZER_PIN, buzzerOn ? HIGH : LOW);
  }
}

const char* primaryAlarmText() {
  if (alarmState.coDanger) return "CO DANGER";
  if (alarmState.fallDetected) return "FALL DETECTED";
  if (alarmState.sos) return "SOS BUTTON";
  if (alarmState.airDanger) return "AIR DANGER";
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

// OLED 显示内容：0.96 寸 I2C 屏只展示关键状态，便于现场快速查看
void drawDisplay() {
  if (!oledOk) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.print(F("Elder Monitor "));
  display.print(alarmState.critical ? F("ALERT") : alarmState.any ? F("WARN") : F("OK"));

  display.setCursor(0, 14);
  display.print(F("Fall: "));
  display.print(fallStatusText());

  display.setCursor(0, 26);
  display.print(F("T:"));
  if (isnan(data.temperatureC)) display.print(F("--"));
  else display.print(data.temperatureC, 1);
  display.print(F("C H:"));
  if (isnan(data.humidity)) display.print(F("--"));
  else display.print(data.humidity, 0);
  display.print(F("%"));

  display.setCursor(0, 38);
  display.print(F("Air: "));
  display.print(airStatusText());
  display.print(F(" "));
  display.print(data.mq135Raw);

  display.setCursor(0, 50);
  display.print(F("Msg: "));
  display.print(primaryAlarmText());

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
  Serial.print(F(",mq135="));
  Serial.print(data.mq135Raw);
  Serial.print(F(",mq7="));
  Serial.print(data.mq7Raw);
  Serial.print(F(",fsr="));
  Serial.print(data.fsrRaw);
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
  payload.mq135Raw = data.mq135Raw;
  payload.mq7Raw = data.mq7Raw;
  payload.fsrRaw = data.fsrRaw;
  payload.pirMotion = data.pirMotion;
  payload.vibration = data.vibration;
  payload.sos = data.sos;
  payload.fallDetected = alarmState.fallDetected;
  payload.dark = activityState.dark;
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

  digitalWrite(ActuatorConfig::BUZZER_PIN, LOW);
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, LOW);
  digitalWrite(ActuatorConfig::LED_LIGHT_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(Mq135Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Mq7Config::AOUT_PIN, ADC_11db);
  analogSetPinAttenuation(Fsr402Config::AOUT_PIN, ADC_11db);
}

// 初始化外设设备：OLED、BH1750、DHT22、舵机
void setupDevices() {
  Wire.begin(OledConfig::SDA_PIN, OledConfig::SCL_PIN);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OledConfig::I2C_ADDR);
  bh1750Ok = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
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
  setupPins();
  setupDevices();
  AliyunClient::begin();
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
  data.sos = buttonPressed();
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
