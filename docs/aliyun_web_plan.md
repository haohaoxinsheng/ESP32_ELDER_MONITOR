# 阿里云接入与网页展示方案

## 推荐展示架构

```text
ESP32 传感器终端
  ├─ MQTT 属性上报 -> 阿里云物联网平台
  └─ HTTP 镜像上报 -> Node.js 网页后端 -> 浏览器实时大屏
```

这个方案适合毕业设计展示：阿里云链路用于体现物联网云平台接入，网页后端用于保证答辩现场的数据展示稳定可控。后期如果要更正式，可以把网页后端的数据入口改成阿里云规则引擎、AMQP 服务端订阅或数据库。

## 阿里云设备配置

1. 在阿里云物联网平台创建产品。
2. 创建设备，获得三元组：`ProductKey`、`DeviceName`、`DeviceSecret`。
3. 在物模型中增加 README 中列出的属性标识符。
4. 将三元组填入 `include/cloud/cloud_config.h`。
5. 把 `ENABLE_WIFI` 和 `ENABLE_ALIYUN_MQTT` 改为 `true`。

## 网页后端配置

1. 进入 `web` 目录。
2. 复制 `.env.example` 为 `.env`。
3. 设置 `DEVICE_TOKEN`。
4. ESP32 的 `WEB_MIRROR_TOKEN` 必须与 `DEVICE_TOKEN` 一致。
5. 把 `ENABLE_WEB_MIRROR` 改为 `true`。
6. 把 `WEB_MIRROR_URL` 改成后端所在电脑或服务器 IP。

## 答辩展示流程

1. 先打开网页大屏。
2. 给 ESP32 上电，确认 OLED 和串口正常。
3. 观察网页实时数据刷新。
4. 遮挡 BH1750 并在 PIR 前移动，展示起夜检测和自动开灯。
5. 按下 SOS，展示网页告警、蜂鸣器和舵机联动。
6. 打开阿里云控制台，展示设备在线和物模型数据上报记录。

