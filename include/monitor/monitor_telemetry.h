#pragma once

#include "telemetry_payload.h"

namespace Monitor {
void printSerialLog();
TelemetryPayload buildTelemetryPayload();
}  // namespace Monitor
