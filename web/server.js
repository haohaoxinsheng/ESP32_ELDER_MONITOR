const path = require('path');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

loadEnvFile(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 3000);
const expectedToken = process.env.DEVICE_TOKEN || 'change-me';
const enableMock = String(process.env.ENABLE_MOCK || 'false').toLowerCase() === 'true';

let latestTelemetry = null;
const history = [];
const events = [];
const maxHistory = 240;
const maxEvents = 80;
const sseClients = new Set();
const controlState = {
  nightLight: true,
  alarmLight: true,
  fanVentilation: true,
  buzzerAlarm: true,
  sosServo: true,
  noMotionWarning: true
};

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
  return {
    timestamp: now.toISOString(),
    deviceName: String(input.deviceName || 'esp32-elder-monitor'),
    productKey: String(input.productKey || ''),
    temperatureC: Number(input.temperatureC ?? 0),
    humidity: Number(input.humidity ?? 0),
    lux: Number(input.lux ?? 0),
    mq135Raw: Number(input.mq135Raw ?? 0),
    mq7Raw: Number(input.mq7Raw ?? 0),
    fsrRaw: Number(input.fsrRaw ?? 0),
    pirMotion: Boolean(input.pirMotion),
    vibration: Boolean(input.vibration),
    sos: Boolean(input.sos),
    fallDetected: Boolean(input.fallDetected ?? input.fall ?? false),
    dark: Boolean(input.dark),
    nightActivity: Boolean(input.nightActivity),
    alarmAny: Boolean(input.alarmAny),
    pushRequired: Boolean(input.pushRequired),
    fanOn: Boolean(input.fanOn),
    ledOn: Boolean(input.ledOn),
    dangerLevel: String(input.dangerLevel || 'normal'),
    alarmText: String(input.alarmText || 'NORMAL'),
    uptimeMs: Number(input.uptimeMs ?? 0)
  };
}

function rememberTelemetry(payload) {
  const previousAlarm = latestTelemetry?.alarmText;
  latestTelemetry = payload;
  history.push(payload);
  while (history.length > maxHistory) history.shift();

  if (payload.sos || payload.fallDetected || payload.alarmAny || payload.nightActivity || previousAlarm !== payload.alarmText) {
    events.unshift({
      timestamp: payload.timestamp,
      type: payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical' ? 'critical' : payload.alarmAny ? 'alarm' : payload.nightActivity ? 'activity' : 'status',
      title: payload.fallDetected ? 'FALL DETECTED' : payload.sos ? 'SOS HELP' : payload.alarmText,
      detail: payload.fallDetected ? '疑似老人跌倒，请立即查看现场' : payload.sos ? '老人主动求助，请立即处理' : payload.dangerLevel === 'co_critical' ? '一氧化碳超标，已启动最高优先级联动' : payload.alarmAny ? '安全告警已触发' : payload.nightActivity ? '暗环境检测到人体活动，已联动开灯' : '状态变化',
      pushRequired: payload.pushRequired || payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical'
    });
    while (events.length > maxEvents) events.pop();
  }

  broadcast('telemetry', payload);
  broadcast('history', history);
  broadcast('events', events);
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
  res.write(`event: controls\ndata: ${JSON.stringify(controlState)}\n\n`);
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
      sendJson(res, 200, { ok: true, latest: latestTelemetry, historyCount: history.length });
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

    if (req.method === 'GET' && url.pathname === '/api/control') {
      sendJson(res, 200, controlState);
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

if (enableMock) {
  setInterval(() => {
    const t = Date.now() / 1000;
    const nightActivity = Math.floor(t / 20) % 4 === 1;
    const sos = Math.floor(t / 45) % 6 === 2;
    const fallDetected = Math.floor(t / 55) % 7 === 3;
    const coDanger = Math.floor(t / 70) % 8 === 4;
    const payload = normalizeTelemetry({
      deviceName: 'demo-esp32',
      productKey: 'demo',
      temperatureC: 25 + Math.sin(t / 9) * 2,
      humidity: 58 + Math.cos(t / 12) * 8,
      lux: nightActivity ? 28 : 260 + Math.sin(t / 7) * 80,
      mq135Raw: 1200 + Math.round(Math.sin(t / 10) * 120),
      mq7Raw: coDanger ? 2600 : 900 + Math.round(Math.cos(t / 8) * 100),
      fsrRaw: nightActivity ? 1800 : 500,
      pirMotion: nightActivity,
      vibration: false,
      sos,
      fallDetected,
      dark: nightActivity,
      nightActivity,
      alarmAny: sos || fallDetected || coDanger,
      pushRequired: sos || fallDetected || coDanger,
      fanOn: coDanger,
      ledOn: nightActivity || sos || fallDetected || coDanger,
      dangerLevel: coDanger ? 'co_critical' : fallDetected || sos ? 'critical' : nightActivity ? 'activity' : 'normal',
      alarmText: coDanger ? 'CO DANGER' : fallDetected ? 'FALL DETECTED' : sos ? 'SOS BUTTON' : nightActivity ? 'NIGHT MOVE' : 'NORMAL',
      uptimeMs: Math.round(t * 1000)
    });
    rememberTelemetry(payload);
  }, 2500);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Elder monitor dashboard: http://localhost:${port}`);
});
