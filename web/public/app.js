const state = {
  latest: null,
  history: [],
  events: [],
  nightRecords: [],
  controls: {
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
  },
  thresholds: {
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
    fsrPressure: 2300
  },
  mock: {
    enabled: false
  },
  demoTimer: null,
  criticalMuteUntil: 0,
  criticalMutedType: ''
};

const $ = (id) => document.getElementById(id);

function alarmLabel(text) {
  const labels = {
    NORMAL: '正常',
    'CO DANGER': '一氧化碳高危',
    'FALL DETECTED': '疑似跌倒',
    'SOS BUTTON': '主动求助',
    EARTHQUAKE: '地震报警',
    'SMOKE DANGER': '烟雾/可燃气严重异常',
    'AIR DANGER': '空气严重异常',
    'SMOKE WARNING': '烟雾/可燃气异常',
    'CO WARNING': '一氧化碳偏高',
    'AIR WARNING': '空气质量异常',
    'TEMP/HUMID': '温湿度异常',
    'TEMP LOW': '温度过低',
    'HUMID LOW': '湿度过低',
    VIBRATION: '检测到振动',
    PRESSURE: '压力异常',
    'NO MOTION': '长时间无活动',
    'NIGHT MOVE': '夜间活动'
  };
  return labels[text] || text || '正常';
}

function eventTitleLabel(text) {
  const labels = {
    'CONTROL UPDATED': '联动开关已更新',
    'ALARM ACK': '告警已确认',
    'CO DANGER': '一氧化碳高危',
    'FALL DETECTED': '疑似跌倒',
    'SOS HELP': '主动求助',
    'NIGHT MOVE': '夜间活动'
  };
  return labels[text] || alarmLabel(text);
}

function dangerLabel(level) {
  const labels = {
    normal: '正常',
    activity: '活动提醒',
    warning: '注意',
    danger: '危险',
    critical: '紧急',
    co_critical: '一氧化碳高危'
  };
  return labels[level] || '--';
}

function criticalTypeOf(data) {
  if (!data) return '';
  if (data.dangerLevel === 'co_critical') return 'co_critical';
  if (data.alarmText === 'EARTHQUAKE') return 'earthquake';
  if (data.fallDetected) return 'fall';
  if (data.sos) return 'sos';
  return '';
}

function fmtNumber(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function yesNo(value) {
  return value ? '是' : '否';
}

function onOff(value) {
  return value ? '开启' : '关闭';
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function toggleClass(id, className, enabled) {
  const node = $(id);
  if (node) node.classList.toggle(className, enabled);
}

function toggleSelectorClass(selector, className, enabled) {
  const node = document.querySelector(selector);
  if (node) node.classList.toggle(className, enabled);
}

function setConnection(online, text) {
  toggleClass('connDot', 'online', online);
  setText('connText', text || (online ? '实时在线' : '等待数据'));
}

function effectiveLed(data) {
  if (!data) return false;
  if (data.darkLightOn || data.nightLightOn || data.nightWakeLightOn || data.alarmLightOn) return true;
  return (data.dark && state.controls.darkLight) ||
    (data.nightWakeActive && state.controls.nightWakeLight) ||
    (data.nightActivity && state.controls.nightLight) ||
    (data.alarmAny && state.controls.alarmLight);
}

function effectiveFan(data) {
  if (!data) return false;
  return Boolean(data.fanOn) && state.controls.fanVentilation;
}

function effectiveBuzzer(data) {
  if (!data) return false;
  return Boolean(data.alarmAny || data.sos || data.fallDetected || data.dangerLevel === 'co_critical') &&
    state.controls.buzzerAlarm;
}

function effectiveServo(data) {
  if (!data) return false;
  return Boolean(data.sos) && state.controls.sosServo;
}

function effectiveCurtain(data) {
  if (!data) return false;
  return Boolean(data.dark || data.nightActivity) && state.controls.curtainAuto;
}

function effectiveNoMotion(data) {
  if (!data) return false;
  return data.alarmText === 'NO MOTION' && state.controls.noMotionWarning;
}

function linkageStatus(data = state.latest) {
  return {
    darkLight: data?.darkLightOn ?? (Boolean(data?.dark) && state.controls.darkLight),
    nightLight: data?.nightLightOn ?? (Boolean(data?.nightActivity) && state.controls.nightLight),
    nightWakeLight: data?.nightWakeLightOn ?? (effectiveLed(data) && Boolean(data?.nightWakeActive)),
    curtain: effectiveCurtain(data),
    alarmLight: data?.alarmLightOn ?? (effectiveLed(data) && Boolean(data?.alarmAny)),
    fan: effectiveFan(data),
    buzzer: effectiveBuzzer(data),
    servo: effectiveServo(data),
    noMotion: effectiveNoMotion(data)
  };
}

function renderLatest(data) {
  if (!data) {
    setConnection(false);
    return;
  }

  setConnection(true);
  const critical = Boolean(data.sos || data.fallDetected || data.dangerLevel === 'co_critical' || data.alarmText === 'EARTHQUAKE');
  const criticalType = criticalTypeOf(data);
  const muted = critical && state.criticalMutedType === criticalType && Date.now() < state.criticalMuteUntil;
  const activeCritical = critical && !muted;
  const activeAlarm = Boolean(data.alarmAny && !muted);
  toggleClass('statusPanel', 'warn', Boolean(data.alarmAny || data.sos));
  toggleClass('statusPanel', 'critical', activeCritical);
  toggleSelectorClass('.topbar', 'critical-active', activeCritical);
  toggleClass('alertStrip', 'warning', Boolean((data.alarmAny || muted) && !activeCritical));
  toggleClass('alertStrip', 'danger', activeCritical);
  setText('alarmText', alarmLabel(data.alarmText));
  setText('deviceText', `${data.deviceName || '--'} ${data.productKey ? ` | ${data.productKey}` : ''}`);
  setText('temperature', fmtNumber(data.temperatureC));
  setText('humidity', fmtNumber(data.humidity, 0));
  setText('lux', fmtNumber(data.lux, 0));
  setText('mq2Hero', data.mq2Raw ?? '--');
  setText('mq135Hero', data.mq135Raw ?? '--');
  setText('mq7Hero', data.mq7Raw ?? '--');
  setText('mq2', data.mq2Raw ?? '--');
  setText('mq135', data.mq135Raw ?? '--');
  setText('mq7', data.mq7Raw ?? '--');
  setText('fsr', data.fsrRaw ?? '--');
  setText('vibrationRaw', data.vibrationRaw ?? '--');
  setText('pir', yesNo(data.pirMotion));
  setText('vibration', yesNo(data.vibration));
  setText('sos', yesNo(data.sos));
  setText('fallDetected', yesNo(data.fallDetected));
  setText('nightActivity', yesNo(data.nightActivity));
  setText('bedOccupied', yesNo(data.bedOccupied));
  setText('nightWakeActive', yesNo(data.nightWakeActive));
  setText('dark', yesNo(data.dark));
  setText('ledOn', onOff(effectiveLed(data)));
  setText('fanOn', onOff(effectiveFan(data)));
  setText('buzzerOn', onOff(effectiveBuzzer(data)));
  setText('servoOn', effectiveServo(data) ? '动作' : '复位');
  setText('curtainOn', effectiveCurtain(data) ? '关闭' : '待机');
  setText('sosPill', data.sos ? 'SOS 已触发' : 'SOS 正常');
  setText('fallPill', data.fallDetected ? '疑似跌倒' : '跌倒正常');
  setText('nightPill', data.nightActivity ? '起夜开灯中' : '未检测起夜');
  toggleClass('sosPill', 'critical', Boolean(data.sos));
  toggleClass('fallPill', 'critical', Boolean(data.fallDetected));
  setText('updatedAt', new Date(data.timestamp).toLocaleString());
  renderOperationalSummary(data);
  renderAlertSummary(data, activeCritical, muted);
  renderDangerCards(data);
  renderTopBanner(data, activeAlarm, muted);
  renderAutomationPage(data);

  if ($('ackCritical')) $('ackCritical').hidden = !activeAlarm;
}

function renderAlertSummary(data, critical, muted = false) {
  const alertIcon = $('alertIcon');
  if (muted) {
    setText('alertIcon', '!');
    setText('alertHeadline', '告警已确认');
    setText('alertMessage', `${alarmLabel(data.alarmText)}仍在持续，5 分钟内不再弹出同类强提醒。`);
    return;
  }

  if (critical) {
    setText('alertIcon', data.alarmText === 'EARTHQUAKE' ? '震' : data.dangerLevel === 'co_critical' ? 'CO' : data.fallDetected ? '↯' : '!');
    setText('alertHeadline', alarmLabel(data.alarmText) || '高危报警');
    if (data.alarmText === 'EARTHQUAKE') setText('alertMessage', '检测到强震动，疑似地震或剧烈撞击，请立即查看现场。');
    else if (data.dangerLevel === 'co_critical') setText('alertMessage', '一氧化碳超标，已启动最高优先级联动。');
    else if (data.fallDetected) setText('alertMessage', '疑似老人跌倒，请立即查看现场。');
    else if (data.sos) setText('alertMessage', '老人主动求助，请立即处理。');
    else setText('alertMessage', '检测到高危事件，请立即确认。');
    return;
  }

  if (data.alarmAny) {
    setText('alertIcon', '!');
    setText('alertHeadline', alarmLabel(data.alarmText) || '环境异常');
    setText('alertMessage', '系统检测到异常状态，已记录事件并执行本地联动。');
    return;
  }

  if (data.nightActivity) {
    setText('alertIcon', '☾');
    setText('alertHeadline', '夜间活动');
    setText('alertMessage', '暗环境检测到人体活动，已联动开灯。');
    return;
  }

  setText('alertIcon', '✓');
  setText('alertHeadline', '系统运行正常');
  setText('alertMessage', '暂无危险报警，持续监测老人活动和居家环境。');
}

function renderTopBanner(data, critical, muted = false) {
  const banner = $('criticalBanner');
  if (!banner) return;
  banner.hidden = false;
  banner.classList.toggle('danger', critical);
  banner.classList.toggle('safe', !critical);
  if (critical) {
    setText('criticalIcon', data.alarmText === 'EARTHQUAKE' ? '震' : data.dangerLevel === 'co_critical' ? 'CO' : data.fallDetected ? '↯' : '!');
    setText('criticalTitle', alarmLabel(data.alarmText) || '危险报警');
    if (data.alarmText === 'EARTHQUAKE') setText('criticalText', '震动量超过地震报警阈值，请立即确认老人和环境安全。');
    else if (data.dangerLevel === 'co_critical') setText('criticalText', 'CO 超过危险阈值，已进入红色闪烁提醒。');
    else if (data.fallDetected) setText('criticalText', '检测到老人可能跌倒，请立即查看现场。');
    else if (data.sos) setText('criticalText', '老人按下 SOS，请立即联系或到场处理。');
    else setText('criticalText', '传感器超过设置阈值，请查看对应监测卡片。');
    return;
  }

  setText('criticalIcon', muted ? '!' : '✓');
  setText('criticalTitle', muted ? '告警已确认' : '系统安全');
  setText('criticalText', muted ? `${alarmLabel(data.alarmText)}仍在持续监测。` : '暂无危险报警，设备正在持续监测。');
}

function renderOperationalSummary(data) {
  const score = data.sos || data.fallDetected || data.dangerLevel === 'co_critical' || data.alarmText === 'EARTHQUAKE'
    ? 96
    : data.alarmAny
      ? 68
      : data.nightActivity
        ? 34
        : 12;
  setText('riskScore', score);
  setText('riskLevel', dangerLabel(data.dangerLevel));
  setText('riskReason', data.alarmAny || data.nightActivity ? alarmLabel(data.alarmText) : '当前无危险报警。');
  setText('uptime', formatUptime(data.uptimeMs));
  setText('sampleCount', state.history.length);
  setText('pushRequired', data.pushRequired ? '需要' : '不需要');
  setText('dangerLevel', dangerLabel(data.dangerLevel));
  setText('cloudStatus', '已接收');
  setText('cloudProduct', data.productKey || '--');
  setText('cloudDeviceName', data.deviceName || '--');
  setText('lastSeen', new Date(data.timestamp).toLocaleTimeString());
  if ($('riskBar')) $('riskBar').style.width = `${score}%`;
}

function formatUptime(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}小时${minutes % 60}分`;
  if (minutes > 0) return `${minutes}分${seconds % 60}秒`;
  return `${seconds}秒`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes > 0) return `${minutes}分${rest}秒`;
  return `${rest}秒`;
}

function renderDangerCards(data) {
  const airCard = document.querySelector('.air-card');
  const smokeCard = document.querySelector('.smoke-card');
  const coCard = document.querySelector('.co-card');
  if (!airCard || !smokeCard || !coCard) return;
  const air = Number(data.mq135Raw) || 0;
  const smoke = Number(data.mq2Raw) || 0;
  const co = Number(data.mq7Raw) || 0;
  const th = state.thresholds;
  airCard.classList.toggle('warning', th.enableMq135 && air >= th.mq135Warn && air < th.mq135Danger);
  airCard.classList.toggle('danger', th.enableMq135 && air >= th.mq135Danger);
  smokeCard.classList.toggle('warning', th.enableMq2 && smoke >= th.mq2Warn && smoke < th.mq2Danger);
  smokeCard.classList.toggle('danger', th.enableMq2 && smoke >= th.mq2Danger);
  coCard.classList.toggle('warning', th.enableMq7 && co >= th.mq7Warn && co < th.mq7Danger);
  coCard.classList.toggle('danger', th.enableMq7 && co >= th.mq7Danger);
  setText('airHint', !th.enableMq135 ? '传感器已停用' : air >= th.mq135Danger ? '严重异常，建议通风' : air >= th.mq135Warn ? '轻度异常，持续观察' : '空气质量正常');
  setText('smokeHint', !th.enableMq2 ? '传感器已停用' : smoke >= th.mq2Danger ? '烟雾/可燃气危险，立即通风' : smoke >= th.mq2Warn ? '烟雾/可燃气偏高' : '烟雾/可燃气正常');
  setText('coHint', !th.enableMq7 ? '传感器已停用' : co >= th.mq7Danger ? 'CO 高危，立即处理' : co >= th.mq7Warn ? 'CO 偏高，注意通风' : '一氧化碳安全');
}

function deriveAlarm(data) {
  const th = state.thresholds;
  const next = { ...data };
  next.pirMotion = th.enablePir && next.pirMotion;
  next.sos = th.enableSos && next.sos;
  const airDanger = th.enableMq135 && Number(next.mq135Raw) >= th.mq135Danger;
  const airWarning = th.enableMq135 && Number(next.mq135Raw) >= th.mq135Warn;
  const smokeDanger = th.enableMq2 && Number(next.mq2Raw) >= th.mq2Danger;
  const smokeWarning = th.enableMq2 && Number(next.mq2Raw) >= th.mq2Warn;
  const coDanger = th.enableMq7 && Number(next.mq7Raw) >= th.mq7Danger;
  const coWarning = th.enableMq7 && Number(next.mq7Raw) >= th.mq7Warn;
  const tempHumid = th.enableDht22 && (Number(next.temperatureC) >= th.tempHigh || Number(next.humidity) >= th.humidityHigh);
  const tempLow = th.enableDht22 && Number(next.temperatureC) <= th.tempLow;
  const humidityLow = th.enableDht22 && Number(next.humidity) <= th.humidityLow;
  const pressure = th.enableFsr && Number(next.fsrRaw) >= th.fsrPressure;
  const earthquake = th.enableSw420 && Number(next.vibrationRaw) >= th.earthquakeWarn;
  const warning = airWarning || smokeWarning || coWarning || tempHumid || tempLow || humidityLow || pressure;

  next.dark = th.enableBh1750 && Boolean(next.dark || Number(next.lux) <= th.luxDark);
  next.bedOccupied = th.enableFsr && Boolean(next.bedOccupied || Number(next.fsrRaw) >= th.bedPresenceRaw);
  next.nightWakeActive = Boolean(next.nightWakeActive || (next.dark && !next.bedOccupied && next.pirMotion));
  next.nightActivity = Boolean(next.nightActivity || (next.dark && next.pirMotion) || next.nightWakeActive);
  next.vibration = th.enableSw420 && Boolean(next.vibration || earthquake);
  next.alarmAny = Boolean(next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger || warning || next.vibration);
  next.pushRequired = Boolean(next.pushRequired || next.sos || next.fallDetected || earthquake || coDanger || smokeDanger || airDanger);
  next.fanOn = Boolean(next.fanOn || coDanger || smokeDanger || airDanger || tempHumid);
  next.darkLightOn = Boolean(next.darkLightOn || (next.dark && state.controls.darkLight));
  next.nightLightOn = Boolean(next.nightLightOn || (next.nightActivity && state.controls.nightLight));
  next.nightWakeLightOn = Boolean(next.nightWakeLightOn || (next.nightWakeActive && state.controls.nightWakeLight));
  next.alarmLightOn = Boolean(next.alarmLightOn || (next.alarmAny && state.controls.alarmLight));
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

function drawTrend() {
  const canvas = $('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, Math.round(rect.width || 960));
  const cssHeight = Math.max(220, Math.round(rect.height || 260));
  const targetWidth = Math.round(cssWidth * ratio);
  const targetHeight = Math.round(cssHeight * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = canvas.width;
  const height = canvas.height;
  const drawWidth = cssWidth;
  const drawHeight = cssHeight;
  const pad = 28;
  const rows = state.history.slice(-60);

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, drawWidth, drawHeight);
  ctx.strokeStyle = '#d6e0ea';
  ctx.lineWidth = 1;

  const lanes = [
    { key: 'temperatureC', label: '温度', color: '#b42318', min: 0, max: 45, unit: 'C' },
    { key: 'humidity', label: '湿度', color: '#2459c9', min: 0, max: 100, unit: '%' },
    { key: 'lux', label: '光照', color: '#b54708', min: 0, max: Math.max(...rows.map((r) => Number(r.lux) || 0), 120), unit: 'Lux' }
  ];
  const laneHeight = (drawHeight - pad * 2) / lanes.length;

  for (let i = 0; i <= lanes.length; i += 1) {
    const y = pad + laneHeight * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(drawWidth - pad, y);
    ctx.stroke();
  }

  if (rows.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '16px Microsoft YaHei';
    ctx.fillText('等待设备数据...', pad, drawHeight / 2);
    return;
  }

  function plot(lane, laneIndex) {
    const top = pad + laneHeight * laneIndex;
    const bottom = top + laneHeight;
    const latest = rows[rows.length - 1];
    ctx.fillStyle = lane.color;
    ctx.font = '13px Microsoft YaHei';
    ctx.fillText(`${lane.label} ${fmtNumber(latest[lane.key], lane.key === 'lux' ? 0 : 1)}${lane.unit}`, pad, top + 18);
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = pad + ((drawWidth - pad * 2) * index) / (rows.length - 1);
      const raw = Number(row[lane.key]) || 0;
      const ratio = Math.max(0, Math.min(1, (raw - lane.min) / (lane.max - lane.min || 1)));
      const y = bottom - 14 - ratio * (laneHeight - 30);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  lanes.forEach(plot);
}

function renderEvents() {
  const box = $('events');
  if (!box) return;
  setText('eventCount', `${state.events.length} 条`);

  if (!state.events.length) {
    box.innerHTML = '<div class="event"><strong>暂无事件</strong><p>等待起夜、告警或状态变化。</p></div>';
    return;
  }

  box.innerHTML = state.events
    .slice(0, 20)
    .map((event) => `
      <div class="event ${event.type}">
        <strong>${event.type === 'critical' ? '紧急：' : ''}${eventTitleLabel(event.title)}</strong>
        <p>${event.detail}</p>
        <span>${new Date(event.timestamp).toLocaleString()}</span>
      </div>
    `)
    .join('');
}

function renderNightRecords() {
  const box = $('nightRecords');
  if (!box) return;

  if (!state.nightRecords.length) {
    box.innerHTML = '<tr><td colspan="4">暂无起夜记录</td></tr>';
    return;
  }

  box.innerHTML = state.nightRecords
    .slice(0, 10)
    .map((record) => {
      const outTime = record.outOfBedAt ? new Date(record.outOfBedAt).toLocaleString() : '--';
      const backTime = record.backToBedAt ? new Date(record.backToBedAt).toLocaleString() : '未回床';
      const duration = Number.isFinite(Number(record.durationSec)) ? formatDuration(record.durationSec) : '--';
      return `
        <tr>
          <td>${outTime}</td>
          <td>${backTime}</td>
          <td>${duration}</td>
          <td>${record.lightOn ? '已开灯' : '未开灯'}</td>
        </tr>
      `;
    })
    .join('');
}

function renderControls() {
  document.querySelectorAll('[data-control]').forEach((input) => {
    input.checked = Boolean(state.controls[input.dataset.control]);
  });
  renderDemoButton();
  renderLatest(state.latest);
  renderAutomationPage(state.latest);
}

function renderDemoButton() {
  const button = $('demoButton');
  if (!button) return;
  const enabled = location.protocol === 'file:' ? Boolean(state.demoTimer) : Boolean(state.mock.enabled);
  const label = button.querySelector('strong');
  if (label) label.textContent = enabled ? '开启' : '关闭';
  button.classList.toggle('active', enabled);
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function renderThresholds() {
  document.querySelectorAll('[data-threshold]').forEach((input) => {
    input.value = state.thresholds[input.dataset.threshold] ?? '';
  });
  document.querySelectorAll('[data-sensor]').forEach((input) => {
    input.checked = Boolean(state.thresholds[input.dataset.sensor]);
  });
  renderLatest(state.latest);
}

async function saveControls() {
  if (location.protocol === 'file:') {
    localStorage.setItem('elderMonitorControls', JSON.stringify(state.controls));
    addLocalEvent('CONTROL UPDATED', '本地演示模式下联动开关已更新');
    renderControls();
    return;
  }

  const response = await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.controls)
  });
  state.controls = await response.json();
  renderControls();
}

function normalizeThresholdInput(input) {
  const next = { ...state.thresholds };
  for (const key of Object.keys(next)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      if (typeof next[key] === 'boolean') {
        next[key] = Boolean(input[key]);
        continue;
      }
      const value = Number(input[key]);
      if (Number.isFinite(value)) next[key] = value;
    }
  }

  const pairs = [
    ['mq135Warn', 'mq135Danger'],
    ['mq2Warn', 'mq2Danger'],
    ['mq7Warn', 'mq7Danger'],
    ['tempLow', 'tempHigh'],
    ['humidityLow', 'humidityHigh']
  ];
  pairs.forEach(([low, high]) => {
    if (Number(next[low]) > Number(next[high])) {
      const temp = next[low];
      next[low] = next[high];
      next[high] = temp;
    }
  });
  return next;
}

function readThresholdForm() {
  const values = {};
  document.querySelectorAll('[data-threshold]').forEach((input) => {
    values[input.dataset.threshold] = input.value;
  });
  document.querySelectorAll('[data-sensor]').forEach((input) => {
    values[input.dataset.sensor] = input.checked;
  });
  return normalizeThresholdInput(values);
}

function setSettingsStatus(text) {
  setText('settingsStatus', text);
}

async function saveThresholds(nextThresholds) {
  state.thresholds = normalizeThresholdInput(nextThresholds);
  if (location.protocol === 'file:') {
    localStorage.setItem('elderMonitorThresholds', JSON.stringify(state.thresholds));
    setSettingsStatus('本地已保存');
    addLocalEvent('CONTROL UPDATED', '本地演示模式下传感器阈值已更新');
    renderThresholds();
    return;
  }

  const response = await fetch('/api/thresholds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.thresholds)
  });
  state.thresholds = await response.json();
  setSettingsStatus('已保存');
  renderThresholds();
}

function resetThresholds() {
  return saveThresholds({
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
    fsrPressure: 2300
  });
}

function addLocalEvent(title, detail, type = 'status') {
  state.events.unshift({
    timestamp: new Date().toISOString(),
    type,
    title,
    detail
  });
  state.events = state.events.slice(0, 80);
  renderEvents();
}

function handleTelemetry(data) {
  state.latest = data ? deriveAlarm(data) : data;
  renderLatest(state.latest);
}

function handleHistory(history) {
  state.history = Array.isArray(history) ? history : [];
  drawTrend();
}

function handleEvents(events) {
  state.events = Array.isArray(events) ? events : [];
  renderEvents();
}

function handleNightRecords(records) {
  state.nightRecords = Array.isArray(records) ? records : [];
  renderNightRecords();
}

function handleControls(controls) {
  state.controls = { ...state.controls, ...(controls || {}) };
  renderControls();
}

function handleMock(mock) {
  state.mock = { enabled: Boolean(mock?.enabled) };
  renderDemoButton();
  if (!state.mock.enabled && !state.latest) setConnection(false, '等待数据');
}

async function toggleServerDemo() {
  const response = await fetch('/api/mock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !state.mock.enabled })
  });
  handleMock(await response.json());
}

function renderAutomationPage(data) {
  if (!$('automationGrid')) return;
  const status = linkageStatus(data);
  const online = Boolean(data);
  const rows = [
    ['darkLightState', status.darkLight ? '开启' : '关闭'],
    ['darkLightDetailState', status.darkLight ? '开启' : '关闭'],
    ['nightLightState', status.nightLight ? '开启' : '关闭'],
    ['nightLightDetailState', status.nightLight ? '开启' : '关闭'],
    ['nightWakeLightState', status.nightWakeLight ? '开启' : '关闭'],
    ['curtainState', status.curtain ? '关闭' : '待机'],
    ['alarmLightState', status.alarmLight ? '开启' : '关闭'],
    ['buzzerState', status.buzzer ? '开启' : '关闭'],
    ['servoState', status.servo ? '动作' : '复位'],
    ['fanState', status.fan ? '开启' : '关闭'],
    ['noMotionState', status.noMotion ? '提醒' : '待机'],
    ['automationUpdatedAt', data?.timestamp ? new Date(data.timestamp).toLocaleString() : '--']
  ];
  rows.forEach(([id, value]) => setText(id, value));
  setText('automationSummary', online ? `当前危险等级：${dangerLabel(data.dangerLevel)}，主告警：${alarmLabel(data.alarmText)}` : '等待设备数据或启动演示数据。');
  document.querySelectorAll('[data-status-key]').forEach((node) => {
    const active = Boolean(status[node.dataset.statusKey]);
    node.classList.toggle('active', active);
    node.classList.toggle('inactive', !active);
  });
}

function handleThresholds(thresholds) {
  state.thresholds = normalizeThresholdInput(thresholds || {});
  renderThresholds();
}

function connectStream() {
  if (location.protocol === 'file:') {
    startDemo();
    return;
  }

  const stream = new EventSource('/api/stream');
  stream.addEventListener('open', () => setConnection(Boolean(state.latest)));
  stream.addEventListener('telemetry', (event) => handleTelemetry(JSON.parse(event.data)));
  stream.addEventListener('history', (event) => handleHistory(JSON.parse(event.data)));
  stream.addEventListener('events', (event) => handleEvents(JSON.parse(event.data)));
  stream.addEventListener('nightRecords', (event) => handleNightRecords(JSON.parse(event.data)));
  stream.addEventListener('controls', (event) => handleControls(JSON.parse(event.data)));
  stream.addEventListener('thresholds', (event) => handleThresholds(JSON.parse(event.data)));
  stream.addEventListener('mock', (event) => handleMock(JSON.parse(event.data)));
  stream.addEventListener('error', () => setConnection(false, '连接中断'));
}

function demoPayload() {
  const t = Date.now() / 1000;
  const nightActivity = Math.floor(t / 18) % 4 === 1;
  const bedOccupied = Math.floor(t / 18) % 4 !== 1;
  const sos = Math.floor(t / 40) % 6 === 2;
  const fallDetected = Math.floor(t / 55) % 7 === 3;
  const coDanger = Math.floor(t / 70) % 8 === 4;
  const smokeDanger = Math.floor(t / 50) % 7 === 3;
  const earthquake = Math.floor(t / 90) % 8 === 5;
  const alarmAny = sos || fallDetected || coDanger || smokeDanger || earthquake;
  return {
    timestamp: new Date().toISOString(),
    deviceName: 'demo-esp32',
    productKey: 'local-demo',
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
  };
}

function tickDemo() {
  const payload = demoPayload();
  const previous = state.latest;
  state.history.push(payload);
  state.history = state.history.slice(-240);
  handleTelemetry(payload);
  drawTrend();
  updateLocalNightRecords(previous, payload);

  if (payload.dangerLevel === 'co_critical') addLocalEvent('CO DANGER', '本地演示：一氧化碳超标，最高优先级联动', 'critical');
  else if (payload.fallDetected) addLocalEvent('FALL DETECTED', '本地演示：疑似老人跌倒，请立即查看现场', 'critical');
  else if (payload.sos) addLocalEvent('SOS HELP', '本地演示：老人主动求助，请立即处理', 'critical');
  else if (payload.nightActivity) addLocalEvent('NIGHT MOVE', '本地演示：暗环境检测到人，联动开灯', 'activity');
}

function updateLocalNightRecords(previous, payload) {
  if (location.protocol !== 'file:' || !state.controls.nightWakeMonitor || !previous) return;
  const leftBed = previous.bedOccupied && !payload.bedOccupied && payload.dark;
  const backToBed = !previous.bedOccupied && payload.bedOccupied;
  if (leftBed) {
    state.nightRecords.unshift({
      id: `${Date.now()}`,
      outOfBedAt: payload.timestamp,
      backToBedAt: null,
      durationSec: null,
      lightOn: Boolean(payload.pirMotion && state.controls.nightWakeLight),
      reason: '本地演示'
    });
  }
  if (backToBed && state.nightRecords[0] && !state.nightRecords[0].backToBedAt) {
    state.nightRecords[0].backToBedAt = payload.timestamp;
    state.nightRecords[0].durationSec = Math.max(0, Math.round((new Date(payload.timestamp) - new Date(state.nightRecords[0].outOfBedAt)) / 1000));
  }
  state.nightRecords = state.nightRecords.slice(0, 60);
  renderNightRecords();
}

function startDemo() {
  if (state.demoTimer) return;
  setConnection(true, '本地演示');
  tickDemo();
  state.demoTimer = setInterval(tickDemo, 2500);
  renderDemoButton();
}

function stopLocalDemo() {
  if (!state.demoTimer) return;
  clearInterval(state.demoTimer);
  state.demoTimer = null;
  setConnection(Boolean(state.latest), state.latest ? '实时在线' : '等待数据');
  renderDemoButton();
}

function toggleLocalDemo() {
  if (state.demoTimer) {
    stopLocalDemo();
    return;
  }
  startDemo();
}

async function handleDemoButtonClick() {
  if (location.protocol === 'file:') {
    toggleLocalDemo();
    return;
  }
  await toggleServerDemo();
}

function bindControls() {
  document.querySelectorAll('[data-control]').forEach((input) => {
    input.addEventListener('change', async () => {
      state.controls[input.dataset.control] = input.checked;
      await saveControls();
    });
  });

  if ($('thresholdForm')) {
    $('thresholdForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveThresholds(readThresholdForm());
    });
  }

  if ($('resetThresholds')) {
    $('resetThresholds').addEventListener('click', async () => {
      await resetThresholds();
    });
  }

  if ($('demoButton')) {
    $('demoButton').addEventListener('click', handleDemoButtonClick);
  }

  if ($('themeButton')) {
    $('themeButton').addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
    });
  }

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const target = document.getElementById(button.dataset.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if ($('ackCritical')) {
    $('ackCritical').addEventListener('click', () => {
      if (state.latest) {
        state.criticalMutedType = criticalTypeOf(state.latest);
        state.criticalMuteUntil = Date.now() + 5 * 60 * 1000;
      }
      renderLatest(state.latest);
      addLocalEvent('ALARM ACK', '已确认当前紧急提醒，5 分钟内同类提醒不再弹出。', 'status');
    });
  }
}

renderLatest(null);
if ($('trendChart')) drawTrend();
renderEvents();
renderNightRecords();
renderControls();
if (location.protocol === 'file:') {
  try {
    state.controls = { ...state.controls, ...JSON.parse(localStorage.getItem('elderMonitorControls') || '{}') };
    renderControls();
  } catch (error) {
    renderControls();
  }
  try {
    handleThresholds(JSON.parse(localStorage.getItem('elderMonitorThresholds') || '{}'));
    setSettingsStatus('本地设置');
  } catch (error) {
    renderThresholds();
  }
} else {
  fetch('/api/thresholds')
    .then((response) => response.json())
    .then(handleThresholds)
    .catch(() => renderThresholds());
}
bindControls();
connectStream();
window.addEventListener('resize', () => {
  if ($('trendChart')) drawTrend();
});
