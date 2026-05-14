// 前端运行时层：负责事件绑定、数据流同步、演示模式和应用初始化。
(function (window) {
  const App = window.ElderMonitorApp;
  const {
    monitorModel,
    state,
    $,
    setText,
    setConnection,
    criticalTypeOf,
    deriveTelemetry,
    updateTopbarGlass,
    bindLiquidGlassInteraction,
    renderLatest,
    drawTrend,
    renderEvents,
    renderNightRecords,
    renderControls,
    renderThresholds,
    renderDemoButton
  } = App;

  // 读取设置页表单，并归一化成可直接保存的阈值对象。
  function readThresholdForm() {
    const values = {};
    document.querySelectorAll('[data-threshold]').forEach((input) => {
      values[input.dataset.threshold] = input.value;
    });
    document.querySelectorAll('[data-sensor]').forEach((input) => {
      values[input.dataset.sensor] = input.checked;
    });
    return monitorModel.normalizeThresholds(values);
  }

  function setSettingsStatus(text) {
    setText('settingsStatus', text);
  }

  // 本地追加一条事件，供 file 协议演示模式复用。
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

  // 保存联动开关；本地演示写 localStorage，在线模式提交到服务端。
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

  // 保存阈值配置，并在本地演示与在线模式之间复用同一入口。
  async function saveThresholds(nextThresholds) {
    state.thresholds = monitorModel.normalizeThresholds(nextThresholds);
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
    return saveThresholds(monitorModel.createDefaultThresholds());
  }

  // SSE 与本地演示都会走这里，保证状态进入渲染前先完成统一推导。
  function handleTelemetry(data) {
    state.latest = deriveTelemetry(data);
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
    state.controls = { ...monitorModel.createDefaultControls(), ...(controls || {}) };
    renderControls();
  }

  function handleMock(mock) {
    state.mock = { enabled: Boolean(mock?.enabled) };
    renderDemoButton();
    if (!state.mock.enabled && !state.latest) setConnection(false, '等待数据');
  }

  function handleThresholds(thresholds) {
    state.thresholds = monitorModel.normalizeThresholds(thresholds || {});
    renderThresholds();
  }

  async function toggleServerDemo() {
    const response = await fetch('/api/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !state.mock.enabled })
    });
    handleMock(await response.json());
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

  // 本地演示模式下生成一帧模拟数据，并驱动事件与起夜记录联动。
  function tickDemo() {
    const payload = monitorModel.createDemoTelemetry({
      deviceName: 'demo-esp32',
      productKey: 'local-demo',
      thresholds: state.thresholds,
      controls: state.controls
    });
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

  // 统一绑定页面交互事件，避免初始化逻辑散落在多个入口。
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

  // 页面启动入口：恢复本地状态、拉取阈值、连接数据流并挂载交互。
  function initializeApp() {
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
    bindLiquidGlassInteraction();
    updateTopbarGlass();
    connectStream();
    window.addEventListener('scroll', updateTopbarGlass, { passive: true });
    window.addEventListener('resize', () => {
      if ($('trendChart')) drawTrend();
    });
  }

  Object.assign(App, {
    readThresholdForm,
    setSettingsStatus,
    addLocalEvent,
    saveControls,
    saveThresholds,
    resetThresholds,
    handleTelemetry,
    handleHistory,
    handleEvents,
    handleNightRecords,
    handleControls,
    handleMock,
    handleThresholds,
    toggleServerDemo,
    updateLocalNightRecords,
    tickDemo,
    startDemo,
    stopLocalDemo,
    toggleLocalDemo,
    handleDemoButtonClick,
    connectStream,
    bindControls,
    initializeApp
  });
}(window));
