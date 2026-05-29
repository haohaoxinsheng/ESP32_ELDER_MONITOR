// 前后端共享模型：统一默认阈值、控制项、遥测归一化、告警推导和静态演示数据。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MonitorModel = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_CONTROLS = Object.freeze({
    darkLight: false,
    nightLight: true,
    nightWakeMonitor: true,
    nightWakeLight: true,
    curtainAuto: true,
    alarmLight: true,
    fanVentilation: true,
    buzzerAlarm: true,
    sosServo: true,
    noMotionWarning: true
  });

  const DEFAULT_THRESHOLDS = Object.freeze({
    enableDht22: true,
    enableBh1750: true,
    enableMq135: true,
    enableMq2: true,
    enableMq7: true,
    enableFsr: true,
    enablePir: true,
    enableSw420: true,
    enableSos: true,
    mq135Warn: 2300,
    mq135Danger: 2800,
    mq2Warn: 1900,
    mq2Danger: 2400,
    mq7Warn: 1900,
    mq7Danger: 2100,
    earthquakeWarn: 2600,
    tempHigh: 32,
    tempLow: 10,
    humidityHigh: 80,
    humidityLow: 25,
    luxDark: 60,
    bedPresenceRaw: 1200,
    fsrPressure: 2300,
    noMotionMinutes: 30
  });

  const DEFAULT_DEMO_TELEMETRY = Object.freeze({
    deviceName: 'demo-esp32',
    productKey: 'static-demo',
    temperatureC: 26.5,
    humidity: 58,
    lux: 180,
    mq2Raw: 980,
    mq135Raw: 1180,
    mq7Raw: 860,
    fsrRaw: 1680,
    vibrationRaw: 120,
    pirMotion: false,
    vibration: false,
    sos: false,
    noMotion: false,
    fallDetected: false,
    dark: false,
    bedOccupied: true,
    nightWakeActive: false,
    nightActivity: false,
    alarmAny: false,
    pushRequired: false,
    fanOn: false,
    ledOn: false,
    buzzerOn: false,
    curtainClosed: false,
    darkLightOn: false,
    nightLightOn: false,
    nightWakeLightOn: false,
    alarmLightOn: false,
    servoActive: false,
    dangerLevel: 'normal',
    alarmText: 'NORMAL',
    uptimeMs: 0
  });

  // 返回默认配置副本，避免调用方直接修改冻结的默认对象。
  function cloneDefaults(source) {
    return { ...source };
  }

  function createDefaultControls() {
    return cloneDefaults(DEFAULT_CONTROLS);
  }

  function createDefaultThresholds() {
    return cloneDefaults(DEFAULT_THRESHOLDS);
  }

  function createDefaultDemoTelemetry() {
    return cloneDefaults(DEFAULT_DEMO_TELEMETRY);
  }

  // 归一化阈值：补齐缺省值、转换数字/布尔值，并修正上下限顺序。
  function normalizeThresholds(input) {
    const next = createDefaultThresholds();
    const source = input || {};

    Object.keys(DEFAULT_THRESHOLDS).forEach((key) => {
      if (typeof DEFAULT_THRESHOLDS[key] === 'boolean') {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          next[key] = Boolean(source[key]);
        }
        return;
      }

      const value = Number(source[key]);
      if (Number.isFinite(value)) {
        next[key] = value;
      }
    });

    [
      ['mq135Warn', 'mq135Danger'],
      ['mq2Warn', 'mq2Danger'],
      ['mq7Warn', 'mq7Danger'],
      ['tempLow', 'tempHigh'],
      ['humidityLow', 'humidityHigh']
    ].forEach(([lowKey, highKey]) => {
      if (next[lowKey] > next[highKey]) {
        const swap = next[lowKey];
        next[lowKey] = next[highKey];
        next[highKey] = swap;
      }
    });

    next.noMotionMinutes = Math.max(1, Math.min(1440, Math.round(next.noMotionMinutes)));

    return next;
  }

  // 把可选数字字段统一成 number 或 null，便于前后端一致渲染缺测值。
  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hasNumber(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(Number(value));
  }

  // 标准化设备上报字段，屏蔽空值、旧字段名和布尔/数字混用差异。
  function normalizeTelemetry(input, options) {
    const now = options && options.timestamp ? new Date(options.timestamp) : new Date();
    const source = input || {};
    return {
      timestamp: now.toISOString(),
      deviceName: String(source.deviceName || 'esp32-elder-monitor'),
      productKey: String(source.productKey || ''),
      temperatureC: optionalNumber(source.temperatureC),
      humidity: optionalNumber(source.humidity),
      lux: optionalNumber(source.lux),
      mq2Raw: Number(source.mq2Raw ?? 0),
      mq135Raw: Number(source.mq135Raw ?? 0),
      mq7Raw: Number(source.mq7Raw ?? 0),
      fsrRaw: optionalNumber(source.fsrRaw),
      vibrationRaw: Number(source.vibrationRaw ?? (source.vibration ? 4095 : 0)),
      pirMotion: Boolean(source.pirMotion),
      vibration: Boolean(source.vibration),
      sos: Boolean(source.sos),
      noMotion: Boolean(source.noMotion ?? (source.alarmText === 'NO MOTION')),
      fallDetected: Boolean(source.fallDetected ?? source.fall ?? false),
      demoMode: Boolean(source.demoMode),
      dark: Boolean(source.dark),
      bedOccupied: Boolean(source.bedOccupied ?? false),
      nightWakeActive: Boolean(source.nightWakeActive ?? false),
      nightActivity: Boolean(source.nightActivity),
      alarmAny: Boolean(source.alarmAny),
      pushRequired: Boolean(source.pushRequired),
      fanOn: Boolean(source.fanOn),
      ledOn: Boolean(source.ledOn),
      buzzerOn: Boolean(source.buzzerOn),
      curtainClosed: Boolean(source.curtainClosed),
      darkLightOn: Boolean(source.darkLightOn),
      nightLightOn: Boolean(source.nightLightOn),
      nightWakeLightOn: Boolean(source.nightWakeLightOn),
      alarmLightOn: Boolean(source.alarmLightOn),
      servoActive: Boolean(source.servoActive),
      dangerLevel: String(source.dangerLevel || 'normal'),
      alarmText: String(source.alarmText || 'NORMAL'),
      uptimeMs: Number(source.uptimeMs ?? 0)
    };
  }

  function normalizeDemoTelemetry(input) {
    return normalizeTelemetry({
      ...DEFAULT_DEMO_TELEMETRY,
      ...(input || {})
    }, { timestamp: DEFAULT_DEMO_TELEMETRY.timestamp || new Date().toISOString() });
  }

  // 根据阈值和联动开关重新推导告警、灯光、风扇和主告警文案。
  function deriveTelemetry(payload, thresholds, controls) {
    const th = normalizeThresholds(thresholds);
    const ctl = { ...createDefaultControls(), ...(controls || {}) };
    const next = { ...payload };

    next.pirMotion = th.enablePir && next.pirMotion;
    next.sos = th.enableSos && next.sos;
    const noMotion = Boolean(ctl.noMotionWarning && (next.noMotion || next.alarmText === 'NO MOTION'));
    next.noMotion = noMotion;

    const airDanger = th.enableMq135 && Number(next.mq135Raw) >= th.mq135Danger;
    const airWarning = th.enableMq135 && Number(next.mq135Raw) >= th.mq135Warn;
    const smokeDanger = th.enableMq2 && Number(next.mq2Raw) >= th.mq2Danger;
    const smokeWarning = th.enableMq2 && Number(next.mq2Raw) >= th.mq2Warn;
    const coDanger = th.enableMq7 && Number(next.mq7Raw) >= th.mq7Danger;
    const coWarning = th.enableMq7 && Number(next.mq7Raw) >= th.mq7Warn;
    const tempHumid = th.enableDht22 &&
      ((hasNumber(next.temperatureC) && Number(next.temperatureC) >= th.tempHigh) ||
       (hasNumber(next.humidity) && Number(next.humidity) >= th.humidityHigh));
    const tempLow = th.enableDht22 && hasNumber(next.temperatureC) && Number(next.temperatureC) <= th.tempLow;
    const humidityLow = th.enableDht22 && hasNumber(next.humidity) && Number(next.humidity) <= th.humidityLow;
    const pressure = th.enableFsr && hasNumber(next.fsrRaw) && Number(next.fsrRaw) >= th.fsrPressure;
    const earthquake = th.enableSw420 && Number(next.vibrationRaw) >= th.earthquakeWarn;
    const warning = airWarning || smokeWarning || coWarning || tempHumid || tempLow || humidityLow || pressure;

    next.dark = th.enableBh1750 && Boolean(next.dark || (hasNumber(next.lux) && Number(next.lux) <= th.luxDark));
    next.bedOccupied = th.enableFsr && Boolean(next.bedOccupied || (hasNumber(next.fsrRaw) && Number(next.fsrRaw) >= th.bedPresenceRaw));
    next.nightWakeActive = Boolean(next.nightWakeActive || (next.dark && !next.bedOccupied && next.pirMotion));
    next.nightActivity = Boolean(next.nightActivity || (next.dark && next.pirMotion) || next.nightWakeActive);
    next.vibration = th.enableSw420 && Boolean(next.vibration || earthquake);
    next.alarmAny = Boolean(next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger || warning || next.vibration || noMotion);
    next.pushRequired = Boolean(next.pushRequired || next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger || noMotion);
    if (next.demoMode) {
      next.fanOn = Boolean(next.fanOn);
      next.ledOn = Boolean(next.ledOn);
      next.buzzerOn = Boolean(next.buzzerOn);
      next.servoActive = Boolean(next.servoActive);
      next.curtainClosed = Boolean(next.curtainClosed);
      next.darkLightOn = false;
      next.nightLightOn = false;
      next.nightWakeLightOn = false;
      next.alarmLightOn = Boolean(next.ledOn);
    } else {
      next.fanOn = Boolean(next.fanOn || coWarning || coDanger || smokeWarning || smokeDanger || airWarning || airDanger || tempHumid);
      next.darkLightOn = Boolean(next.darkLightOn || (next.dark && ctl.darkLight));
      next.nightLightOn = Boolean(next.nightLightOn || (next.nightActivity && ctl.nightLight));
      next.nightWakeLightOn = Boolean(next.nightWakeLightOn || (next.nightWakeActive && ctl.nightWakeLight));
      next.alarmLightOn = Boolean(next.alarmLightOn || (next.alarmAny && ctl.alarmLight));
      next.ledOn = Boolean(next.ledOn || next.darkLightOn || next.nightLightOn || next.nightWakeLightOn || next.alarmLightOn);
    }

    if (earthquake) {
      next.dangerLevel = 'critical';
      next.alarmText = 'EARTHQUAKE';
    } else if (coDanger) {
      next.dangerLevel = 'co_critical';
      next.alarmText = 'CO DANGER';
    } else if (next.fallDetected) {
      next.dangerLevel = 'critical';
      next.alarmText = 'FALL DETECTED';
    } else if (next.sos) {
      next.dangerLevel = 'critical';
      next.alarmText = 'SOS BUTTON';
    } else if (smokeDanger) {
      next.dangerLevel = 'danger';
      next.alarmText = 'SMOKE DANGER';
    } else if (airDanger) {
      next.dangerLevel = 'danger';
      next.alarmText = 'AIR DANGER';
    } else if (smokeWarning) {
      next.dangerLevel = 'warning';
      next.alarmText = 'SMOKE WARNING';
    } else if (coWarning) {
      next.dangerLevel = 'warning';
      next.alarmText = 'CO WARNING';
    } else if (airWarning) {
      next.dangerLevel = 'warning';
      next.alarmText = 'AIR WARNING';
    } else if (tempHumid) {
      next.dangerLevel = 'warning';
      next.alarmText = 'TEMP/HUMID';
    } else if (tempLow) {
      next.dangerLevel = 'warning';
      next.alarmText = 'TEMP LOW';
    } else if (humidityLow) {
      next.dangerLevel = 'warning';
      next.alarmText = 'HUMID LOW';
    } else if (pressure) {
      next.dangerLevel = 'warning';
      next.alarmText = 'PRESSURE';
    } else if (noMotion) {
      next.dangerLevel = 'warning';
      next.alarmText = 'NO MOTION';
    } else if (next.vibration) {
      next.dangerLevel = 'warning';
      next.alarmText = 'VIBRATION';
    } else if (next.nightActivity) {
      next.dangerLevel = 'activity';
      next.alarmText = 'NIGHT MOVE';
    } else {
      next.dangerLevel = 'normal';
      next.alarmText = 'NORMAL';
      next.alarmAny = false;
    }

    if (next.demoMode) {
      next.fanOn = Boolean(payload.fanOn);
      next.ledOn = Boolean(payload.ledOn);
      next.buzzerOn = Boolean(payload.buzzerOn);
      next.servoActive = Boolean(payload.servoActive);
      next.curtainClosed = Boolean(payload.curtainClosed);
      next.alarmLightOn = Boolean(payload.ledOn);
    }

    return next;
  }

  // 服务端入口：上报数据先归一化，再按当前配置推导完整遥测。
  function normalizeAndDeriveTelemetry(input, thresholds, controls, options) {
    return deriveTelemetry(normalizeTelemetry(input, options), thresholds, controls);
  }

  // 计算“实际生效”的联动状态，供 Web 状态页和健康检查复用。
  function effectiveLinkage(payload, controls) {
    const ctl = { ...createDefaultControls(), ...(controls || {}) };
    if (!payload) {
      return {
        darkLight: false,
        nightLight: false,
        curtain: false,
        curtainOpen: false,
        alarmLight: false,
        fan: false,
        buzzer: false,
        servo: false,
        servoStandby: true,
        noMotion: false,
        nightWakeLight: false
      };
    }

    const alarmActive = Boolean(payload.alarmAny || payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical');
    if (payload.demoMode) {
      return {
        darkLight: false,
        nightLight: false,
        nightWakeLight: false,
        curtain: Boolean(payload.curtainClosed),
        curtainOpen: !payload.curtainClosed,
        alarmLight: Boolean(payload.ledOn),
        fan: Boolean(payload.fanOn),
        buzzer: Boolean(payload.buzzerOn),
        servo: Boolean(payload.servoActive),
        servoStandby: !payload.servoActive,
        noMotion: Boolean((payload.noMotion || payload.alarmText === 'NO MOTION') && ctl.noMotionWarning)
      };
    }

    return {
      darkLight: Boolean(payload.dark) && ctl.darkLight,
      nightLight: Boolean(payload.nightActivity) && ctl.nightLight,
      nightWakeLight: Boolean(payload.nightWakeActive) && ctl.nightWakeLight,
      curtain: Boolean(payload.dark || payload.nightActivity) && ctl.curtainAuto,
      curtainOpen: !payload.dark && !payload.nightActivity && ctl.curtainAuto,
      alarmLight: Boolean(payload.alarmAny) && ctl.alarmLight,
      fan: Boolean(payload.fanOn) && ctl.fanVentilation,
      buzzer: alarmActive && ctl.buzzerAlarm,
      servo: Boolean(payload.servoActive || (payload.sos && ctl.sosServo)),
      servoStandby: !payload.servoActive,
      noMotion: Boolean((payload.noMotion || payload.alarmText === 'NO MOTION') && ctl.noMotionWarning)
    };
  }

  // 生成静态演示遥测：只刷新时间戳和运行时长，不再自动切换场景。
  function createDemoTelemetry(options) {
    const config = options || {};
    const timestampMs = config.timestampMs || Date.now();
    const source = {
      ...DEFAULT_DEMO_TELEMETRY,
      ...(config.demoData || {})
    };
    return normalizeAndDeriveTelemetry({
      ...source,
      demoMode: true,
      deviceName: config.deviceName || source.deviceName || 'demo-esp32',
      productKey: config.productKey || source.productKey || 'static-demo',
      uptimeMs: Number.isFinite(Number(source.uptimeMs)) ? Number(source.uptimeMs) : 0
    }, config.thresholds, config.controls, { timestamp: timestampMs });
  }

  return {
    DEFAULT_CONTROLS,
    DEFAULT_THRESHOLDS,
    DEFAULT_DEMO_TELEMETRY,
    createDefaultControls,
    createDefaultThresholds,
    createDefaultDemoTelemetry,
    normalizeThresholds,
    normalizeTelemetry,
    normalizeDemoTelemetry,
    deriveTelemetry,
    normalizeAndDeriveTelemetry,
    effectiveLinkage,
    createDemoTelemetry
  };
}));
