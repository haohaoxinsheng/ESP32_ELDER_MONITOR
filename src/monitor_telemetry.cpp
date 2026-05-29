// 遥测输出实现：打印串口调试日志，并组装云端/Web 使用的 TelemetryPayload。
#include "monitor/monitor_telemetry.h"

#include "cloud/aliyun_client.h"
#include "monitor/monitor_hardware.h"
#include "monitor/monitor_servo.h"
#include "monitor/monitor_state.h"

namespace Monitor {
// 串口调试输出：把关键传感器、告警、执行器和网络状态压成一行。
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
  Serial.print(F(",sosRaw="));
  Serial.print(sosRawLevel());
  Serial.print(F(",noMotion="));
  Serial.print(alarmState.noMotion);
  Serial.print(F(",fall="));
  Serial.print(alarmState.fallDetected);
  Serial.print(F(",level="));
  Serial.print(dangerLevelText());
  Serial.print(F(",alarm="));
  Serial.print(primaryAlarmText());
  Serial.print(F(",buzzer="));
  Serial.print(buzzerOn);
  Serial.print(F(",servoActive="));
  Serial.print(ServoDrive::isActive());
  Serial.print(F(",wifi="));
  Serial.print(AliyunClient::isWifiConnected());
  Serial.print(F(",mqtt="));
  Serial.println(AliyunClient::isMqttConnected());
}

// 组装标准遥测载荷，保证固件、云端镜像和 Web 面板字段一致。
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
  payload.noMotion = alarmState.noMotion;
  payload.fallDetected = alarmState.fallDetected;
  payload.dark = activityState.dark;
  const DeviceControlState& controls = AliyunClient::controlState();
  payload.bedOccupied = isBedOccupied(controls);
  payload.nightWakeActive = controls.enablePir && activityState.dark && !payload.bedOccupied && data.pirMotion;
  payload.nightActivity = activityState.nightActivity;
  payload.alarmAny = alarmState.any;
  payload.pushRequired = alarmState.pushRequired;
  payload.fanOn = fanOn;
  payload.ledOn = ledOn;
  payload.darkLightOn = darkLightOn;
  payload.nightLightOn = nightLightOn;
  payload.nightWakeLightOn = nightWakeLightOn;
  payload.alarmLightOn = alarmLightOn;
  payload.servoActive = ServoDrive::isActive();
  payload.dangerLevel = dangerLevelText();
  payload.alarmText = primaryAlarmText();
  return payload;
}
}  // namespace Monitor
