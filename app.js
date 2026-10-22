(() => {
  'use strict';

  const ALERT_THRESHOLD = 15;
  const CHART_MAX_ANGLE = 30;
  const HISTORY_LIMIT = 60;
  const $ = (id) => document.getElementById(id);

  const els = {
    connectBtn: $('connectBtn'), connectBtnText: $('connectBtnText'), deviceConnectBtn: $('deviceConnectBtn'),
    calibrateBtn: $('calibrateBtn'), topConnectionText: $('topConnectionText'), connectionPill: $('connectionPill'),
    sideDot: $('sideDot'), sideConnectionText: $('sideConnectionText'), deviceStatusIcon: $('deviceStatusIcon'),
    deviceStatusTitle: $('deviceStatusTitle'), deviceStatusSubtitle: $('deviceStatusSubtitle'), connectionType: $('connectionType'),
    deviceNote: $('deviceNote'), neckAngle: $('neckAngle'), backAngle: $('backAngle'), neckRangeLabel: $('neckRangeLabel'),
    backRangeLabel: $('backRangeLabel'), neckFill: $('neckFill'), backFill: $('backFill'), neckDot: $('neckDot'), backDot: $('backDot'),
    statusCard: $('statusCard'), statusIcon: $('statusIcon'), statusTitle: $('statusTitle'), statusBadge: $('statusBadge'),
    statusDescription: $('statusDescription'), statusFootIcon: $('statusFootIcon'), statusFootText: $('statusFootText'),
    neckDeviceIndicator: $('neckDeviceIndicator'), backDeviceIndicator: $('backDeviceIndicator'), neckDeviceStatus: $('neckDeviceStatus'),
    backDeviceStatus: $('backDeviceStatus'), neckDetailAngle: $('neckDetailAngle'), backDetailAngle: $('backDetailAngle'),
    neckMeter: $('neckMeter'), backMeter: $('backMeter'), chartModeText: $('chartModeText'), chartEmpty: $('chartEmpty'), toast: $('toast')
  };

  const state = {
    mode: 'demo', connected: false, port: null, reader: null, readTask: null, writer: null, keepReading: false,
    neck: 5.2, back: 8.7, firmwareAlert: false, hasLiveReading: false, simulationSlouch: false,
    sampleCounter: 0, lastHistoryAt: 0, history: [], toastTimer: null, animationTimer: null, lastDataAt: Date.now()
  };

  function angleString(value) {
    const absRounded = Math.abs(value) < 0.05 ? 0 : value;
    return `${absRounded > 0 ? '+' : ''}${absRounded.toFixed(1)}`;
  }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3600);
  }

  function deviationFill(value) {
    return `${Math.max(0, Math.min(Math.abs(value) / CHART_MAX_ANGLE * 100, 100))}%`;
  }

  function setRangeStyle(label, fill, value, dot) {
    const outOfRange = Math.abs(value) >= ALERT_THRESHOLD;
    label.textContent = outOfRange ? 'Above threshold' : 'In range';
    label.classList.toggle('bad', outOfRange);
    fill.style.width = deviationFill(value);
    dot.style.background = outOfRange ? '#e8796d' : '#20b8a0';
    return outOfRange;
  }

  function renderReadings() {
    const neckBad = setRangeStyle(els.neckRangeLabel, els.neckFill, state.neck, els.neckDot);
    const backBad = setRangeStyle(els.backRangeLabel, els.backFill, state.back, els.backDot);
    const overallBad = neckBad || backBad;
    const worst = Math.max(Math.abs(state.neck), Math.abs(state.back));

    els.neckAngle.textContent = angleString(state.neck);
    els.backAngle.textContent = angleString(state.back);
    els.neckDetailAngle.textContent = `${angleString(state.neck)}°`;
    els.backDetailAngle.textContent = `${angleString(state.back)}°`;
    els.neckMeter.style.width = deviationFill(state.neck);
    els.backMeter.style.width = deviationFill(state.back);
    els.neckMeter.style.background = neckBad ? '#e8796d' : '#7b87ec';
    els.backMeter.style.background = backBad ? '#e8796d' : '#38beae';

    els.statusIcon.classList.toggle('bad', overallBad);
    els.statusIcon.classList.toggle('good', !overallBad);
    els.statusIcon.textContent = overallBad ? '!' : '✓';
    els.statusBadge.classList.toggle('bad', overallBad);
    els.statusBadge.classList.toggle('good', !overallBad);
    els.statusBadge.textContent = overallBad ? 'Needs attention' : 'Within range';
    els.statusTitle.textContent = overallBad ? 'Posture needs attention' : 'Looking good';
    els.statusDescription.textContent = overallBad
      ? `Your ${neckBad && backBad ? 'neck and back angles are' : neckBad ? 'neck angle is' : 'back angle is'} at or above ${ALERT_THRESHOLD}°. Try returning to your calibrated position.`
      : 'Both sensors are below the 15° alert threshold.';
    els.statusFootIcon.textContent = overallBad ? '!' : '✓';
    els.statusFootText.textContent = overallBad ? `Maximum deviation: ${worst.toFixed(1)}°` : 'You are in your target range';
    els.statusFootText.parentElement.style.color = overallBad ? '#d86a5f' : '#5a9c8d';
  }

  function addHistorySample(force = false) {
    const now = Date.now();
    if (!force && now - state.lastHistoryAt < 850) return;
    state.lastHistoryAt = now;
    state.history.push({ t: now, neck: Math.abs(state.neck), back: Math.abs(state.back) });
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    renderChart();
  }

  function renderChart() {
    const canvas = $('angleChart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const pad = { top: 14, right: 10, bottom: 26, left: 29 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    ctx.clearRect(0, 0, width, height);
    if (state.history.length < 2) {
      els.chartEmpty.hidden = false;
      return;
    }
    els.chartEmpty.hidden = true;

    ctx.font = '10px DM Sans, sans-serif';
    ctx.textBaseline = 'middle';
    [0, 10, 20, 30].forEach((tick) => {
      const y = pad.top + plotH - (tick / CHART_MAX_ANGLE) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y);
      ctx.strokeStyle = '#eef1f7'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#a2a9ba'; ctx.textAlign = 'right'; ctx.fillText(String(tick), pad.left - 8, y);
    });

    const thresholdY = pad.top + plotH - (ALERT_THRESHOLD / CHART_MAX_ANGLE) * plotH;
    ctx.save(); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, thresholdY); ctx.lineTo(width - pad.right, thresholdY);
    ctx.strokeStyle = '#efbb78'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#c99a58'; ctx.textAlign = 'right'; ctx.fillText('15°', width - pad.right, thresholdY - 8);

    const lines = [
      { key: 'neck', color: '#7986ed', fill: 'rgba(121,134,237,.08)' },
      { key: 'back', color: '#31bdad', fill: 'rgba(49,189,173,.07)' }
    ];
    lines.forEach((line) => {
      const points = state.history.map((sample, index) => ({
        x: pad.left + (index / Math.max(1, state.history.length - 1)) * plotW,
        y: pad.top + plotH - (Math.min(sample[line.key], CHART_MAX_ANGLE) / CHART_MAX_ANGLE) * plotH
      }));
      ctx.beginPath();
      points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = line.color; ctx.stroke();
      const final = points[points.length - 1];
      ctx.beginPath(); ctx.arc(final.x, final.y, 3.2, 0, Math.PI * 2); ctx.fillStyle = line.color; ctx.fill();
      ctx.beginPath(); ctx.arc(final.x, final.y, 6, 0, Math.PI * 2); ctx.strokeStyle = line.fill; ctx.lineWidth = 3; ctx.stroke();
    });

    ctx.fillStyle = '#a2a9ba'; ctx.textAlign = 'left';
    ctx.fillText('Earlier', pad.left, height - 9);
    ctx.textAlign = 'right'; ctx.fillText('Now', width - pad.right, height - 9);
  }

  function setMode(mode) {
    state.mode = mode;
    const live = mode === 'live';
    els.topConnectionText.textContent = live ? 'USB connected' : 'Demo mode';
    els.connectionPill.classList.toggle('is-live', live);
    els.sideDot.classList.toggle('is-live', live);
    els.sideConnectionText.textContent = live ? 'ESP32 connected' : 'Demo data active';
    els.connectBtnText.textContent = live ? 'Disconnect' : 'Connect device';
    els.deviceConnectBtn.textContent = live ? 'Disconnect device' : 'Connect ESP32';
    els.deviceStatusTitle.textContent = live ? (state.hasLiveReading ? 'ESP32 connected' : 'Waiting for sensor data') : 'Running in demo mode';
    els.deviceStatusSubtitle.textContent = live
      ? 'Listening for neck and back angles over USB serial.'
      : 'Example values are shown so you can explore the dashboard.';
    els.connectionType.textContent = live ? 'USB serial · 115200 baud' : 'Demo mode';
    els.chartModeText.textContent = live ? 'Live sensor readings' : 'Demo readings';
    els.neckDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.backDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.neckDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.backDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.neckDot.style.background = live && !state.hasLiveReading ? '#e9b66f' : '#20b8a0';
    els.backDot.style.background = live && !state.hasLiveReading ? '#e9b66f' : '#20b8a0';
    els.calibrateBtn.disabled = live && !state.hasLiveReading;
    const demoButton = $('simulateSlouchBtn');
    if (demoButton) demoButton.hidden = live;
    els.deviceNote.textContent = live
      ? 'Calibration sends CALIBRATE to the firmware. Angle values are relative to that reference.'
      : 'For live data, connect your ESP32 over USB in a desktop Chromium browser.';
  }

  function updateFromLine(line) {
    // Firmware telemetry format: N:5.2,B:8.7,ALERT:0
    const neck = line.match(/(?:^|[,\s])N\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const back = line.match(/(?:^|[,\s])B\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const alert = line.match(/(?:^|[,\s])ALERT\s*:\s*([01])/i);
    if (!neck || !back) return;
    const n = Number(neck[1]);
    const b = Number(back[1]);
    if (!Number.isFinite(n) || !Number.isFinite(b)) return;
    state.neck = n;
    state.back = b;
    if (alert) state.firmwareAlert = alert[1] === '1';
    state.hasLiveReading = true;
    state.lastDataAt = Date.now();
    if (els.deviceStatusTitle) els.deviceStatusTitle.textContent = 'ESP32 connected';
    els.neckDeviceStatus.textContent = 'Reading';
    els.backDeviceStatus.textContent = 'Reading';
    els.neckDeviceIndicator.className = 'tiny-indicator good';
    els.backDeviceIndicator.className = 'tiny-indicator good';
    renderReadings();
    addHistorySample();
  }

  async function connectSerial() {
    if (!('serial' in navigator)) {
      showToast('USB serial is not available in this browser. Open this dashboard in a desktop Chromium browser over HTTPS or localhost.', true);
      return;
    }
    if (!window.isSecureContext) {
      showToast('Live USB connection needs HTTPS or localhost. Demo mode is still available here.', true);
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      state.simulationSlouch = false;
      const slouchButton = $('simulateSlouchBtn');
      if (slouchButton) slouchButton.textContent = 'Simulate slouch';
      await port.open({ baudRate: 115200 });
      state.port = port;
      state.connected = true;
      state.keepReading = true;
      state.hasLiveReading = false;
      setMode('live');
      showToast('Connected. Waiting for the ESP32 angle stream…');
      state.readTask = readSerialLoop(port);
    } catch (error) {
      if (error && error.name === 'NotFoundError') return;
      console.error('Serial connection error:', error);
      showToast(`Could not connect to the device${error && error.message ? `: ${error.message}` : '.'}`, true);
    }
  }

  async function readSerialLoop(port) {
    let buffer = '';
    try {
      while (port.readable && state.keepReading) {
        state.reader = port.readable.getReader();
        try {
          while (state.keepReading) {
            const { value, done } = await state.reader.read();
            if (done) break;
            if (!value) continue;
            buffer += value;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) updateFromLine(line.trim());
            if (buffer.length > 512) buffer = buffer.slice(-128);
          }
        } finally {
          if (state.reader) {
            try { state.reader.releaseLock(); } catch (_) { /* Reader may already be released. */ }
            state.reader = null;
          }
        }
      }
    } catch (error) {
      if (state.keepReading) {
        console.error('Serial read error:', error);
        showToast('The serial stream stopped. Check the cable and reopen the connection.', true);
      }
    } finally {
      if (state.keepReading) await disconnectSerial(false);
    }
  }

  async function sendSerialCommand(command) {
    if (!state.port || !state.port.writable) throw new Error('The device is not connected.');
    const writer = state.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${command}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  async function disconnectSerial(showMessage = true) {
    state.keepReading = false;
    state.connected = false;
    state.simulationSlouch = false;
    const slouchButton = $('simulateSlouchBtn');
    if (slouchButton) slouchButton.textContent = 'Simulate slouch';
    const port = state.port;
    state.port = null;
    if (state.reader) {
      try { await state.reader.cancel(); } catch (_) { /* Port may already have stopped. */ }
    }
    if (port) {
      try { await port.close(); } catch (error) { console.warn('Port close:', error); }
    }
    setMode('demo');
    if (showMessage) showToast('Device disconnected. Demo readings are back on.');
  }

  async function toggleConnection() {
    if (state.mode === 'live') await disconnectSerial();
    else await connectSerial();
  }

  async function calibrate() {
    if (state.mode === 'live') {
      try {
        await sendSerialCommand('CALIBRATE');
        showToast('Calibration command sent. Sit or stand in your reference posture while it completes.');
      } catch (error) {
        showToast(error.message || 'Could not send the calibration command.', true);
      }
      return;
    }
    state.simulationSlouch = false;
    state.neck = 0;
    state.back = 0;
    state.history = [];
    renderReadings();
    addHistorySample(true);
    showToast('Demo reference reset. Connect the ESP32 to calibrate real sensors.');
  }

  function updateDemo() {
    if (state.mode !== 'demo') return;
    state.sampleCounter += 1;
    const t = state.sampleCounter;
    if (state.simulationSlouch) {
      state.neck = 18.4 + Math.sin(t / 3) * 1.8;
      state.back = 16.8 + Math.sin(t / 4 + .9) * 1.4;
    } else {
      state.neck = 5.2 + Math.sin(t / 6) * 2.2 + Math.sin(t / 15) * .8;
      state.back = 8.7 + Math.sin(t / 8 + .8) * 2.7 + Math.sin(t / 14) * .7;
    }
    renderReadings();
    addHistorySample();
  }

  function toggleSlouch() {
    if (state.mode !== 'demo') {
      showToast('Slouch simulation is only available in demo mode.', true);
      return;
    }
    state.simulationSlouch = !state.simulationSlouch;
    if (!state.simulationSlouch) {
      state.neck = 6.1;
      state.back = 8.2;
    }
    renderReadings();
    addHistorySample(true);
    showToast(state.simulationSlouch ? 'Demo slouch enabled. Both angle readings are above the 15° threshold.' : 'Demo posture returned to the target range.');
    $('simulateSlouchBtn').textContent = state.simulationSlouch ? 'Return to good posture' : 'Simulate slouch';
  }

  function addSimulationControl() {
    const deviceActions = document.querySelector('.device-actions');
    const button = document.createElement('button');
    button.className = 'button button-secondary button-wide';
    button.id = 'simulateSlouchBtn';
    button.type = 'button';
    button.textContent = 'Simulate slouch';
    button.addEventListener('click', toggleSlouch);
    deviceActions.appendChild(button);
    window.addEventListener('beforeunload', () => {
      state.keepReading = false;
      if (state.reader) state.reader.cancel().catch(() => {});
      if (state.port) state.port.close().catch(() => {});
    });
  }

  els.connectBtn.addEventListener('click', toggleConnection);
  els.deviceConnectBtn.addEventListener('click', toggleConnection);
  els.calibrateBtn.addEventListener('click', calibrate);
  $('simulateSlouchBtn')?.addEventListener('click', toggleSlouch);
  window.addEventListener('resize', renderChart);

  setMode('demo');
  renderReadings();
  for (let i = 0; i < 12; i++) {
    const n = state.neck + Math.sin(i / 2) * 1.3;
    const b = state.back + Math.sin(i / 2 + .8) * 1.7;
    state.history.push({ t: Date.now() - (12 - i) * 1000, neck: Math.abs(n), back: Math.abs(b) });
  }
  renderChart();
  // Add the demo-only slouch test without making the live UI pretend to be hardware.
  addSimulationControl();
  state.animationTimer = setInterval(updateDemo, 1000);
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (state.port && event.target === state.port) disconnectSerial();
    });
  }
})();