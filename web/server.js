const path = require('path');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

loadEnvFile(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 3000);
const expectedToken = process.env.DEVICE_TOKEN || 'change-me';
const initialMockEnabled = String(process.env.ENABLE_MOCK || 'false').toLowerCase() === 'true';

let latestTelemetry = null;
const history = [];
const events = [];
const nightRecords = [];
const maxHistory = 240;
const maxEvents = 80;
const maxNightRecords = 60;
const sseClients = new Set();
const dataDir = path.join(__dirname, 'data');
const thresholdsFile = path.join(dataDir, 'thresholds.json');
const mockFile = path.join(dataDir, 'mock.json');
let mockEnabled = loadMockState();
let mockTimer = null;
const controlState = {
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
};
const defaultThresholds = {
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
};
let thresholdState = loadThresholds();
let lastBedOccupied = null;
let currentNightWake = null;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeTelemetry(input) {
  const now = new Date();
  return applyThresholds({
    timestamp: now.toISOString(),
    deviceName: String(input.deviceName || 'esp32-elder-monitor'),
    productKey: String(input.productKey || ''),
    temperatureC: Number(input.temperatureC ?? 0),
    humidity: Number(input.humidity ?? 0),
    lux: Number(input.lux ?? 0),
    mq2Raw: Number(input.mq2Raw ?? 0),
    mq135Raw: Number(input.mq135Raw ?? 0),
    mq7Raw: Number(input.mq7Raw ?? 0),
    fsrRaw: Number(input.fsrRaw ?? 0),
    vibrationRaw: Number(input.vibrationRaw ?? (input.vibration ? 4095 : 0)),
    pirMotion: Boolean(input.pirMotion),
    vibration: Boolean(input.vibration),
    sos: Boolean(input.sos),
    fallDetected: Boolean(input.fallDetected ?? input.fall ?? false),
    dark: Boolean(input.dark),
    bedOccupied: Boolean(input.bedOccupied ?? false),
    nightWakeActive: Boolean(input.nightWakeActive ?? false),
    nightActivity: Boolean(input.nightActivity),
    alarmAny: Boolean(input.alarmAny),
    pushRequired: Boolean(input.pushRequired),
    fanOn: Boolean(input.fanOn),
    ledOn: Boolean(input.ledOn),
    darkLightOn: Boolean(input.darkLightOn),
    nightLightOn: Boolean(input.nightLightOn),
    nightWakeLightOn: Boolean(input.nightWakeLightOn),
    alarmLightOn: Boolean(input.alarmLightOn),
    dangerLevel: String(input.dangerLevel || 'normal'),
    alarmText: String(input.alarmText || 'NORMAL'),
    uptimeMs: Number(input.uptimeMs ?? 0)
  });
}

function normalizeThresholds(input) {
  const next = { ...defaultThresholds };
  for (const key of Object.keys(defaultThresholds)) {
    if (typeof defaultThresholds[key] === 'boolean') {
      if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
        next[key] = Boolean(input[key]);
      }
      continue;
    }
    const value = Number(input?.[key]);
    if (Number.isFinite(value)) next[key] = value;
  }

  const pairs = [
    ['mq135Warn', 'mq135Danger'],
    ['mq2Warn', 'mq2Danger'],
    ['mq7Warn', 'mq7Danger'],
    ['tempLow', 'tempHigh'],
    ['humidityLow', 'humidityHigh']
  ];
  for (const [low, high] of pairs) {
    if (next[low] > next[high]) {
      const temp = next[low];
      next[low] = next[high];
      next[high] = temp;
    }
  }
  return next;
}

function loadThresholds() {
  try {
    if (!fs.existsSync(thresholdsFile)) return { ...defaultThresholds };
    return normalizeThresholds(JSON.parse(fs.readFileSync(thresholdsFile, 'utf8')));
  } catch (error) {
    return { ...defaultThresholds };
  }
}

function loadMockState() {
  try {
    if (!fs.existsSync(mockFile)) return initialMockEnabled;
    const saved = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    return Boolean(saved.enabled);
  } catch (error) {
    return initialMockEnabled;
  }
}

function saveMockState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(mockFile, JSON.stringify({ enabled: mockEnabled }, null, 2));
}

function saveThresholds(input) {
  thresholdState = normalizeThresholds(input);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(thresholdsFile, JSON.stringify(thresholdState, null, 2));
  broadcast('thresholds', thresholdState);
  events.unshift({
    timestamp: new Date().toISOString(),
    type: 'status',
    title: 'CONTROL UPDATED',
    detail: '网页端传感器阈值已更新'
  });
  while (events.length > maxEvents) events.pop();
  broadcast('events', events);
  return thresholdState;
}

function applyThresholds(payload) {
  const th = thresholdState;
  const next = { ...payload };
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
  next.darkLightOn = Boolean(next.darkLightOn || (next.dark && controlState.darkLight));
  next.nightLightOn = Boolean(next.nightLightOn || (next.nightActivity && controlState.nightLight));
  next.nightWakeLightOn = Boolean(next.nightWakeLightOn || (next.nightWakeActive && controlState.nightWakeLight));
  next.alarmLightOn = Boolean(next.alarmLightOn || (next.alarmAny && controlState.alarmLight));
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

function effectiveLinkage(payload = latestTelemetry) {
  if (!payload) {
    return {
      darkLight: false,
      nightLight: false,
      curtain: false,
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
    darkLight: Boolean(payload.dark) && controlState.darkLight,
    nightLight: Boolean(payload.nightActivity) && controlState.nightLight,
    nightWakeLight: Boolean(payload.nightWakeActive) && controlState.nightWakeLight,
    curtain: Boolean(payload.dark || payload.nightActivity) && controlState.curtainAuto,
    alarmLight: Boolean(payload.alarmAny) && controlState.alarmLight,
    fan: Boolean(payload.fanOn) && controlState.fanVentilation,
    buzzer: alarmActive && controlState.buzzerAlarm,
    servo: Boolean(payload.sos) && controlState.sosServo,
    noMotion: payload.alarmText === 'NO MOTION' && controlState.noMotionWarning
  };
}

function addEvent(type, title, detail, timestamp = new Date().toISOString()) {
  events.unshift({ timestamp, type, title, detail });
  while (events.length > maxEvents) events.pop();
  broadcast('events', events);
}

function updateNightRecords(payload) {
  if (!controlState.nightWakeMonitor) {
    lastBedOccupied = payload.bedOccupied;
    return;
  }

  if (lastBedOccupied === null) {
    lastBedOccupied = payload.bedOccupied;
    return;
  }

  const leftBed = lastBedOccupied && !payload.bedOccupied;
  const backToBed = !lastBedOccupied && payload.bedOccupied;

  if (leftBed && payload.dark) {
    currentNightWake = {
      id: `${Date.now()}`,
      outOfBedAt: payload.timestamp,
      backToBedAt: null,
      durationSec: null,
      lightOn: Boolean(payload.pirMotion && controlState.nightWakeLight),
      reason: '暗环境离床'
    };
    nightRecords.unshift(currentNightWake);
    while (nightRecords.length > maxNightRecords) nightRecords.pop();
    broadcast('nightRecords', nightRecords);
  }

  if (backToBed) {
    if (currentNightWake && !currentNightWake.backToBedAt) {
      currentNightWake.backToBedAt = payload.timestamp;
      currentNightWake.durationSec = Math.max(0, Math.round((new Date(payload.timestamp) - new Date(currentNightWake.outOfBedAt)) / 1000));
      broadcast('nightRecords', nightRecords);
      currentNightWake = null;
    } else if (payload.dark) {
      nightRecords.unshift({
        id: `${Date.now()}`,
        outOfBedAt: null,
        backToBedAt: payload.timestamp,
        durationSec: null,
        lightOn: false,
        reason: '暗环境上床'
      });
      while (nightRecords.length > maxNightRecords) nightRecords.pop();
      broadcast('nightRecords', nightRecords);
    }
  }

  lastBedOccupied = payload.bedOccupied;
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}分${secs}秒`;
  return `${secs}秒`;
}

function rememberTelemetry(payload) {
  const previousAlarm = latestTelemetry?.alarmText;
  latestTelemetry = payload;
  history.push(payload);
  while (history.length > maxHistory) history.shift();
  updateNightRecords(payload);

  if (payload.sos || payload.fallDetected || payload.alarmAny || payload.nightActivity || previousAlarm !== payload.alarmText) {
    addEvent(
      payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical' ? 'critical' : payload.alarmAny ? 'alarm' : payload.nightActivity ? 'activity' : 'status',
      payload.fallDetected ? 'FALL DETECTED' : payload.sos ? 'SOS HELP' : payload.alarmText,
      payload.alarmText === 'EARTHQUAKE' ? '检测到强震动，疑似地震或剧烈撞击，请立即查看现场' : payload.fallDetected ? '疑似老人跌倒，请立即查看现场' : payload.sos ? '老人主动求助，请立即处理' : payload.dangerLevel === 'co_critical' ? '一氧化碳超标，已启动最高优先级联动' : payload.alarmAny ? '安全告警已触发' : payload.nightActivity ? '暗环境检测到人体活动，已联动开灯' : '状态变化',
      payload.timestamp
    );
  }

  broadcast('telemetry', payload);
  broadcast('history', history);
  broadcast('nightRecords', nightRecords);
}

function sendJson(res, statusCode, body) {
  const output = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(output)
  });
  res.end(output);
}

function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(frame);
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  res.write(`event: telemetry\ndata: ${JSON.stringify(latestTelemetry)}\n\n`);
  res.write(`event: history\ndata: ${JSON.stringify(history)}\n\n`);
  res.write(`event: events\ndata: ${JSON.stringify(events)}\n\n`);
  res.write(`event: nightRecords\ndata: ${JSON.stringify(nightRecords)}\n\n`);
  res.write(`event: controls\ndata: ${JSON.stringify(controlState)}\n\n`);
  res.write(`event: thresholds\ndata: ${JSON.stringify(thresholdState)}\n\n`);
  res.write(`event: mock\ndata: ${JSON.stringify({ enabled: mockEnabled })}\n\n`);
  req.on('close', () => sseClients.delete(res));
}

function updateControls(input) {
  for (const key of Object.keys(controlState)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      controlState[key] = Boolean(input[key]);
    }
  }
  broadcast('controls', controlState);
  events.unshift({
    timestamp: new Date().toISOString(),
    type: 'status',
    title: 'CONTROL UPDATED',
    detail: '网页端联动开关已更新'
  });
  while (events.length > maxEvents) events.pop();
  broadcast('events', events);
  return controlState;
}

function buildMockPayload() {
  const t = Date.now() / 1000;
  const nightActivity = Math.floor(t / 20) % 4 === 1;
  const sos = Math.floor(t / 45) % 6 === 2;
  const fallDetected = Math.floor(t / 55) % 7 === 3;
    const coDanger = Math.floor(t / 70) % 8 === 4;
    const earthquake = Math.floor(t / 90) % 8 === 5;
  const smokeDanger = Math.floor(t / 50) % 7 === 3;
  const alarmAny = sos || fallDetected || coDanger || smokeDanger;
  const bedOccupied = Math.floor(t / 20) % 4 !== 1;
  return normalizeTelemetry({
    deviceName: 'demo-esp32',
    productKey: 'demo',
    temperatureC: 25 + Math.sin(t / 9) * 2,
    humidity: 58 + Math.cos(t / 12) * 8,
    lux: nightActivity ? 28 : 260 + Math.sin(t / 7) * 80,
    mq135Raw: 1200 + Math.round(Math.sin(t / 10) * 120),
    mq2Raw: smokeDanger ? 2600 : 1000 + Math.round(Math.sin(t / 11) * 130),
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
      alarmAny: alarmAny || earthquake,
      pushRequired: alarmAny || earthquake,
      fanOn: coDanger || smokeDanger,
      darkLightOn: nightActivity,
      nightLightOn: nightActivity,
      nightWakeLightOn: nightActivity && !bedOccupied,
      alarmLightOn: alarmAny || earthquake,
      ledOn: nightActivity || alarmAny || earthquake,
      dangerLevel: earthquake ? 'critical' : coDanger ? 'co_critical' : fallDetected || sos ? 'critical' : smokeDanger ? 'danger' : nightActivity ? 'activity' : 'normal',
      alarmText: earthquake ? 'EARTHQUAKE' : coDanger ? 'CO DANGER' : fallDetected ? 'FALL DETECTED' : sos ? 'SOS BUTTON' : smokeDanger ? 'SMOKE DANGER' : nightActivity ? 'NIGHT MOVE' : 'NORMAL',
    uptimeMs: Math.round(t * 1000)
  });
}

function tickMock() {
  rememberTelemetry(buildMockPayload());
}

function setMockEnabled(enabled, options = {}) {
  mockEnabled = Boolean(enabled);
  if (mockEnabled && !mockTimer) {
    tickMock();
    mockTimer = setInterval(tickMock, 2500);
  }
  if (!mockEnabled && mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }
  saveMockState();
  broadcast('mock', { enabled: mockEnabled });
  if (options.addEvent !== false) {
    addEvent('status', mockEnabled ? 'DEMO ENABLED' : 'DEMO DISABLED', mockEnabled ? '网页端模拟演示数据已开启' : '网页端模拟演示数据已关闭');
  }
  return { enabled: mockEnabled };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function serveStatic(urlPath, res) {
  const publicDir = path.join(__dirname, 'public');
  const decodedPath = decodeURIComponent(urlPath);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const requested = decodedPath === '/' ? 'index.html' : safePath.replace(/^[/\\]+/, '');
  const filePath = path.join(publicDir, requested);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { ok: false, error: 'not found' });
    return;
  }

  res.writeHead(200, { 'Content-Type': contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, latest: latestTelemetry, historyCount: history.length, controls: controlState, linkage: effectiveLinkage(), mock: { enabled: mockEnabled } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/telemetry/latest') {
      sendJson(res, 200, latestTelemetry || {});
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/telemetry/history') {
      sendJson(res, 200, history);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      sendJson(res, 200, events);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/night-records') {
      sendJson(res, 200, nightRecords);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/control') {
      sendJson(res, 200, { ...controlState, ...thresholdState });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/linkage/status') {
      sendJson(res, 200, { controls: controlState, latest: latestTelemetry, effective: effectiveLinkage() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/thresholds') {
      sendJson(res, 200, thresholdState);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/mock') {
      sendJson(res, 200, { enabled: mockEnabled });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      handleSse(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/control') {
      const body = await readRequestBody(req);
      sendJson(res, 200, updateControls(JSON.parse(body || '{}')));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/thresholds') {
      const body = await readRequestBody(req);
      sendJson(res, 200, saveThresholds(JSON.parse(body || '{}')));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/mock') {
      const body = await readRequestBody(req);
      const input = JSON.parse(body || '{}');
      sendJson(res, 200, setMockEnabled(input.enabled));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/telemetry') {
      const token = req.headers['x-device-token'] || '';
      if (expectedToken && token !== expectedToken) {
        sendJson(res, 401, { ok: false, error: 'invalid token' });
        return;
      }

      const body = await readRequestBody(req);
      const payload = normalizeTelemetry(JSON.parse(body || '{}'));
      rememberTelemetry(payload);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: 'method not allowed' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

if (mockEnabled) {
  setMockEnabled(true, { addEvent: false });
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Elder monitor dashboard: http://localhost:${port}`);
});
