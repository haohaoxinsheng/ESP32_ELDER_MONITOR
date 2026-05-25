// 全局运行状态实现：保存传感器对象、告警状态、执行器状态，并提供主要状态判断函数。
#include "monitor/monitor_state.h"

#include "devices/dht22_config.h"
#include "devices/oled_config.h"

namespace Monitor {
Adafruit_SSD1306 display(OledConfig::WIDTH, OledConfig::HEIGHT, &Wire, OledConfig::RESET_PIN);
BH1750 lightMeter;
TwoWire bh1750Wire(1);
DHT dht(Dht22Config::DATA_PIN, Dht22Config::TYPE);

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
uint32_t lastSosChangeMs = 0;
uint32_t lastCloudPublishMs = 0;

bool buzzerOn = false;
bool lastAlarmAny = false;
bool ledBlinkOn = false;
bool lastSosReading = HIGH;
bool stableSosState = HIGH;
bool nightActivitySeen = false;

bool oledOk = false;
bool bh1750Ok = false;
bool fanOn = false;
bool ledOn = false;
bool darkLightOn = false;
bool nightLightOn = false;
bool nightWakeLightOn = false;
bool alarmLightOn = false;

// 床位占用判断：FSR 达到床位阈值时认为老人仍在床上。
bool isBedOccupied(const DeviceControlState& controls) {
  return controls.enableFsr && data.fsrRaw >= controls.bedPresenceRaw;
}

// 通风需求判断：气体危险、烟雾/CO 预警或温湿度异常都会触发风扇。
bool isVentilationNeeded() {
  return alarmState.airDanger || alarmState.smokeWarning ||
         alarmState.coWarning || alarmState.tempHumidity;
}

// 选择当前最重要的告警文案，顺序决定 OLED、串口和 Web 的主状态。
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

// 选择当前危险等级，供 Web 面板着色和强提醒逻辑使用。
const char* dangerLevelText() {
  if (alarmState.coDanger) return "co_critical";
  if (alarmState.fallDetected || alarmState.sos) return "critical";
  if (alarmState.smokeDanger) return "danger";
  if (alarmState.airDanger) return "danger";
  if (alarmState.any) return "warning";
  if (activityState.nightActivity) return "activity";
  return "normal";
}
}  // namespace Monitor
