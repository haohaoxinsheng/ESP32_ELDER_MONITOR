// Arduino 主入口：委托 Monitor 应用层完成初始化和循环调度。
#include "monitor/monitor_app.h"

void setup() {
  Monitor::begin();
}

void loop() {
  Monitor::run();
}
