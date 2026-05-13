# 非接触式老年人居家监测系统（ESP32-S3）

本项目用于毕业设计的软件部分，开发环境为 VS Code + PlatformIO，必要时也可以把 `src/main.cpp` 拷贝到 Arduino IDE 使用。

## 一、系统功能

- 环境监测：DHT22 采集温湿度，BH1750 采集光照强度。
- 安全监测：MQ2 监测烟雾/可燃气体，MQ135 监测空气质量，MQ7 监测一氧化碳，PIR 监测人体活动，SW420 监测振动，FSR402 监测压力，SOS 按键触发求助。
- 本地告警：蜂鸣器、LED 灯、风扇继电器、舵机联动。
- 起夜辅助：暗环境下检测到人体活动时自动开灯，并保持一段时间。
- 人机交互：SSD1306 OLED 显示实时数据与主要告警状态，串口输出完整日志。

## 二、引脚分配

| 功能 | 模块 | ESP32-S3 引脚 |
|---|---|---|
| OLED SDA | SSD1306 | GPIO08 |
| OLED SCL | SSD1306 | GPIO09 |
| BH1750 SDA | 光照传感器 | GPIO17 |
| BH1750 SCL | 光照传感器 | GPIO18 |
| PIR OUT | HC-SR501 | GPIO10 |
| MQ2 AOUT | 烟雾/可燃气体传感器 | GPIO03 |
| MQ135 AOUT | 空气质量传感器 | GPIO04 |
| MQ7 AOUT | 一氧化碳传感器 | GPIO05 |
| FSR402 AOUT | 压力传感器 | GPIO06 |
| SW420 DO | 振动传感器 | GPIO11 |
| DHT22 DATA | 温湿度传感器 | GPIO07 |
| 蜂鸣器 | 有源蜂鸣器 | GPIO13 |
| 风扇继电器 | 继电器模块 | GPIO14 |
| LED 灯光 | LED 模块 | GPIO15 |
| 舵机 PWM | SG90 | GPIO16 |
| SOS 按钮 | 按键模块 | GPIO12 |

## 三、供电注意

- ESP32-S3、OLED、BH1750、DHT22、传感器模块建议使用 3.3V。
- 风扇、继电器、舵机可使用 5V 供电。
- 所有模块 GND 必须共地。
- HC-SR501 接 PCB 的 `J7` 三针接口，顺序为 `GND, 5V, OUT`，其中 `OUT` 接 ESP32-S3 的 `GPIO10`。
- OLED 使用 `GPIO08/GPIO09`，BH1750 单独使用 `GPIO17/GPIO18`，两路 I2C 分开接线，两个模块都使用 3.3V 供电并共地。
- MQ 系列传感器需要预热，刚上电数值波动较大，演示前建议通电 3 到 5 分钟。
- ESP32-S3 ADC 输入电压不能超过 3.3V，若模块模拟输出可能超过 3.3V，需要分压或确认模块输出范围。
- 本项目按 ESP32-S3-N16R8 重新分配引脚，避开 GPIO22~25 以及常与 Flash/PSRAM 冲突的 GPIO26~37；MQ135、MQ7、FSR402 使用 ESP32-S3 ADC 可用的低号 GPIO。

## 四、PlatformIO 使用

1. 用 VS Code 打开 `C:\Users\19573\Desktop\developer\esp32_elder_monitor`。
2. 安装 PlatformIO 插件。
3. 连接 ESP32-S3-N16R8 开发板。
4. 在 PlatformIO 中执行 `Build` 编译。
5. 执行 `Upload` 烧录。
6. 打开串口监视器，波特率 `115200`。

也可以在终端中运行：

```powershell
pio run
pio run --target upload
pio device monitor -b 115200
```

## 五、阈值调整

通用时间参数放在 `include/config.h`，各模块引脚和阈值放在 `include/devices/`：

- `include/devices/dht22_config.h`：DHT22 引脚、高温和高湿阈值。
- `include/devices/bh1750_config.h`：BH1750 I2C 引脚和起夜暗环境光照阈值。
- `include/devices/mq2_config.h`：MQ2 模拟输入引脚和烟雾/可燃气告警阈值。
- `include/devices/mq135_config.h`：MQ135 模拟输入引脚和空气质量告警阈值。
- `include/devices/mq7_config.h`：MQ7 模拟输入引脚和一氧化碳告警阈值。
- `include/devices/fsr402_config.h`：FSR402 模拟输入引脚和压力告警阈值。
- `include/devices/pir_config.h`：PIR 人体红外输出引脚。
- `include/devices/sw420_config.h`：SW420 振动输出引脚。
- `include/devices/sos_button_config.h`：SOS 按键引脚和消抖时间。
- `include/devices/actuator_config.h`：蜂鸣器、风扇继电器、LED、舵机引脚和舵机角度。
- `include/config.h`：采样周期、显示周期、起夜灯保持时间、无人活动告警时间等系统级时间参数。

MQ135、MQ7、FSR402、震动量在不同接线和模块电位器状态下原始值会不同，建议先打开串口监视器记录正常环境下的数值，再把阈值调到“正常值上方一段距离”。

## 六、联动逻辑

- 烟雾/可燃气、空气质量、一氧化碳或温湿度异常：打开继电器风扇。
- 暗环境且 PIR 检测到人体活动：判定为老人起夜，自动打开 LED 灯并保持一段时间。
- 任意安全告警：强制打开 LED 灯。
- SOS 按键：蜂鸣器报警，舵机转到求助角度。
- PIR 长时间未检测到活动：触发无人活动提示。
- SW420 振动或 FSR402 压力异常：触发安全告警；震动量超过网页设置里的地震报警阈值时触发红色强提醒。

## 七、阿里云与网页大屏

本项目已预留阿里云物联网平台 MQTT 上报和网页展示服务。

### 1. ESP32 云端配置

编辑 `include/cloud/cloud_config.h`：

- `ENABLE_WIFI`：改为 `true` 后启用 WiFi。
- `ENABLE_ALIYUN_MQTT`：改为 `true` 后启用阿里云 MQTT 属性上报。
- `ENABLE_WEB_MIRROR`：改为 `true` 后同时把数据 POST 给网页后端。
- `WIFI_SSID` / `WIFI_PASSWORD`：填写路由器 WiFi。
- `ALIYUN_REGION_ID`：填写阿里云物联网平台地域，例如 `cn-shanghai`。
- `ALIYUN_PRODUCT_KEY` / `ALIYUN_DEVICE_NAME` / `ALIYUN_DEVICE_SECRET`：填写设备三元组。
- `WEB_MIRROR_URL`：填写网页后端地址，例如 `http://192.168.1.10:3000/api/telemetry`。
- `WEB_MIRROR_TOKEN`：和网页后端 `.env` 里的 `DEVICE_TOKEN` 保持一致。

阿里云物模型建议添加以下属性标识符：

| 标识符 | 类型 | 含义 |
|---|---|---|
| Temperature | double | 温度 |
| Humidity | double | 湿度 |
| LightLux | double | 光照 |
| SmokeRaw | int | MQ2 原始值 |
| AirQualityRaw | int | MQ135 原始值 |
| CoRaw | int | MQ7 原始值 |
| PressureRaw | int | FSR402 原始值 |
| VibrationRaw | int | 震动量 |
| Motion | int | 人体活动 |
| Vibration | int | 振动 |
| Sos | int | SOS |
| FallDetected | int | 跌倒检测 |
| Dark | int | 暗环境 |
| NightActivity | int | 起夜检测 |
| Alarm | int | 总告警 |
| PushRequired | int | 是否需要手机推送 |
| FanOn | int | 风扇状态 |
| LedOn | int | 灯光状态 |
| DangerLevel | text | 危险等级 |
| AlarmText | text | 当前状态文本 |

### 2. 网页大屏运行

进入网页目录：

```powershell
cd C:\Users\19573\Desktop\实习开发\esp32_elder_monitor\web
copy .env.example .env
npm install
npm start
```

打开：

```text
http://localhost:3000
```

如果要先看演示效果，可以把 `.env` 中 `ENABLE_MOCK=false` 改成 `ENABLE_MOCK=true`，网页会自动生成模拟数据。

网页界面按展示优先级组织：

- P0：安全状态窗口，最大，用于展示 SOS、起夜和总告警。
- P1：温度、湿度、光照三个核心环境数据窗口。
- P2：传感器原始值、执行器状态、事件记录和趋势图。

网页端还提供独立联动开关：起夜自动开灯、告警强制开灯、气体异常通风、蜂鸣器告警、SOS 舵机动作、无人活动提醒。直接双击打开 `web/public/index.html` 时会进入本地演示模式；真实实时数据建议使用 `http://localhost:3000`。

重要信息采用强提醒机制：

- 老人主动求助：`sos=true` 时进入红色紧急模式，顶部出现固定提醒条，P0 状态窗口闪烁，事件记录标记为“紧急”。
- 疑似跌倒：网页兼容 `fallDetected=true` 字段，收到后同样进入红色紧急模式。
- 一氧化碳高危：`dangerLevel=co_critical` 时进入最高优先级强提醒，Dashboard 顶部显示 Danger Banner。
- 起夜检测、空气质量等普通异常仍记录事件，但不会使用强提醒样式。

当前 ESP32 已实现的核心联动：

- 跌倒检测：SW420 剧烈振动窗口 + PIR 长时间无移动 + FSR402 压力异常，触发 `FALL DETECTED`、蜂鸣器、LED 闪烁、云端事件、Dashboard 强提醒。
- MQ135：轻度异常进入黄色/普通告警；严重异常进入危险告警，启动风扇、蜂鸣器和推送标记。
- MQ7：CO 超标进入最高优先级，蜂鸣器持续报警、LED 闪烁、风扇启动、Dashboard Danger Banner、云端事件记录。
- PIR：长时间无活动触发提醒；夜间暗环境检测到人体活动自动开灯并记录夜间活动。
- BH1750：暗环境 + 人体活动联动 LED；OLED 同步显示 `L:ON/OFF`。
- DHT22：高温启动风扇并告警；低温、高湿、低湿进入环境提醒并上报记录。

手机推送部分当前已输出 `PushRequired` 事件标记，后续可接阿里云规则引擎、钉钉/企业微信机器人、短信服务或 App 推送通道。
