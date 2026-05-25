// Web 后端服务：接收 ESP32 上报数据，维护历史/事件/阈值/联动状态，并通过 SSE 推送给前端。
const path = require('path');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');
const MonitorModel = require('./public/shared/monitor-model.js');

loadEnvFile(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 3001);
const expectedToken = process.env.DEVICE_TOKEN || 'change-me';
const initialMockEnabled = String(process.env.ENABLE_MOCK || 'false').toLowerCase() === 'true';

let latestTelemetry = null;
const history = [];
const events = [];
const nightRecords = [];
const maxHistory = 240;
const maxEvents = 80;
const maxNightRecords = 60;
const deviceOfflineTimeoutMs = Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS || 8000);
const sseClients = new Set();
const dataDir = path.join(__dirname, 'data');
const thresholdsFile = path.join(dataDir, 'thresholds.json');
const controlsFile = path.join(dataDir, 'controls.json');
const mockFile = path.join(dataDir, 'mock.json');
const demoDataFile = path.join(dataDir, 'demo-data.json');
let mockEnabled = loadMockState();
let demoDataState = loadDemoData();
let mockTimer = null;
const controlState = loadControls();
let thresholdState = loadThresholds();
let lastBedOccupied = null;
let currentNightWake = null;
let lastDeviceOnline = false;
let lastMotionSeenAtMs = null;
let motionTrackingStartedAtMs = null;

// 加载 .env，便于服务器部署时覆盖端口、令牌和演示模式。
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

// 读取阈值文件；文件不存在或损坏时回落到共享模型默认阈值。
function loadThresholds() {
  try {
    if (!fs.existsSync(thresholdsFile)) return MonitorModel.createDefaultThresholds();
    return MonitorModel.normalizeThresholds(JSON.parse(fs.readFileSync(thresholdsFile, 'utf8')));
  } catch (error) {
    return MonitorModel.createDefaultThresholds();
  }
}

// 读取联动开关状态；异常时使用默认联动配置。
function loadControls() {
  try {
    if (!fs.existsSync(controlsFile)) return MonitorModel.createDefaultControls();
    return normalizeControls(JSON.parse(fs.readFileSync(controlsFile, 'utf8')));
  } catch (error) {
    return MonitorModel.createDefaultControls();
  }
}

// 只接受已知联动开关，避免未知字段污染设备控制状态。
function normalizeControls(input) {
  const next = MonitorModel.createDefaultControls();
  const source = input || {};
  for (const key of Object.keys(next)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      next[key] = Boolean(source[key]);
    }
  }
  return next;
}

// 持久化联动开关，供服务重启后恢复。
function saveControlState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(controlsFile, JSON.stringify(controlState, null, 2));
}

// 读取演示模式开关，支持公网服务重启后保持上次状态。
function loadMockState() {
  try {
    if (!fs.existsSync(mockFile)) return initialMockEnabled;
    const saved = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    return Boolean(saved.enabled);
  } catch (error) {
    return initialMockEnabled;
  }
}

// 持久化演示模式开关。
function saveMockState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(mockFile, JSON.stringify({ enabled: mockEnabled }, null, 2));
}

// 读取可编辑的静态演示数据，替代原先按时间自动变化的数据。
function loadDemoData() {
  try {
    if (!fs.existsSync(demoDataFile)) return MonitorModel.createDefaultDemoTelemetry();
    return MonitorModel.normalizeDemoTelemetry(JSON.parse(fs.readFileSync(demoDataFile, 'utf8')));
  } catch (error) {
    return MonitorModel.createDefaultDemoTelemetry();
  }
}

// 保存静态演示数据，并通知前端刷新表单。
function saveDemoData(input) {
  demoDataState = MonitorModel.normalizeDemoTelemetry({ ...demoDataState, ...(input || {}) });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(demoDataFile, JSON.stringify(demoDataState, null, 2));
  broadcast('demoData', demoDataState);
  addEvent('status', 'DEMO DATA UPDATED', '静态演示数据已更新');
  if (mockEnabled) tickMock();
  return demoDataState;
}

// 保存阈值并广播给所有浏览器，同时记录一条配置更新事件。
function saveThresholds(input) {
  thresholdState = MonitorModel.normalizeThresholds(input);
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

// 按最新遥测和控制项推导执行器真实联动状态。
function effectiveLinkage(payload = latestTelemetry) {
  return MonitorModel.effectiveLinkage(payload, controlState);
}

// 根据最后上报时间判断真实设备是否在线；演示模式始终在线。
function isDeviceOnline() {
  if (mockEnabled) return true;
  if (!latestTelemetry?.serverReceivedAt) return false;
  return Date.now() - new Date(latestTelemetry.serverReceivedAt).getTime() <= deviceOfflineTimeoutMs;
}

// 返回统一连接状态，前端设置锁定和离线提示都依赖这份数据。
function connectionStatePayload() {
  return {
    deviceOnline: isDeviceOnline(),
    timeoutMs: deviceOfflineTimeoutMs,
    lastReceivedAt: latestTelemetry?.serverReceivedAt || null
  };
}

// 写操作前检查设备在线，避免离线时误保存无法同步到设备的配置。
function assertDeviceOnline(res) {
  if (isDeviceOnline()) return true;
  sendJson(res, 409, {
    ok: false,
    error: '设备离线，设置已锁定。请等待设备恢复上报后再修改。',
    ...connectionStatePayload()
  });
  return false;
}

// 追加事件并推送给所有 SSE 客户端。
function addEvent(type, title, detail, timestamp = new Date().toISOString()) {
  events.unshift({ timestamp, type, title, detail });
  while (events.length > maxEvents) events.pop();
  broadcast('events', events);
}

// 根据床位占用变化记录夜间离床/回床过程。
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

// 服务端补充“长时间无活动”提醒，防止设备未主动上报该状态时漏报。
function applyNoMotionReminder(payload) {
  const now = Date.now();
  if (!controlState.noMotionWarning || !thresholdState.enablePir) {
    payload.noMotion = false;
    return payload;
  }

  if (payload.pirMotion) {
    lastMotionSeenAtMs = now;
    motionTrackingStartedAtMs = now;
    payload.noMotion = false;
    return payload;
  }

  const noMotionMs = Math.max(1, Number(thresholdState.noMotionMinutes || 30)) * 60 * 1000;
  if (!motionTrackingStartedAtMs) {
    const uptimeMs = Math.max(0, Number(payload.uptimeMs || 0));
    motionTrackingStartedAtMs = now - Math.min(uptimeMs, noMotionMs);
  }

  const referenceMs = lastMotionSeenAtMs || motionTrackingStartedAtMs;
  const noMotion = Boolean(payload.noMotion || (now - referenceMs >= noMotionMs));
  payload.noMotion = noMotion;

  if (noMotion) {
    payload.alarmAny = true;
    payload.pushRequired = true;
    payload.dangerLevel = payload.dangerLevel === 'normal' ? 'warning' : payload.dangerLevel;
    payload.alarmText = 'NO MOTION';
  }

  return payload;
}

// 把秒数转为中文短时长，供事件详情和起夜记录展示。
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}分${secs}秒`;
  return `${secs}秒`;
}

// 接收一帧遥测后更新最新值、历史、事件、起夜记录和前端推送。
function rememberTelemetry(payload) {
  const previousAlarm = latestTelemetry?.alarmText;
  payload = applyNoMotionReminder(payload);
  latestTelemetry = {
    ...payload,
    serverReceivedAt: new Date().toISOString()
  };
  payload = latestTelemetry;
  history.push(payload);
  while (history.length > maxHistory) history.shift();
  updateNightRecords(payload);

  if (payload.sos || payload.fallDetected || payload.alarmAny || payload.noMotion || payload.nightActivity || previousAlarm !== payload.alarmText) {
    addEvent(
      payload.sos || payload.fallDetected || payload.dangerLevel === 'co_critical' ? 'critical' : payload.alarmAny || payload.noMotion ? 'alarm' : payload.nightActivity ? 'activity' : 'status',
      payload.fallDetected ? 'FALL DETECTED' : payload.sos ? 'SOS HELP' : payload.alarmText,
      payload.alarmText === 'EARTHQUAKE' ? '检测到强震动，疑似地震或剧烈撞击，请立即查看现场' : payload.fallDetected ? '疑似老人跌倒，请立即查看现场' : payload.sos ? '老人主动求助，请立即处理' : payload.dangerLevel === 'co_critical' ? '一氧化碳超标，已启动最高优先级联动' : (payload.alarmAny || payload.noMotion) ? '长时间无活动，已进入看护提醒' : payload.nightActivity ? '暗环境检测到人体活动，已联动开灯' : '状态变化',
      payload.timestamp
    );
  }

  broadcast('telemetry', payload);
  broadcast('history', history);
  broadcast('nightRecords', nightRecords);
  broadcast('connection', connectionStatePayload());
}

// 统一输出 JSON 响应，确保中文和 Content-Length 正确。
function sendJson(res, statusCode, body) {
  const output = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(output)
  });
  res.end(output);
}

// 向所有浏览器 SSE 连接推送同一类事件。
function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(frame);
  }
}

// 建立 SSE 长连接，并把当前状态快照立即发给新连接的浏览器。
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
  res.write(`event: demoData\ndata: ${JSON.stringify(demoDataState)}\n\n`);
  res.write(`event: connection\ndata: ${JSON.stringify(connectionStatePayload())}\n\n`);
  req.on('close', () => sseClients.delete(res));
}

// 更新联动开关并持久化，随后广播状态和事件。
function updateControls(input) {
  for (const key of Object.keys(controlState)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      controlState[key] = Boolean(input[key]);
    }
  }
  saveControlState();
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

// 兼容设备和网页提交的混合控制 payload，拆分开关和阈值字段。
function splitControlPayload(input = {}) {
  const controls = {};
  const thresholds = {};

  for (const key of Object.keys(controlState)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      controls[key] = input[key];
    }
  }

  for (const key of Object.keys(MonitorModel.DEFAULT_THRESHOLDS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      thresholds[key] = input[key];
    }
  }

  return { controls, thresholds };
}

// 判断拆分后的 payload 是否真的包含有效字段。
function hasPayloadKeys(input) {
  return Object.keys(input).length > 0;
}

// 生成一帧演示数据，复用共享模型保证和真实遥测字段一致。
function buildMockPayload() {
  return MonitorModel.createDemoTelemetry({
    deviceName: 'demo-esp32',
    productKey: 'static-demo',
    demoData: demoDataState,
    thresholds: thresholdState,
    controls: controlState
  });
}

// 演示模式定时器 tick：生成并注入一帧模拟遥测。
function tickMock() {
  rememberTelemetry(buildMockPayload());
}

// 启停服务端演示模式，并向前端广播当前演示状态。
function setMockEnabled(enabled, options = {}) {
  mockEnabled = Boolean(enabled);
  if (mockEnabled && !mockTimer) {
    tickMock();
    mockTimer = setInterval(tickMock, 1000);
  }
  if (!mockEnabled && mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }
  saveMockState();
  broadcast('mock', { enabled: mockEnabled });
  if (options.addEvent !== false) {
    addEvent('status', mockEnabled ? 'DEMO ENABLED' : 'DEMO DISABLED', mockEnabled ? '网页端静态演示数据已开启' : '网页端静态演示数据已关闭');
  }
  return { enabled: mockEnabled };
}

// 读取并限制 POST 请求体大小，避免异常大 payload 拖垮服务。
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

// 根据静态文件扩展名返回 MIME 类型。
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

// 安全地从 public 目录提供前端静态文件，防止路径穿越。
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

// 健康检查聚合：用于部署验证和外部探活。
function healthPayload() {
  return {
    ok: true,
    latest: latestTelemetry,
    historyCount: history.length,
    controls: controlState,
    thresholds: thresholdState,
    ...connectionStatePayload(),
    linkage: effectiveLinkage(),
    mock: { enabled: mockEnabled }
  };
}

// 处理所有 GET API；返回 true 表示请求已被消费。
function handleGetApi(pathname, req, res) {
  if (pathname === '/api/health') {
    sendJson(res, 200, healthPayload());
    return true;
  }

  if (pathname === '/api/telemetry/latest') {
    sendJson(res, 200, latestTelemetry || {});
    return true;
  }

  if (pathname === '/api/telemetry/history') {
    sendJson(res, 200, history);
    return true;
  }

  if (pathname === '/api/events') {
    sendJson(res, 200, events);
    return true;
  }

  if (pathname === '/api/night-records') {
    sendJson(res, 200, nightRecords);
    return true;
  }

  if (pathname === '/api/control') {
    sendJson(res, 200, { ...controlState, ...thresholdState });
    return true;
  }

  if (pathname === '/api/linkage/status') {
    sendJson(res, 200, { controls: controlState, latest: latestTelemetry, effective: effectiveLinkage() });
    return true;
  }

  if (pathname === '/api/thresholds') {
    sendJson(res, 200, thresholdState);
    return true;
  }

  if (pathname === '/api/mock') {
    sendJson(res, 200, { enabled: mockEnabled });
    return true;
  }

  if (pathname === '/api/demo-data') {
    sendJson(res, 200, demoDataState);
    return true;
  }

  if (pathname === '/api/stream') {
    handleSse(req, res);
    return true;
  }

  return false;
}

// 解析 JSON 请求体，空 body 视作空对象。
async function parseJsonBody(req) {
  const body = await readRequestBody(req);
  return JSON.parse(body || '{}');
}

// 处理所有 POST API：控制保存、阈值保存、演示模式和设备遥测上报。
async function handlePostApi(pathname, req, res) {
  if (pathname === '/api/control') {
    if (!assertDeviceOnline(res)) return true;
    const input = await parseJsonBody(req);
    const { controls, thresholds } = splitControlPayload(input);
    if (hasPayloadKeys(controls)) updateControls(controls);
    if (hasPayloadKeys(thresholds)) saveThresholds({ ...thresholdState, ...thresholds });
    sendJson(res, 200, { ...controlState, ...thresholdState });
    return true;
  }

  if (pathname === '/api/thresholds') {
    if (!assertDeviceOnline(res)) return true;
    sendJson(res, 200, saveThresholds({ ...thresholdState, ...await parseJsonBody(req) }));
    return true;
  }

  if (pathname === '/api/mock') {
    const input = await parseJsonBody(req);
    sendJson(res, 200, setMockEnabled(input.enabled));
    return true;
  }

  if (pathname === '/api/demo-data') {
    sendJson(res, 200, saveDemoData(await parseJsonBody(req)));
    return true;
  }

  if (pathname === '/api/telemetry') {
    const token = req.headers['x-device-token'] || '';
    if (expectedToken && token !== expectedToken) {
      sendJson(res, 401, { ok: false, error: 'invalid token' });
      return true;
    }

    const payload = MonitorModel.normalizeAndDeriveTelemetry(
      await parseJsonBody(req),
      thresholdState,
      controlState
    );
    rememberTelemetry(payload);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

// HTTP 入口：先匹配 API，再回退到静态文件服务。
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && handleGetApi(url.pathname, req, res)) return;
    if (req.method === 'POST' && await handlePostApi(url.pathname, req, res)) return;
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

setInterval(() => {
  const online = isDeviceOnline();
  if (online === lastDeviceOnline) return;
  lastDeviceOnline = online;
  broadcast('connection', connectionStatePayload());
  addEvent(
    online ? 'status' : 'alarm',
    online ? 'DEVICE ONLINE' : 'DEVICE OFFLINE',
    online ? '设备已恢复实时上报' : '超过离线阈值未收到设备数据，设置已锁定'
  );
}, 1000);

server.listen(port, '0.0.0.0', () => {
  console.log(`Elder monitor dashboard: http://localhost:${port}`);
});
