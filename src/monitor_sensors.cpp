// 传感器采集与告警实现：读取环境/气体/压力/人体/振动数据，并推导活动和风险状态。
#include "monitor/monitor_sensors.h"

#include "cloud/aliyun_client.h"
#include "config.h"
#include "devices/bh1750_config.h"
#include "devices/dht22_config.h"
#include "devices/fsr402_config.h"
#include "devices/mq2_config.h"
#include "devices/mq135_config.h"
#include "devices/mq7_config.h"
#include "devices/pir_config.h"
#include "devices/sw420_config.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_state.h"

namespace Monitor {
namespace {
uint32_t pressureExceededSinceMs = 0;
uint32_t sosHoldUntilMs = 0;

bool updatePressureAlarm(const DeviceControlState& controls, uint32_t now) {
  if (!controls.enableFsr) {
    pressureExceededSinceMs = 0;
    return false;
  }

  if (data.fsrRaw >= controls.fsrPressure) {
    if (pressureExceededSinceMs == 0) {
      pressureExceededSinceMs = now;
    }
    return now - pressureExceededSinceMs >= Fsr402Config::PRESS_ALARM_HOLD_MS;
  }

  if (data.fsrRaw + Fsr402Config::PRESS_CLEAR_MARGIN_RAW < controls.fsrPressure) {
    pressureExceededSinceMs = 0;
    return false;
  }

  return alarmState.pressure;
}
}  // namespace

// 高频读取 SOS，并将短按保持数秒，避免网页上报周期错过瞬时按键。
void updateSosState() {
  const DeviceControlState& controls = AliyunClient::controlState();
  const uint32_t now = millis();
  const bool pressed = controls.enableSos && buttonPressed();

  if (!controls.enableSos) {
    sosHoldUntilMs = 0;
    data.sos = false;
    return;
  }

  if (pressed) {
    sosHoldUntilMs = now + Timing::SOS_ALARM_HOLD_MS;
  }

  data.sos = pressed || static_cast<int32_t>(sosHoldUntilMs - now) > 0;
}

// 读取所有启用的传感器；网页端关闭某个传感器时保留安全默认值。
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
  updateSosState();

  if (data.pirMotion) {
    lastMotionMs = millis();
  }

  if (data.vibration) {
    lastVibrationMs = millis();
  }
}

// 根据光照和人体检测推导暗环境、夜间活动和起夜开灯保持状态。
void updateActivityState() {
  const uint32_t now = millis();
  const DeviceControlState& controls = AliyunClient::controlState();
  activityState.dark = controls.enableBh1750 && !isnan(data.lux) && data.lux <= controls.luxDark;

  if (controls.enablePir && activityState.dark && data.pirMotion) {
    lastNightActivityMs = now;
    nightActivitySeen = true;
  }

  activityState.nightActivity =
      activityState.dark && nightActivitySeen &&
      (now - lastNightActivityMs <= Timing::NIGHT_LIGHT_HOLD_MS);
}

// 气体类告警：分别比较空气质量、烟雾/可燃气和 CO 的预警/危险阈值。
void updateGasAlarms(const DeviceControlState& controls) {
  alarmState.airWarning = controls.enableMq135 && data.mq135Raw >= controls.mq135Warn;
  alarmState.airDanger = controls.enableMq135 && data.mq135Raw >= controls.mq135Danger;
  alarmState.smokeWarning = controls.enableMq2 && data.mq2Raw >= controls.mq2Warn;
  alarmState.smokeDanger = controls.enableMq2 && data.mq2Raw >= controls.mq2Danger;
  alarmState.coWarning = controls.enableMq7 && data.mq7Raw >= controls.mq7Warn;
  alarmState.coDanger = controls.enableMq7 && data.mq7Raw >= controls.mq7Danger;
}

// 舒适度告警：处理温度过高/过低和湿度过高/过低。
void updateComfortAlarms(const DeviceControlState& controls) {
  alarmState.tempHumidity =
      controls.enableDht22 &&
      ((!isnan(data.temperatureC) && data.temperatureC >= controls.tempHigh) ||
       (!isnan(data.humidity) && data.humidity >= controls.humidityHigh));
  alarmState.tempLow = controls.enableDht22 && !isnan(data.temperatureC) && data.temperatureC <= controls.tempLow;
  alarmState.humidityLow = controls.enableDht22 && !isnan(data.humidity) && data.humidity <= controls.humidityLow;
}

// 活动类告警：处理压力、振动、长时间无活动、跌倒和 SOS。
void updateActivityAlarms(const DeviceControlState& controls, uint32_t now) {
  alarmState.pressure = updatePressureAlarm(controls, now);
  alarmState.vibration = controls.enableSw420 && data.vibration;
  const uint32_t noMotionWarningMs = static_cast<uint32_t>(controls.noMotionMinutes) * 60UL * 1000UL;
  alarmState.noMotion = controls.noMotionWarning && (now - lastMotionMs) >= noMotionWarningMs;
  alarmState.fallDetected =
      alarmState.pressure &&
      (now - lastVibrationMs <= Timing::FALL_VIBRATION_WINDOW_MS) &&
      (now - lastMotionMs >= Timing::FALL_NO_MOTION_MS);
  alarmState.sos = controls.enableSos && data.sos;
}

// 汇总最终告警等级，决定是否触发强提醒、推送和执行器联动。
void finalizeAlarmState() {
  alarmState.critical = alarmState.coDanger || alarmState.fallDetected || alarmState.sos;
  alarmState.pushRequired = alarmState.critical || alarmState.airDanger || alarmState.smokeDanger || alarmState.noMotion;
  alarmState.any = alarmState.airWarning || alarmState.airDanger ||
                   alarmState.smokeWarning || alarmState.smokeDanger ||
                   alarmState.coWarning || alarmState.coDanger || alarmState.tempHumidity ||
                   alarmState.tempLow || alarmState.humidityLow ||
                   alarmState.pressure || alarmState.vibration ||
                   alarmState.noMotion || alarmState.fallDetected || alarmState.sos;
}

// 告警总入口：每次采样或快速状态刷新后重新计算完整风险状态。
void updateAlarmState() {
  const uint32_t now = millis();
  const DeviceControlState& controls = AliyunClient::controlState();
  updateGasAlarms(controls);
  updateComfortAlarms(controls);
  updateActivityAlarms(controls, now);
  finalizeAlarmState();
}
}  // namespace Monitor
