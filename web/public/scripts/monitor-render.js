// 前端渲染层：负责把状态映射到总览页、设置页、联动页和弹窗界面。
(function (window) {
  const App = window.ElderMonitorApp;
  const {
    state,
    $,
    alarmLabel,
    eventTitleLabel,
    dangerLabel,
    fmtNumber,
    yesNo,
    onOff,
    setText,
    toggleClass,
    toggleSelectorClass,
    setConnection,
    effectiveLed,
    effectiveFan,
    effectiveBuzzer,
    effectiveServo,
    effectiveCurtain,
    linkageStatus,
    isCriticalTelemetry,
    criticalTypeOf,
    isCriticalMuted,
    refreshDeviceConnection,
    formatUptime,
    formatDuration
  } = App;

  // 汇总告警态样式，统一控制顶部和主状态卡的视觉反馈。
  function renderStatusClasses(data, activeCritical, muted) {
    toggleClass('statusPanel', 'warn', Boolean(data.alarmAny || data.sos));
    toggleClass('statusPanel', 'critical', activeCritical);
    toggleClass('statusPanel', 'offline', !state.deviceOnline && Boolean(data));
    toggleSelectorClass('.topbar', 'critical-active', activeCritical);
    toggleClass('alertStrip', 'warning', Boolean((data.alarmAny || muted) && !activeCritical));
    toggleClass('alertStrip', 'danger', activeCritical);
    toggleClass('alertStrip', 'offline', !state.deviceOnline && Boolean(data));
  }

  // 渲染总览页顶部关键读数，保证首页一屏就能看懂当前状态。
  function renderHeroReadings(data) {
    setText('alarmText', alarmLabel(data.alarmText));
    setText('deviceText', `${data.deviceName || '--'} ${data.productKey ? ` | ${data.productKey}` : ''}`);
    setText('temperature', fmtNumber(data.temperatureC));
    setText('humidity', fmtNumber(data.humidity, 0));
    setText('lux', fmtNumber(data.lux, 0));
    setText('mq2Hero', data.mq2Raw ?? '--');
    setText('mq135Hero', data.mq135Raw ?? '--');
    setText('mq7Hero', data.mq7Raw ?? '--');
  }

  function renderSensorReadings(data) {
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
  }

  function renderActuatorReadings(data) {
    setText('ledOn', onOff(effectiveLed(data)));
    setText('fanOn', onOff(effectiveFan(data)));
    setText('buzzerOn', onOff(effectiveBuzzer(data)));
    setText('servoOn', effectiveServo(data) ? '动作' : '复位');
    setText('curtainOn', effectiveCurtain(data) ? '关闭' : '待机');
  }

  function renderStatePills(data) {
    setText('sosPill', data.sos ? 'SOS 已触发' : 'SOS 正常');
    setText('fallPill', data.fallDetected ? '疑似跌倒' : '跌倒正常');
    setText('nightPill', data.nightActivity ? '起夜开灯中' : '未检测起夜');
    toggleClass('sosPill', 'critical', Boolean(data.sos));
    toggleClass('fallPill', 'critical', Boolean(data.fallDetected));
  }

  function renderAlertSummary(data, critical, muted = false) {
    if (!state.deviceOnline) {
      setText('alertIcon', '!');
      setText('alertHeadline', '设备下线');
      setText('alertMessage', '已超过离线阈值未收到设备数据，页面保留最后一次有效读数，设置已锁定。');
      return;
    }

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
      if (data.alarmText === 'NO MOTION') setText('alertMessage', '长时间无活动，已记录提醒，请关注老人状态。');
      else if (data.alarmText === 'VIBRATION') setText('alertMessage', '检测到振动异常，已记录事件并联动提醒。');
      else setText('alertMessage', '系统检测到异常状态，已记录事件并执行本地联动。');
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

  // 更新右上角告警弹窗内容，并处理已确认后的静默展示。
  function renderTopBanner(data, critical, muted = false) {
    const banner = $('criticalBanner');
    if (!banner) return;
    const offline = !state.deviceOnline && Boolean(data);
    const shouldShow = offline || critical || muted || Boolean(data.alarmAny || data.nightActivity);
    banner.hidden = false;
    banner.classList.toggle('danger', critical);
    banner.classList.toggle('offline', offline);
    banner.classList.toggle('warning', !critical && !offline && Boolean(data.alarmAny || data.nightActivity || muted));
    banner.classList.toggle('safe', !critical && !offline && !data.alarmAny && !data.nightActivity && !muted);
    banner.classList.toggle('show', shouldShow);
    if (offline) {
      setText('criticalIcon', '!');
      setText('criticalTitle', '设备下线');
      setText('criticalText', '当前显示为最后一次有效数据。网络恢复并收到新数据前，阈值和联动设置已锁定。');
      return;
    }
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

    if (data.alarmAny || data.nightActivity || muted) {
      setText('criticalIcon', data.alarmText === 'NO MOTION' ? '时' : data.alarmText === 'VIBRATION' ? '震' : '!');
      setText('criticalTitle', muted ? '告警已确认' : alarmLabel(data.alarmText) || '异常提醒');
      if (data.alarmText === 'NO MOTION') setText('criticalText', '长时间无活动已触发提醒，请检查现场。');
      else if (data.alarmText === 'VIBRATION') setText('criticalText', '检测到振动异常，请留意设备或现场环境。');
      else if (data.nightActivity) setText('criticalText', '暗环境检测到人体活动，已联动开灯。');
      else setText('criticalText', '系统检测到异常状态，请查看对应监测卡片。');
      return;
    }

    banner.hidden = true;
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
    setText('cloudStatus', state.deviceOnline ? '实时在线' : '设备下线');
    setText('cloudProduct', data.productKey || '--');
    setText('cloudDeviceName', data.deviceName || '--');
    setText('lastSeen', new Date(data.timestamp).toLocaleTimeString());
    if ($('riskBar')) $('riskBar').style.width = `${score}%`;
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

  // 根据最新历史数据重绘趋势图，兼顾高 DPI 画布缩放。
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

  function renderDemoButton() {
    const button = $('demoButton');
    if (!button) return;
    const enabled = location.protocol === 'file:' ? Boolean(state.demoTimer) : Boolean(state.mock.enabled);
    const label = button.querySelector('strong');
    if (label) label.textContent = enabled ? '开启' : '关闭';
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  function renderControls() {
    document.querySelectorAll('[data-control]').forEach((input) => {
      input.checked = Boolean(state.controls[input.dataset.control]);
      input.disabled = !state.deviceOnline && location.protocol !== 'file:';
    });
    renderDemoButton();
    renderLatest(state.latest);
    renderAutomationPage(state.latest);
  }

  function renderThresholds() {
    document.querySelectorAll('[data-threshold]').forEach((input) => {
      input.value = state.thresholds[input.dataset.threshold] ?? '';
      input.disabled = !state.deviceOnline && location.protocol !== 'file:';
    });
    document.querySelectorAll('[data-sensor]').forEach((input) => {
      input.checked = Boolean(state.thresholds[input.dataset.sensor]);
      input.disabled = !state.deviceOnline && location.protocol !== 'file:';
    });
    document.querySelectorAll('#thresholdForm button').forEach((button) => {
      button.disabled = !state.deviceOnline && location.protocol !== 'file:';
    });
    if (!state.deviceOnline && location.protocol !== 'file:') {
      setText('settingsStatus', '设备离线，设置锁定');
    }
    renderLatest(state.latest);
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
    setText('automationSummary', online ? `当前危险等级：${dangerLabel(data.dangerLevel)}，主告警：${alarmLabel(data.alarmText)}${state.deviceOnline ? '' : '，设备已下线'}` : '等待设备数据或启动演示数据。');
    document.querySelectorAll('[data-status-key]').forEach((node) => {
      const active = Boolean(status[node.dataset.statusKey]);
      node.classList.toggle('active', active);
      node.classList.toggle('inactive', !active);
    });
  }

  // 总入口：把一帧遥测数据分发到各个页面区域。
  function renderLatest(data) {
    if (!data) {
      refreshDeviceConnection();
      return;
    }

    refreshDeviceConnection();
    const critical = isCriticalTelemetry(data);
    const criticalType = criticalTypeOf(data);
    const muted = isCriticalMuted(data, criticalType);
    const activeCritical = critical && !muted;

    renderStatusClasses(data, activeCritical, muted);
    renderHeroReadings(data);
    renderSensorReadings(data);
    renderActuatorReadings(data);
    renderStatePills(data);
    setText('updatedAt', new Date(data.timestamp).toLocaleString());
    renderOperationalSummary(data);
    renderAlertSummary(data, activeCritical, muted);
    renderDangerCards(data);
    renderTopBanner(data, activeCritical, muted);
    renderAutomationPage(data);

    if ($('ackCritical')) $('ackCritical').hidden = !(activeCritical && !muted);
  }

  Object.assign(App, {
    renderStatusClasses,
    renderHeroReadings,
    renderSensorReadings,
    renderActuatorReadings,
    renderStatePills,
    renderAlertSummary,
    renderTopBanner,
    renderOperationalSummary,
    renderDangerCards,
    drawTrend,
    renderEvents,
    renderNightRecords,
    renderDemoButton,
    renderControls,
    renderThresholds,
    renderAutomationPage,
    renderLatest
  });
}(window));
