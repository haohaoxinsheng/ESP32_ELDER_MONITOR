// 前端核心层：集中维护共享状态、基础工具、联动推导和通用格式化方法。
(function (window) {
  const monitorModel = window.MonitorModel;
  const App = window.ElderMonitorApp = window.ElderMonitorApp || {};

  const state = {
    latest: null,
    history: [],
    events: [],
    nightRecords: [],
    controls: monitorModel.createDefaultControls(),
    thresholds: monitorModel.createDefaultThresholds(),
    deviceOnline: false,
    deviceTimeoutMs: 8000,
    lastReceivedAt: null,
    mock: {
      enabled: false
    },
    thresholdFormDirty: false,
    thresholdFormSaving: false,
    thresholdDraft: {},
    demoTimer: null,
    criticalMuteUntil: 0,
    criticalMutedType: '',
    criticalHoldUntil: 0,
    criticalHoldData: null,
    criticalHoldType: ''
  };

  const $ = (id) => document.getElementById(id);

  // 根据滚动进度更新顶部栏和悬浮页签的液态玻璃变量。
  function updateTopbarGlass() {
    const topbar = document.querySelector('.topbar');
    const floatingNav = document.querySelector('.floating-nav');
    const progress = Math.min(1, window.scrollY / 112);
    if (topbar) {
      topbar.style.setProperty('--scroll-progress', progress.toFixed(3));
      topbar.classList.toggle('scrolled', progress > 0.12);
    }
    if (floatingNav) {
      floatingNav.style.setProperty('--scroll-progress', progress.toFixed(3));
    }
  }

  // 为主要玻璃卡片注入鼠标高光位置，增强悬浮交互质感。
  function bindLiquidGlassInteraction() {
    const selector = '.panel, .danger-card, .metric, .status-panel';
    document.querySelectorAll(selector).forEach((node) => {
      node.addEventListener('pointermove', (event) => {
        const rect = node.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        node.style.setProperty('--mx', `${x}%`);
        node.style.setProperty('--my', `${y}%`);
      });
    });
  }

  // 将后端告警码转换成页面展示文案。
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
    if (value === null || value === undefined || value === '') return '--';
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
    toggleClass('connDot', 'offline', !online);
    setText('connText', text || (online ? '实时在线' : '等待数据'));
  }

  // 统一把原始遥测归一化，并套用当前阈值和联动配置。
  function deriveTelemetry(data) {
    if (!data) return data;
    const next = monitorModel.normalizeAndDeriveTelemetry(data, state.thresholds, state.controls, {
      timestamp: data.timestamp
    });
    next.serverReceivedAt = data.serverReceivedAt || null;
    return next;
  }

  function updateDeviceConnection(connection = {}) {
    state.deviceOnline = Boolean(connection.deviceOnline);
    state.deviceTimeoutMs = Number(connection.timeoutMs || state.deviceTimeoutMs || 8000);
    state.lastReceivedAt = connection.lastReceivedAt || state.latest?.serverReceivedAt || null;
    setConnection(state.deviceOnline, state.deviceOnline ? '实时在线' : state.lastReceivedAt ? '设备下线' : '等待数据');
  }

  function refreshDeviceConnection() {
    if (location.protocol === 'file:' || state.mock.enabled || state.demoTimer) {
      updateDeviceConnection({ deviceOnline: true, lastReceivedAt: new Date().toISOString() });
      return;
    }
    if (!state.lastReceivedAt) {
      updateDeviceConnection({ deviceOnline: false, lastReceivedAt: null });
      return;
    }
    const elapsed = Date.now() - new Date(state.lastReceivedAt).getTime();
    updateDeviceConnection({
      deviceOnline: elapsed <= state.deviceTimeoutMs,
      timeoutMs: state.deviceTimeoutMs,
      lastReceivedAt: state.lastReceivedAt
    });
  }

  // 计算当前遥测在开关配置下的最终联动状态。
  function currentLinkage(data = state.latest) {
    return monitorModel.effectiveLinkage(data, state.controls);
  }

  function effectiveLed(data) {
    if (!data) return false;
    const status = currentLinkage(data);
    return Boolean(status.darkLight || status.nightLight || status.nightWakeLight || status.alarmLight);
  }

  function effectiveFan(data) {
    return Boolean(currentLinkage(data).fan);
  }

  function effectiveBuzzer(data) {
    return Boolean(currentLinkage(data).buzzer);
  }

  function effectiveServo(data) {
    return Boolean(currentLinkage(data).servo);
  }

  function effectiveCurtain(data) {
    return Boolean(currentLinkage(data).curtain);
  }

  function effectiveNoMotion(data) {
    return Boolean(currentLinkage(data).noMotion);
  }

  function linkageStatus(data = state.latest) {
    return currentLinkage(data);
  }

  function isCriticalTelemetry(data) {
    return Boolean(data?.sos || data?.fallDetected ||
      data?.dangerLevel === 'co_critical' || data?.alarmText === 'EARTHQUAKE');
  }

  function isCriticalMuted(data, criticalType) {
    return Boolean(data && state.criticalMutedType === criticalType && Date.now() < state.criticalMuteUntil);
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

  Object.assign(App, {
    monitorModel,
    state,
    $,
    updateTopbarGlass,
    bindLiquidGlassInteraction,
    alarmLabel,
    eventTitleLabel,
    dangerLabel,
    criticalTypeOf,
    fmtNumber,
    yesNo,
    onOff,
    setText,
    toggleClass,
    toggleSelectorClass,
    setConnection,
    deriveTelemetry,
    updateDeviceConnection,
    refreshDeviceConnection,
    currentLinkage,
    effectiveLed,
    effectiveFan,
    effectiveBuzzer,
    effectiveServo,
    effectiveCurtain,
    effectiveNoMotion,
    linkageStatus,
    isCriticalTelemetry,
    isCriticalMuted,
    formatUptime,
    formatDuration
  });
}(window));
