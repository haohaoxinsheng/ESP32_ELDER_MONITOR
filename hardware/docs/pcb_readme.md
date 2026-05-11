# ESP32 老人监测系统 PCB 工程说明

本目录提供一个 KiCad 转接板工程，用于把现有 ESP32-S3 老人监测项目从杜邦线连接整理成一块 2 层 PCB。

## 文件

- `hardware/kicad/esp32_elder_monitor_pcb.kicad_pro`：KiCad 工程文件。
- `hardware/kicad/esp32_elder_monitor_pcb.kicad_pcb`：PCB 板文件，包含板框、接口、网络和基础走线。

## 设计定位

这是 ESP32-S3 DevKitC 开发板的扩展底板，不是裸 ESP32-S3 模组射频板。推荐用排母插 ESP32-S3 开发板，再用 2.54mm 排针或端子连接外部模块。

板子默认参数：

- 双层板。
- 外形尺寸：100mm x 80mm。
- 板厚：1.6mm。
- 主要走线：0.3mm。
- 电源走线：0.8mm。
- 背面 GND 铺铜。
- ESP32-S3 开发板插座：双排 22pin。
- 单排孔距：2.54mm。
- 两排排针中心距：约 24.94mm，按用户提供的 `ESP32-S3-Metric.pdf` / `ESP32-S3-inch.pdf` 反推校准。
- 开发板参考外形：37mm x 63mm，画在 `Dwgs.User` 层，仅作装配检查参考。

## 接口分配

| 接口 | 模块 | 引脚顺序 |
|---|---|---|
| J3 | 5V 电源输入 | 5V, GND |
| J4 | OLED I2C | GND, 3V3, SCL, SDA |
| J5 | BH1750 | GND, 3V3, SCL, SDA |
| J6 | DHT22 | GND, 3V3, DATA |
| J7 | PIR | GND, 5V, OUT |
| J8 | MQ135 | GND, 5V, AO, NC |
| J9 | MQ7 | GND, 5V, AO, NC |
| J10 | FSR402 | GND, 3V3, AO |
| J11 | SW420 | GND, 3V3, DO |
| J12 | SOS 按键 | GND, GPIO12 |
| J13 | 蜂鸣器 | GND, GPIO13 |
| J14 | 风扇继电器 | GND, 5V, GPIO14 |
| J15 | LED 灯 | GND, GPIO15 |
| J16 | SG90 舵机 | GND, 5V, GPIO16 |

## ESP32-S3 GPIO 对应

| 功能 | GPIO |
|---|---|
| MQ135 AOUT | GPIO04 |
| MQ7 AOUT | GPIO05 |
| FSR402 AOUT | GPIO06 |
| DHT22 DATA | GPIO07 |
| OLED/BH1750 SDA | GPIO08 |
| OLED/BH1750 SCL | GPIO09 |
| PIR OUT | GPIO10 |
| SW420 DO | GPIO11 |
| SOS 按键 | GPIO12 |
| 蜂鸣器 | GPIO13 |
| 风扇继电器 | GPIO14 |
| LED 灯光 | GPIO15 |
| 舵机 PWM | GPIO16 |

## 下单前检查

1. 打开 KiCad 工程后先运行 DRC。
2. 按你手上的 ESP32-S3 开发板实物确认两排排针间距、孔数、USB 方向和每个 GPIO 的实际位置。
3. MQ135、MQ7 的 AO 必须确认不超过 3.3V；如果模块 AO 可能输出 5V，需要在 PCB 上补充分压电阻。
4. 舵机、继电器和 MQ 模块电流较大，建议使用外部 5V 电源，ESP32 与外部电源必须共地。
5. 如果要正式打样，建议增加安装孔、保险丝、反接保护和电源指示灯。

## 这次尺寸完善内容

- 将 ESP32-S3 开发板插座从通用 19pin 调整为 PDF 中的 J1/J2 双排 22pin。
- 将两排中心距调整为约 24.94mm。
- 将 ESP32 插座整体上移，给底部继电器、LED、舵机接口留出更多空间。
- 添加开发板参考外形框和 USB 端丝印，便于装配时判断方向。
