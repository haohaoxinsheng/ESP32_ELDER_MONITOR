const state = {
  latest: null,
  history: [],
  events: [],
  controls: {
    nightLight: true,
    alarmLight: true,
    fanVentilation: true,
    buzzerAlarm: true,
    sosServo: true,
    noMotionWarning: true
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
    'AIR DANGER': '空气严重异常',
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

function setConnection(online, text) {
  $('connDot').classList.toggle('online', online);
  $('sideOnlineDot').classList.toggle('online', online);
  setText('connText', text || (online ? '实时在线' : '等待数据'));
  setText('sideOnlineText', online ? '设备在线' : '等待连接');
}

function effectiveLed(data) {
  if (!data) return false;
  return (data.nightActivity && state.controls.nightLight) ||
    (data.alarmAny && state.controls.alarmLight) ||
    Boolean(data.ledOn);
}

function effectiveFan(data) {
  if (!data) return false;
  return Boolean(data.fanOn) && state.controls.fanVentilation;
}

function renderLatest(data) {
  if (!data) {
    setConnection(false);
    return;
  }

  setConnection(true);
  const critical = Boolean(data.sos || data.fallDetected || data.dangerLevel === 'co_critical');
  const criticalType = criticalTypeOf(data);
  const muted = critical && state.criticalMutedType === criticalType && Date.now() < state.criticalMuteUntil;
  const activeCritical = critical && !muted;
  $('statusPanel').classList.toggle('warn', Boolean(data.alarmAny || data.sos));
  $('statusPanel').classList.toggle('critical', activeCritical);
  document.querySelector('.topbar').classList.toggle('critical-active', activeCritical);
  $('alertStrip').classList.toggle('warning', Boolean((data.alarmAny || muted) && !activeCritical));
  $('alertStrip').classList.toggle('danger', activeCritical);
  setText('alarmText', alarmLabel(data.alarmText));
  setText('deviceText', `${data.deviceName || '--'} ${data.productKey ? ` | ${data.productKey}` : ''}`);
  setText('sideDevice', data.deviceName || 'ESP32');
  setText('temperature', fmtNumber(data.temperatureC));
  setText('humidity', fmtNumber(data.humidity, 0));
  setText('lux', fmtNumber(data.lux, 0));
  setText('mq135Hero', data.mq135Raw ?? '--');
  setText('mq7Hero', data.mq7Raw ?? '--');
  setText('mq135', data.mq135Raw ?? '--');
  setText('mq7', data.mq7Raw ?? '--');
  setText('fsr', data.fsrRaw ?? '--');
  setText('pir', yesNo(data.pirMotion));
  setText('vibration', yesNo(data.vibration));
  setText('sos', yesNo(data.sos));
  setText('fallDetected', yesNo(data.fallDetected));
  setText('nightActivity', yesNo(data.nightActivity));
  setText('dark', yesNo(data.dark));
  setText('ledOn', onOff(effectiveLed(data)));
  setText('fanOn', onOff(effectiveFan(data)));
  setText('sosPill', data.sos ? 'SOS 已触发' : 'SOS 正常');
  setText('fallPill', data.fallDetected ? '疑似跌倒' : '跌倒正常');
  setText('nightPill', data.nightActivity ? '起夜开灯中' : '未检测起夜');
  $('sosPill').classList.toggle('critical', Boolean(data.sos));
  $('fallPill').classList.toggle('critical', Boolean(data.fallDetected));
  setText('updatedAt', new Date(data.timestamp).toLocaleString());
  renderOperationalSummary(data);
  renderAlertSummary(data, activeCritical, muted);
  renderDangerCards(data);

  const banner = $('criticalBanner');
  const shouldShowBanner = activeCritical;
  banner.hidden = !shouldShowBanner;
  if (shouldShowBanner) {
    setText('criticalTitle', data.dangerLevel === 'co_critical' ? '一氧化碳高危' : data.fallDetected ? '疑似跌倒' : '主动求助');
    setText('criticalText', data.dangerLevel === 'co_critical' ? 'CO 超标，已启动风扇和声光报警，请立即通风撤离。' : data.fallDetected ? '检测到老人可能跌倒，请立即查看现场。' : '老人按下 SOS，请立即联系或到场处理。');
  }
}

function renderAlertSummary(data, critical, muted = false) {
  if (muted) {
    setText('alertHeadline', '告警已确认');
    setText('alertMessage', `${alarmLabel(data.alarmText)}仍在持续，5 分钟内不再弹出同类强提醒。`);
    return;
  }

  if (critical) {
    setText('alertHeadline', alarmLabel(data.alarmText) || '高危报警');
    if (data.dangerLevel === 'co_critical') setText('alertMessage', '一氧化碳超标，已启动最高优先级联动。');
    else if (data.fallDetected) setText('alertMessage', '疑似老人跌倒，请立即查看现场。');
    else if (data.sos) setText('alertMessage', '老人主动求助，请立即处理。');
    else setText('alertMessage', '检测到高危事件，请立即确认。');
    return;
  }

  if (data.alarmAny) {
    setText('alertHeadline', alarmLabel(data.alarmText) || '环境异常');
    setText('alertMessage', '系统检测到异常状态，已记录事件并执行本地联动。');
    return;
  }

  if (data.nightActivity) {
    setText('alertHeadline', '夜间活动');
    setText('alertMessage', '暗环境检测到人体活动，已联动开灯。');
    return;
  }

  setText('alertHeadline', '系统运行正常');
  setText('alertMessage', '暂无危险报警，持续监测老人活动和居家环境。');
}

function renderOperationalSummary(data) {
  const score = data.sos || data.fallDetected || data.dangerLevel === 'co_critical'
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
  $('riskBar').style.width = `${score}%`;
}

function formatUptime(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}小时${minutes % 60}分`;
  if (minutes > 0) return `${minutes}分${seconds % 60}秒`;
  return `${seconds}秒`;
}

function renderDangerCards(data) {
  const airCard = document.querySelector('.air-card');
  const coCard = document.querySelector('.co-card');
  const air = Number(data.mq135Raw) || 0;
  const co = Number(data.mq7Raw) || 0;
  airCard.classList.toggle('warning', air >= 1800 && air < 2600);
  airCard.classList.toggle('danger', air >= 2600);
  coCard.classList.toggle('warning', co >= 1700 && co < 2100);
  coCard.classList.toggle('danger', co >= 2100);
  setText('airHint', air >= 2600 ? '严重异常，建议通风' : air >= 1800 ? '轻度异常，持续观察' : '空气质量正常');
  setText('coHint', co >= 2100 ? 'CO 高危，立即处理' : co >= 1700 ? 'CO 偏高，注意通风' : '一氧化碳安全');
}

function drawTrend() {
  const canvas = $('trendChart');
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

function renderControls() {
  document.querySelectorAll('[data-control]').forEach((input) => {
    input.checked = Boolean(state.controls[input.dataset.control]);
  });
  renderLatest(state.latest);
}

async function saveControls() {
  if (location.protocol === 'file:') {
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
  state.latest = data;
  renderLatest(data);
}

function handleHistory(history) {
  state.history = Array.isArray(history) ? history : [];
  drawTrend();
}

function handleEvents(events) {
  state.events = Array.isArray(events) ? events : [];
  renderEvents();
}

function handleControls(controls) {
  state.controls = { ...state.controls, ...(controls || {}) };
  renderControls();
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
  stream.addEventListener('controls', (event) => handleControls(JSON.parse(event.data)));
  stream.addEventListener('error', () => setConnection(false, '连接中断'));
}

function demoPayload() {
  const t = Date.now() / 1000;
  const nightActivity = Math.floor(t / 18) % 4 === 1;
  const sos = Math.floor(t / 40) % 6 === 2;
  const fallDetected = Math.floor(t / 55) % 7 === 3;
  const coDanger = Math.floor(t / 70) % 8 === 4;
  const alarmAny = sos || fallDetected || coDanger;
  return {
    timestamp: new Date().toISOString(),
    deviceName: 'demo-esp32',
    productKey: 'local-demo',
    temperatureC: 25 + Math.sin(t / 9) * 2.2,
    humidity: 58 + Math.cos(t / 12) * 8,
    lux: nightActivity ? 24 : 260 + Math.sin(t / 7) * 80,
    mq135Raw: 1200 + Math.round(Math.sin(t / 10) * 120),
    mq7Raw: coDanger ? 2600 : 900 + Math.round(Math.cos(t / 8) * 100),
    fsrRaw: nightActivity ? 1800 : 500,
    pirMotion: nightActivity,
    vibration: false,
    sos,
    fallDetected,
    dark: nightActivity,
    nightActivity,
    alarmAny,
    pushRequired: alarmAny,
    fanOn: coDanger,
    ledOn: nightActivity || alarmAny,
    dangerLevel: coDanger ? 'co_critical' : fallDetected || sos ? 'critical' : nightActivity ? 'activity' : 'normal',
    alarmText: coDanger ? 'CO DANGER' : fallDetected ? 'FALL DETECTED' : sos ? 'SOS BUTTON' : nightActivity ? 'NIGHT MOVE' : 'NORMAL',
    uptimeMs: Math.round(t * 1000)
  };
}

function tickDemo() {
  const payload = demoPayload();
  state.history.push(payload);
  state.history = state.history.slice(-240);
  handleTelemetry(payload);
  drawTrend();

  if (payload.dangerLevel === 'co_critical') addLocalEvent('CO DANGER', '本地演示：一氧化碳超标，最高优先级联动', 'critical');
  else if (payload.fallDetected) addLocalEvent('FALL DETECTED', '本地演示：疑似老人跌倒，请立即查看现场', 'critical');
  else if (payload.sos) addLocalEvent('SOS HELP', '本地演示：老人主动求助，请立即处理', 'critical');
  else if (payload.nightActivity) addLocalEvent('NIGHT MOVE', '本地演示：暗环境检测到人，联动开灯', 'activity');
}

function startDemo() {
  if (state.demoTimer) return;
  setConnection(true, '本地演示');
  tickDemo();
  state.demoTimer = setInterval(tickDemo, 2500);
}

function bindControls() {
  document.querySelectorAll('[data-control]').forEach((input) => {
    input.addEventListener('change', async () => {
      state.controls[input.dataset.control] = input.checked;
      await saveControls();
    });
  });

  $('demoButton').addEventListener('click', () => {
    if (state.demoTimer) {
      clearInterval(state.demoTimer);
      state.demoTimer = null;
      setConnection(Boolean(state.latest), state.latest ? '实时在线' : '等待数据');
    } else {
      startDemo();
    }
  });

  $('themeButton').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const target = document.getElementById(button.dataset.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('ackCritical').addEventListener('click', () => {
    if (state.latest) {
      state.criticalMutedType = criticalTypeOf(state.latest);
      state.criticalMuteUntil = Date.now() + 5 * 60 * 1000;
    }
    $('criticalBanner').hidden = true;
    addLocalEvent('ALARM ACK', '已确认当前紧急提醒，5 分钟内同类提醒不再弹出。', 'status');
  });
}

renderLatest(null);
drawTrend();
renderEvents();
renderControls();
bindControls();
connectStream();
window.addEventListener('resize', drawTrend);
