// 执行器联动实现：根据告警、暗环境、起夜、SOS 和网页开关控制风扇、灯、舵机、蜂鸣器。
#include "monitor/monitor_actuators.h"

#include "cloud/aliyun_client.h"
#include "config.h"
#include "devices/actuator_config.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_servo.h"
#include "monitor/monitor_state.h"

namespace Monitor {
// 风扇联动：在气体或温湿度风险需要通风时吸合继电器。
void updateFan(const DeviceControlState& controls) {
  fanOn = isVentilationNeeded() && controls.fanVentilation;
  digitalWrite(ActuatorConfig::FAN_RELAY_PIN, fanOn ? HIGH : LOW);
}

// 灯光联动：拆分暗环境灯、夜间活动灯、起夜灯和告警灯，危急告警时闪烁。
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

// 舵机联动：SOS 优先级最高，其次根据暗环境自动开合窗帘。
void updateServoPosition(const DeviceControlState& controls) {
  if (alarmState.sos && controls.sosServo) {
    ServoDrive::driveSos(true, true);
    ServoDrive::updateStandby();
    return;
  }

  ServoDrive::driveSos(false, false);
  ServoDrive::driveCurtain(controls.curtainAuto, activityState.dark);
  ServoDrive::updateStandby();
}

// 蜂鸣器联动：危险告警常响，普通告警按节奏鸣叫。
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

// 执行器总入口：按当前云端控制状态刷新所有本地输出。
void updateActuators() {
  const DeviceControlState& controls = AliyunClient::controlState();
  updateFan(controls);
  updateLighting(controls);
  updateServoPosition(controls);
  updateBuzzerAlarm(controls);
}
}  // namespace Monitor
