#include "monitor/monitor_actuators.h"

#include "cloud/aliyun_client.h"
#include "config.h"
#include "devices/actuator_config.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_state.h"

namespace Monitor {
void updateFan(const DeviceControlState& controls) {
  fanOn = isVentilationNeeded() && controls.fanVentilation;
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, fanOn ? HIGH : LOW);
}

void updateLighting(const DeviceControlState& controls) {
  const bool bedOccupied = isBedOccupied(controls);
  darkLightOn = controls.darkLight && activityState.dark;
  nightLightOn = controls.nightLight && activityState.nightActivity;
  nightWakeLightOn = controls.nightWakeLight && controls.enablePir && activityState.dark && !bedOccupied && data.pirMotion;
  alarmLightOn = controls.alarmLight && alarmState.any;
  ledOn = darkLightOn || nightLightOn || nightWakeLightOn || alarmLightOn;
  if (alarmState.critical && controls.alarmLight) {
    const uint32_t now = millis();
    if (now - lastLedBlinkMs >= Timing::CRITICAL_BLINK_INTERVAL_MS) {
      lastLedBlinkMs = now;
      ledBlinkOn = !ledBlinkOn;
    }
    setLedLight(ledBlinkOn);
  } else {
    setLedLight(ledOn);
  }
}

void updateServoPosition(const DeviceControlState& controls) {
  if (alarmState.sos && controls.sosServo) {
    servo.write(ActuatorConfig::SERVO_SOS_ANGLE);
  } else if (controls.curtainAuto) {
    servo.write(activityState.dark ? ActuatorConfig::SERVO_CURTAIN_CLOSED_ANGLE
                                   : ActuatorConfig::SERVO_CURTAIN_OPEN_ANGLE);
  } else {
    servo.write(ActuatorConfig::SERVO_NORMAL_ANGLE);
  }
}

void updateBuzzerAlarm(const DeviceControlState& controls) {
  if (!alarmState.any || !controls.buzzerAlarm) {
    setBuzzer(false);
    lastAlarmAny = false;
    return;
  }

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

void updateActuators() {
  const DeviceControlState& controls = AliyunClient::controlState();
  updateFan(controls);
  updateLighting(controls);
  updateServoPosition(controls);
  updateBuzzerAlarm(controls);
}
}  // namespace Monitor
