// 固件应用层接口：收口 Arduino 生命周期，统一初始化和主循环任务调度。
#pragma once

namespace Monitor {
void begin();
void run();
}  // namespace Monitor
