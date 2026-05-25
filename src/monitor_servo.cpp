// 舵机驱动实现：以非阻塞状态机完成窗帘开合、SOS 动作和待机释放。
#include "monitor/monitor_servo.h"

#include <ESP32Servo.h>

#include "devices/servo_config.h"

namespace Monitor {
namespace ServoDrive {
namespace {
enum class Phase : uint8_t {
  Idle = 0,
  Moving,
  Stopping
};

Servo servo;
Phase phase = Phase::Idle;
Command latchedCommand = Command::Idle;
uint32_t nextTransitionMs = 0;
bool attached = false;

// 舵机按需 attach，减少空闲时 PWM 信号对舵机的持续占用。
void attachIfNeeded() {
  if (attached) {
    return;
  }
  servo.setPeriodHertz(50);
  servo.attach(ServoConfig::PWM_PIN, 500, 2400);
  attached = true;
}

// 写入舵机角度前确保 PWM 已连接。
void writeAngle(uint8_t angle) {
  attachIfNeeded();
  servo.write(angle);
}

// 释放舵机信号并把引脚拉低，避免待机抖动和发热。
void releaseSignal() {
  if (attached) {
    servo.detach();
    attached = false;
  }
  setupPin();
}

// 当前动作结束后回到待机角，再延迟释放 PWM。
void stopAndForget() {
  if (latchedCommand == Command::Idle) {
    if (phase == Phase::Idle) {
      releaseSignal();
    }
    return;
  }

  latchedCommand = Command::Idle;
  writeAngle(ServoConfig::STANDBY_ANGLE);
  phase = Phase::Stopping;
  nextTransitionMs = millis() + ServoConfig::STOP_HOLD_MS;
}

// 启动一个带保持时间的舵机动作，同类命令不会重复触发。
void startCommand(Command command, uint8_t angle, uint16_t holdMs) {
  if (latchedCommand == command) {
    return;
  }

  latchedCommand = command;
  writeAngle(angle);
  phase = Phase::Moving;
  nextTransitionMs = millis() + holdMs;
}
}  // namespace

// 让舵机引脚回到普通低电平输出，作为释放后的安全状态。
void setupPin() {
  pinMode(ServoConfig::PWM_PIN, OUTPUT);
  digitalWrite(ServoConfig::PWM_PIN, LOW);
}

// 初始化舵机到待机角，并设置短暂保持后释放。
void begin() {
  setupPin();
  writeAngle(ServoConfig::STANDBY_ANGLE);
  phase = Phase::Stopping;
  latchedCommand = Command::Idle;
  nextTransitionMs = millis() + ServoConfig::STOP_HOLD_MS;
}

// 窗帘动作：暗环境关闭，亮环境打开，关闭自动时回待机。
void driveCurtain(bool enabled, bool dark) {
  if (!enabled) {
    stopAndForget();
    return;
  }

  if (dark) {
    startCommand(Command::CurtainClose,
                 ServoConfig::CURTAIN_CLOSED_ANGLE,
                 ServoConfig::CURTAIN_HOLD_MS);
  } else {
    startCommand(Command::CurtainOpen,
                 ServoConfig::CURTAIN_OPEN_ANGLE,
                 ServoConfig::CURTAIN_HOLD_MS);
  }
}

// SOS 动作：求助时转到专用角度，解除后回待机。
void driveSos(bool enabled, bool active) {
  if (enabled && active) {
    startCommand(Command::Sos, ServoConfig::SOS_ANGLE, ServoConfig::SOS_HOLD_MS);
    return;
  }

  if (latchedCommand == Command::Sos) {
    stopAndForget();
  }
}

// 非阻塞状态机推进：动作保持结束后回待机，再释放 PWM。
void updateStandby() {
  const uint32_t now = millis();
  if (phase == Phase::Moving && now >= nextTransitionMs) {
    writeAngle(ServoConfig::STANDBY_ANGLE);
    phase = Phase::Stopping;
    nextTransitionMs = now + ServoConfig::STOP_HOLD_MS;
    return;
  }

  if (phase == Phase::Stopping && now >= nextTransitionMs) {
    releaseSignal();
    phase = Phase::Idle;
  }
}

// 返回舵机当前是否处于动作保持阶段。
bool isActive() {
  return phase == Phase::Moving;
}
}  // namespace ServoDrive
}  // namespace Monitor
