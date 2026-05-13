#include "monitor/monitor_telemetry.h"

#include "cloud/aliyun_client.h"
#include "monitor/monitor_state.h"

namespace Monitor {
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
  payload.dangerLevel = dangerLevelText();
  payload.alarmText = primaryAlarmText();
  return payload;
}
}  // namespace Monitor
