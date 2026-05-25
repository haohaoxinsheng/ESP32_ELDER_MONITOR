// OLED 显示实现：整理告警项并在本地屏幕轮播安全状态、读数和阈值信息。
#include "monitor/monitor_display.h"

#include <cstring>

#include "config.h"
#include "devices/dht22_config.h"
#include "devices/fsr402_config.h"
#include "devices/mq2_config.h"
#include "devices/mq135_config.h"
#include "devices/mq7_config.h"
#include "devices/oled_config.h"
#include "monitor/monitor_state.h"

namespace Monitor {
// OLED 告警条目：把一个风险项压缩成屏幕可轮播的一页内容。
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

// 追加一个 OLED 告警页，调用方负责控制数组容量。
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

// 收集当前所有告警项，供 OLED 在多个风险之间轮播。
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

// 紧凑输出数值，避免 OLED 小屏幕上出现过长字符串。
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

// 绘制 OLED 顶部标题和状态标签。
void drawHeader(const char* stateText) {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("HOME MONITOR"));
  display.setCursor(92, 0);
  display.print(stateText);
  display.drawFastHLine(0, 10, OledConfig::WIDTH, SSD1306_WHITE);
}

// 绘制温湿度和光照摘要行。
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

// 绘制底部人体、蜂鸣器和风扇状态。
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

// OLED 主绘制入口：无告警显示 NORMAL，有告警按页轮播风险详情。
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
}  // namespace Monitor
