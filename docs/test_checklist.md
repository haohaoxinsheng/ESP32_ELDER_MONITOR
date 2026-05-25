<!-- 测试清单：记录固件、硬件接线、传感器读数、Web 面板和云端联动的验证步骤。 -->
# 调试检查表

## 编译前

- PlatformIO 已安装。
- ESP32-S3 开发板选择 `esp32-s3-devkitc-1`，项目环境为 `esp32s3_n16r8`。
- USB 数据线支持数据传输。
- 模块 GND 已共地。
- MQ135、MQ7、FSR402 模拟输出未超过 3.3V。
- 修改引脚或阈值时，优先修改 `include/devices/` 中对应模块的配置文件。

## 单模块测试

| 项目 | 通过标准 |
|---|---|
| OLED | 上电显示标题和数据 |
| DHT22 | 串口温湿度不是 `nan` |
| BH1750 | 遮挡后 Lux 明显下降 |
| MQ2 | AOUT 接 GPIO03，串口 `mq2` 有稳定原始值 |
| MQ135 | 串口 `mq135` 有稳定原始值 |
| MQ7 | 串口 `mq7` 有稳定原始值 |
| PIR | 人体移动时 `pir=1` |
| SW420 | 敲击时 `vibration=1` |
| FSR402 | 按压时 `fsr` 增大 |
| SOS | 按下时 `sos=1` |
| 暗环境自动开灯 | Lux 低于阈值且 `darkLight` 开启时 LED 点亮 |
| 暗环境人体经过亮灯 | 暗环境下 PIR 检测到人时 `nightActivity=1` 且 `nightLight` 开启时 LED 点亮 |
| 蜂鸣器 | 告警时断续响 |
| 继电器风扇 | 气体或温湿度告警时启动 |
| LED | 暗光或告警时点亮 |
| 舵机 | SOS 时转到 90 度附近 |

## 常见问题

- OLED 不亮：检查 I2C 地址是否为 `0x3C`，SDA/SCL 是否接反。
- BH1750 无 Lux 数值：确认 VCC 接 3.3V、GND 共地，SDA 接 GPIO17、SCL 接 GPIO18，且没有与 OLED 的 GPIO08/GPIO09 混接。
- DHT22 显示 `nan`：检查 DATA 引脚、供电和上拉电阻。
- 传感器数值一直很高：MQ 传感器需要预热，模块电位器也会影响输出。
- 继电器逻辑相反：部分继电器为低电平触发，可把 `digitalWrite(Pins::FAN_RELAY, needVentilation ? HIGH : LOW);` 改成相反。
- LED 逻辑相反：普通灯珠如果一端接 3.3V、另一端经限流电阻接 GPIO，通常为低电平点亮；修改 `include/devices/actuator_config.h` 里的 `LED_LIGHT_ACTIVE_HIGH` 可切换极性。
- SOS 一直触发：确认按键模块 DO 接 GPIO12，程序使用 `INPUT_PULLUP`，按下应为低电平。
- 起夜不亮灯：检查 BH1750 的 Lux 是否低于 `NIGHT_ACTIVITY_LUX`，并确认 PIR 输出会变成 `pir=1`。
