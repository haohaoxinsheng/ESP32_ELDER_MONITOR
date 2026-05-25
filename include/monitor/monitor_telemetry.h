// 遥测输出接口：声明串口日志打印和云端/Web 遥测载荷构建函数。
#pragma once

#include "telemetry_payload.h"

namespace Monitor {
void printSerialLog();
TelemetryPayload buildTelemetryPayload();
}  // namespace Monitor
