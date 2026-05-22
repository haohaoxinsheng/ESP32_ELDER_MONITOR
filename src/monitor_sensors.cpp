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

void updateGasAlarms(const DeviceControlState& controls) {
  alarmState.airWarning = controls.enableMq135 && data.mq135Raw >= controls.mq135Warn;
  alarmState.airDanger = controls.enableMq135 && data.mq135Raw >= controls.mq135Danger;
  alarmState.smokeWarning = controls.enableMq2 && data.mq2Raw >= controls.mq2Warn;
  alarmState.smokeDanger = controls.enableMq2 && data.mq2Raw >= controls.mq2Danger;
  alarmState.coWarning = controls.enableMq7 && data.mq7Raw >= controls.mq7Warn;
  alarmState.coDanger = controls.enableMq7 && data.mq7Raw >= controls.mq7Danger;
}

void updateComfortAlarms(const DeviceControlState& controls) {
  alarmState.tempHumidity =
      controls.enableDht22 &&
      ((!isnan(data.temperatureC) && data.temperatureC >= controls.tempHigh) ||
       (!isnan(data.humidity) && data.humidity >= controls.humidityHigh));
  alarmState.tempLow = controls.enableDht22 && !isnan(data.temperatureC) && data.temperatureC <= controls.tempLow;
  alarmState.humidityLow = controls.enableDht22 && !isnan(data.humidity) && data.humidity <= controls.humidityLow;
}

void updateActivityAlarms(const DeviceControlState& controls, uint32_t now) {
  alarmState.pressure = controls.enableFsr && data.fsrRaw >= controls.fsrPressure;
  alarmState.vibration = controls.enableSw420 && data.vibration;
  const uint32_t noMotionWarningMs = static_cast<uint32_t>(controls.noMotionMinutes) * 60UL * 1000UL;
  alarmState.noMotion = controls.noMotionWarning && (now - lastMotionMs) >= noMotionWarningMs;
  alarmState.fallDetected =
      alarmState.pressure &&
      (now - lastVibrationMs <= Timing::FALL_VIBRATION_WINDOW_MS) &&
      (now - lastMotionMs >= Timing::FALL_NO_MOTION_MS);
  alarmState.sos = controls.enableSos && data.sos;
}

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

void updateAlarmState() {
  const uint32_t now = millis();
  const DeviceControlState& controls = AliyunClient::controlState();
  updateGasAlarms(controls);
  updateComfortAlarms(controls);
  updateActivityAlarms(controls, now);
  finalizeAlarmState();
}
}  // namespace Monitor
