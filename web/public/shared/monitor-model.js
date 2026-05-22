(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MonitorModel = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_CONTROLS = Object.freeze({
    darkLight: true,
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

  function cloneDefaults(source) {
    return { ...source };
  }

  function createDefaultControls() {
    return cloneDefaults(DEFAULT_CONTROLS);
  }

  function createDefaultThresholds() {
    return cloneDefaults(DEFAULT_THRESHOLDS);
  }

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

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hasNumber(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(Number(value));
  }

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
      fsrRaw: Number(source.fsrRaw ?? 0),
      vibrationRaw: Number(source.vibrationRaw ?? (source.vibration ? 4095 : 0)),
      pirMotion: Boolean(source.pirMotion),
      vibration: Boolean(source.vibration),
      sos: Boolean(source.sos),
      fallDetected: Boolean(source.fallDetected ?? source.fall ?? false),
      dark: Boolean(source.dark),
      bedOccupied: Boolean(source.bedOccupied ?? false),
      nightWakeActive: Boolean(source.nightWakeActive ?? false),
      nightActivity: Boolean(source.nightActivity),
      alarmAny: Boolean(source.alarmAny),
      pushRequired: Boolean(source.pushRequired),
      fanOn: Boolean(source.fanOn),
      ledOn: Boolean(source.ledOn),
      darkLightOn: Boolean(source.darkLightOn),
      nightLightOn: Boolean(source.nightLightOn),
      nightWakeLightOn: Boolean(source.nightWakeLightOn),
      alarmLightOn: Boolean(source.alarmLightOn),
      dangerLevel: String(source.dangerLevel || 'normal'),
      alarmText: String(source.alarmText || 'NORMAL'),
      uptimeMs: Number(source.uptimeMs ?? 0)
    };
  }

  function deriveTelemetry(payload, thresholds, controls) {
    const th = normalizeThresholds(thresholds);
    const ctl = { ...createDefaultControls(), ...(controls || {}) };
    const next = { ...payload };

    next.pirMotion = th.enablePir && next.pirMotion;
    next.sos = th.enableSos && next.sos;

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
    const pressure = th.enableFsr && Number(next.fsrRaw) >= th.fsrPressure;
    const earthquake = th.enableSw420 && Number(next.vibrationRaw) >= th.earthquakeWarn;
    const warning = airWarning || smokeWarning || coWarning || tempHumid || tempLow || humidityLow || pressure;

    next.dark = th.enableBh1750 && Boolean(next.dark || (hasNumber(next.lux) && Number(next.lux) <= th.luxDark));
    next.bedOccupied = th.enableFsr && Boolean(next.bedOccupied || Number(next.fsrRaw) >= th.bedPresenceRaw);
    next.nightWakeActive = Boolean(next.nightWakeActive || (next.dark && !next.bedOccupied && next.pirMotion));
    next.nightActivity = Boolean(next.nightActivity || (next.dark && next.pirMotion) || next.nightWakeActive);
    next.vibration = th.enableSw420 && Boolean(next.vibration || earthquake);
    next.alarmAny = Boolean(next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger || warning || next.vibration);
    next.pushRequired = Boolean(next.pushRequired || next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger);
    next.fanOn = Boolean(next.fanOn || coDanger || smokeDanger || airDanger || tempHumid);
    next.darkLightOn = Boolean(next.darkLightOn || (next.dark && ctl.darkLight));
    next.nightLightOn = Boolean(next.nightLightOn || (next.nightActivity && ctl.nightLight));
    next.nightWakeLightOn = Boolean(next.nightWakeLightOn || (next.nightWakeActive && ctl.nightWakeLight));
    next.alarmLightOn = Boolean(next.alarmLightOn || (next.alarmAny && ctl.alarmLight));
    next.ledOn = Boolean(next.ledOn || next.darkLightOn || next.nightLightOn || next.nightWakeLightOn || next.alarmLightOn);

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

    return next;
  }

  function normalizeAndDeriveTelemetry(input, thresholds, controls, options) {
    return deriveTelemetry(normalizeTelemetry(input, options), thresholds, controls);
  }

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
        noMotion: false,
        nightWakeLight: false
      };
    }

    const alarmActive = Boolean(payload.alarmAny || payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical');
    return {
      darkLight: Boolean(payload.dark) && ctl.darkLight,
      nightLight: Boolean(payload.nightActivity) && ctl.nightLight,
      nightWakeLight: Boolean(payload.nightWakeActive) && ctl.nightWakeLight,
      curtain: Boolean(payload.dark || payload.nightActivity) && ctl.curtainAuto,
      curtainOpen: !payload.dark && !payload.nightActivity && ctl.curtainAuto,
      alarmLight: Boolean(payload.alarmAny) && ctl.alarmLight,
      fan: Boolean(payload.fanOn) && ctl.fanVentilation,
      buzzer: alarmActive && ctl.buzzerAlarm,
      servo: Boolean(payload.sos) && ctl.sosServo,
      noMotion: payload.alarmText === 'NO MOTION' && ctl.noMotionWarning
    };
  }

  function createDemoTelemetry(options) {
    const config = options || {};
    const timestampMs = config.timestampMs || Date.now();
    const t = timestampMs / 1000;
    const nightActivity = Math.floor(t / 18) % 4 === 1;
    const bedOccupied = Math.floor(t / 18) % 4 !== 1;
    const sos = Math.floor(t / 40) % 6 === 2;
    const fallDetected = Math.floor(t / 55) % 7 === 3;
    const coDanger = Math.floor(t / 70) % 8 === 4;
    const smokeDanger = Math.floor(t / 50) % 7 === 3;
    const earthquake = Math.floor(t / 90) % 8 === 5;
    const alarmAny = sos || fallDetected || coDanger || smokeDanger || earthquake;

    return normalizeAndDeriveTelemetry({
      deviceName: config.deviceName || 'demo-esp32',
      productKey: config.productKey || 'demo',
      temperatureC: 25 + Math.sin(t / 9) * 2.2,
      humidity: 58 + Math.cos(t / 12) * 8,
      lux: nightActivity ? 24 : 260 + Math.sin(t / 7) * 80,
      mq2Raw: smokeDanger ? 2600 : 1000 + Math.round(Math.sin(t / 11) * 130),
      mq135Raw: 1200 + Math.round(Math.sin(t / 10) * 120),
      mq7Raw: coDanger ? 2600 : 900 + Math.round(Math.cos(t / 8) * 100),
      vibrationRaw: earthquake ? 3400 : Math.max(0, 140 + Math.round(Math.sin(t / 6) * 80)),
      fsrRaw: bedOccupied ? 1700 : 320,
      pirMotion: nightActivity,
      vibration: earthquake,
      sos,
      fallDetected,
      dark: nightActivity,
      bedOccupied,
      nightWakeActive: nightActivity && !bedOccupied,
      nightActivity,
      alarmAny,
      pushRequired: alarmAny,
      fanOn: coDanger || smokeDanger,
      darkLightOn: nightActivity,
      nightLightOn: nightActivity,
      nightWakeLightOn: nightActivity && !bedOccupied,
      alarmLightOn: alarmAny,
      ledOn: nightActivity || alarmAny,
      dangerLevel: earthquake ? 'critical' : coDanger ? 'co_critical' : fallDetected || sos ? 'critical' : smokeDanger ? 'danger' : nightActivity ? 'activity' : 'normal',
      alarmText: earthquake ? 'EARTHQUAKE' : coDanger ? 'CO DANGER' : fallDetected ? 'FALL DETECTED' : sos ? 'SOS BUTTON' : smokeDanger ? 'SMOKE DANGER' : nightActivity ? 'NIGHT MOVE' : 'NORMAL',
      uptimeMs: Math.round(t * 1000)
    }, config.thresholds, config.controls, { timestamp: timestampMs });
  }

  return {
    DEFAULT_CONTROLS,
    DEFAULT_THRESHOLDS,
    createDefaultControls,
    createDefaultThresholds,
    normalizeThresholds,
    normalizeTelemetry,
    deriveTelemetry,
    normalizeAndDeriveTelemetry,
    effectiveLinkage,
    createDemoTelemetry
  };
}));
