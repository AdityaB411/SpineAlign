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
    neckMeter: $('neckMeter'), backMeter: $('backMeter'), chartModeText: $('chartModeText'), chartEmpty: $('chartEmpty'), toast: $('toast'),
    batteryCard: $('battery'), batteryPercent: $('batteryPercent'), batteryVoltage: $('batteryVoltage'), batteryState: $('chargerState'),
    batteryStatusPill: $('batteryStatusPill'), batteryProgress: $('batteryProgress'), batteryProgressTrack: $('batteryProgressTrack'),
    batteryGlyphFill: $('batteryGlyphFill'), batteryHint: $('batteryHint'), batteryMonitorState: $('batteryMonitorState'), chargerSignalState: $('chargerSignalState'), batteryLevelCaption: $('batteryLevelCaption')
  };

  const state = {
    mode: 'demo', connected: false, port: null, reader: null, readTask: null, writer: null, keepReading: false,
    neck: 5.2, back: 8.7, neckPitch: 4.0, neckRoll: 0.8, backPitch: 7.0, backRoll: -1.2,
    batteryVoltage: 3.87, batteryPercent: 78, batteryCharging: false, batteryFull: false, batteryAvailable: false,
    calibrationKnown: false, isCalibrated: false, firmwareAlert: false, firmwareAlertKnown: false,
    neckSensorOk: true, backSensorOk: true, linkStale: false, chargerStatusAvailable: false,
    hasLiveReading: false, simulationSlouch: false, sampleCounter: 0, lastHistoryAt: 0,
    history: [], toastTimer: null, animationTimer: null, freshnessTimer: null, lastDataAt: Date.now()
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
    dot.style.background = outOfRange ? '#c77f72' : '#789d80';
    return outOfRange;
  }

  function renderReadings() {
    const neckBad = setRangeStyle(els.neckRangeLabel, els.neckFill, state.neck, els.neckDot);
    const backBad = setRangeStyle(els.backRangeLabel, els.backFill, state.back, els.backDot);
    const live = state.mode === 'live';
    const stale = live && state.linkStale;
    const waiting = live && !state.hasLiveReading && !stale;
    const sensorFault = live && state.hasLiveReading && (!state.neckSensorOk || !state.backSensorOk);
    const uncalibrated = live && state.hasLiveReading && state.calibrationKnown && !state.isCalibrated && !sensorFault && !stale;
    const overallBad = live && state.firmwareAlertKnown ? state.firmwareAlert : (neckBad || backBad);
    const worst = Math.max(Math.abs(state.neck), Math.abs(state.back));

    els.neckAngle.textContent = angleString(state.neck);
    els.backAngle.textContent = angleString(state.back);
    els.neckDetailAngle.textContent = `${angleString(state.neck)}°`;
    els.backDetailAngle.textContent = `${angleString(state.back)}°`;
    els.neckMeter.style.width = deviationFill(state.neck);
    els.backMeter.style.width = deviationFill(state.back);
    els.neckMeter.style.background = neckBad ? '#c77f72' : '#c28f68';
    els.backMeter.style.background = backBad ? '#c77f72' : '#789d80';

    if (stale) {
      els.neckRangeLabel.textContent = 'No fresh data';
      els.backRangeLabel.textContent = 'No fresh data';
      els.neckRangeLabel.classList.remove('bad');
      els.backRangeLabel.classList.remove('bad');
    } else if (sensorFault) {
      if (!state.neckSensorOk) { els.neckRangeLabel.textContent = 'Sensor offline'; els.neckRangeLabel.classList.add('bad'); }
      if (!state.backSensorOk) { els.backRangeLabel.textContent = 'Sensor offline'; els.backRangeLabel.classList.add('bad'); }
    }

    els.statusIcon.classList.toggle('bad', overallBad || sensorFault || stale);
    els.statusIcon.classList.toggle('good', !overallBad && !sensorFault && !stale);
    els.statusIcon.textContent = overallBad || sensorFault || stale ? '!' : '✓';
    els.statusBadge.classList.toggle('bad', overallBad || sensorFault || stale);
    els.statusBadge.classList.toggle('good', !overallBad && !sensorFault && !stale);

    if (waiting) {
      els.statusTitle.textContent = 'Waiting for sensor data';
      els.statusBadge.textContent = 'Connecting';
      els.statusDescription.textContent = 'USB is connected. Waiting for a valid reading from the firmware.';
      els.statusFootIcon.textContent = '…';
      els.statusFootText.textContent = 'No live sample received yet';
    } else if (stale) {
      els.statusTitle.textContent = 'Live data has stopped';
      els.statusBadge.textContent = 'Stale data';
      els.statusDescription.textContent = 'No valid telemetry has arrived recently. Check the USB cable, serial monitor, and firmware.';
      els.statusFootIcon.textContent = '!';
      els.statusFootText.textContent = 'Displayed angles may be old';
    } else if (sensorFault) {
      els.statusTitle.textContent = 'Sensor unavailable';
      els.statusBadge.textContent = 'Check hardware';
      els.statusDescription.textContent = `${!state.neckSensorOk && !state.backSensorOk ? 'Both sensors are' : !state.neckSensorOk ? 'The neck sensor is' : 'The back sensor is'} not responding. Affected angle values may be from an earlier sample.`;
      els.statusFootIcon.textContent = '!';
      els.statusFootText.textContent = 'Posture monitoring is paused';
    } else if (uncalibrated) {
      els.statusTitle.textContent = 'Calibration needed';
      els.statusBadge.textContent = 'Not calibrated';
      els.statusDescription.textContent = 'Hold a comfortable upright reference posture and calibrate before monitoring deviations.';
      els.statusFootIcon.textContent = 'i';
      els.statusFootText.textContent = 'Readings are not yet relative to your reference';
    } else {
      els.statusTitle.textContent = overallBad ? 'Posture needs attention' : 'Looking good';
      els.statusBadge.textContent = overallBad ? 'Needs attention' : 'Within range';
      els.statusDescription.textContent = overallBad
        ? `Your ${neckBad && backBad ? 'neck and back angles are' : neckBad ? 'neck angle is' : 'back angle is'} outside the configured range. Return toward your calibrated position.`
        : 'Both sensors are below the configured posture threshold.';
      els.statusFootIcon.textContent = overallBad ? '!' : '✓';
      els.statusFootText.textContent = overallBad ? `Maximum deviation: ${worst.toFixed(1)}°` : 'You are in your target range';
    }
    els.statusFootText.parentElement.style.color = (overallBad || sensorFault || stale) ? '#b95f51' : uncalibrated || waiting ? '#9b7947' : '#587c5d';
    updateModelOrientation();
  }

  function updateModelOrientation() {
    if (window.SpineAlign3D && typeof window.SpineAlign3D.updateTelemetry === 'function') window.SpineAlign3D.updateTelemetry({ neckPitch: state.neckPitch, neckRoll: state.neckRoll, backPitch: state.backPitch, backRoll: state.backRoll, mode: state.mode });
  }

  function renderBattery() {
    if (!els.batteryPercent) return;
    const live = state.mode === 'live';
    const unknown = live && !state.batteryAvailable;
    const chargerUnknown = live && !unknown && !state.chargerStatusAvailable;
    const percent = state.batteryPercent, voltage = state.batteryVoltage;
    const charging = live && !unknown && !chargerUnknown && state.batteryCharging;
    const full = live && !unknown && !chargerUnknown && state.batteryFull;
    els.batteryCard?.classList.toggle('is-charging', charging);
    els.batteryCard?.classList.toggle('is-low', !unknown && percent <= 20);
    els.batteryPercent.textContent = unknown ? '—' : `${Math.round(percent)}%`;
    els.batteryVoltage.textContent = unknown ? 'Not reported' : `${voltage.toFixed(2)} V`;
    els.batteryLevelCaption.textContent = unknown ? 'No battery telemetry' : live ? 'Estimated charge' : 'Demo estimate';
    els.batteryProgress.style.width = unknown ? '0%' : `${Math.max(0, Math.min(100, percent))}%`;
    els.batteryProgress.classList.toggle('is-charging', charging);
    els.batteryProgress.classList.toggle('low', !unknown && percent <= 20);
    els.batteryProgress.classList.toggle('unknown', unknown);
    els.batteryProgress.classList.toggle('is-demo', !live);
    els.batteryProgressTrack.setAttribute('aria-valuenow', unknown ? '0' : String(Math.round(percent)));
    els.batteryProgressTrack.setAttribute('aria-valuetext', unknown ? 'Battery telemetry unavailable' : `${Math.round(percent)} percent estimated charge`);
    els.batteryGlyphFill.style.width = unknown ? '0%' : `${Math.max(0, Math.min(100, percent))}%`;
    els.batteryGlyphFill.classList.toggle('charging', charging);
    els.batteryGlyphFill.classList.toggle('low', !unknown && percent <= 20);
    els.batteryStatusPill.className = `battery-status-pill ${unknown ? 'unknown' : charging ? 'charging' : full ? 'full' : !live ? 'demo' : percent <= 20 ? 'low' : ''}`;
    els.batteryStatusPill.textContent = unknown ? 'Telemetry unavailable' : charging ? 'Charging' : full ? 'Near full (estimate)' : !live ? 'Demo preview' : chargerUnknown ? 'Charger status unknown' : percent <= 20 ? 'Low battery' : 'Not charging';
    els.batteryState.textContent = unknown ? 'Not reported by device' : charging ? 'Charging in progress' : full ? 'Near-full voltage estimate' : !live ? 'Demo · Not charging' : chargerUnknown ? 'Status not reported' : 'Not charging';
    els.batteryMonitorState.textContent = unknown ? 'Not enabled / not wired' : live ? 'Live telemetry' : 'Demo values';
    els.chargerSignalState.textContent = unknown ? 'No battery signal' : charging ? 'TP4056 CHRG active' : full ? 'Voltage suggests near full' : !live ? 'Preview only' : chargerUnknown ? 'No reliable charger state' : 'No active charge signal';
    els.batteryHint.textContent = unknown
      ? 'The connected firmware is not reporting battery data. Enable the hardware battery monitor and wire the divider and charger status output.'
      : charging
        ? 'Charging is detected from the TP4056 active-low CHRG status output.'
        : full
          ? 'Voltage is near the full-charge range; this cannot confirm that a charger is connected or charging has completed.'
          : chargerUnknown
            ? 'Battery voltage is available, but the firmware did not report a valid charger state.'
            : !live
              ? 'Demo values preview the battery UI and are not real battery measurements.'
              : 'Battery percentage is estimated from voltage and should be calibrated for the actual cell.';
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
      ctx.strokeStyle = '#e3e8de'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#7f8a80'; ctx.textAlign = 'right'; ctx.fillText(String(tick), pad.left - 8, y);
    });

    const thresholdY = pad.top + plotH - (ALERT_THRESHOLD / CHART_MAX_ANGLE) * plotH;
    ctx.save(); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, thresholdY); ctx.lineTo(width - pad.right, thresholdY);
    ctx.strokeStyle = '#c59a66'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#a98250'; ctx.textAlign = 'right'; ctx.fillText('15°', width - pad.right, thresholdY - 8);

    const lines = [
      { key: 'neck', color: '#c28f68', fill: 'rgba(194,143,104,.10)' },
      { key: 'back', color: '#789d80', fill: 'rgba(120,157,128,.10)' }
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

    ctx.fillStyle = '#7f8a80'; ctx.textAlign = 'left';
    ctx.fillText('Earlier', pad.left, height - 9);
    ctx.textAlign = 'right'; ctx.fillText('Now', width - pad.right, height - 9);
  }

  function setMode(mode) {
    state.mode = mode;
    const live = mode === 'live';
    if (window.SpineAlign3D && typeof window.SpineAlign3D.setMode === 'function') window.SpineAlign3D.setMode(mode);
    renderBattery();
    els.topConnectionText.textContent = live ? 'USB connected' : 'Demo mode';
    els.connectionPill.classList.toggle('is-live', live);
    els.sideDot.classList.toggle('is-live', live);
    els.sideConnectionText.textContent = live ? 'ESP32 connected' : 'Demo data active';
    els.connectBtnText.textContent = live ? 'Disconnect' : 'Connect device';
    els.deviceConnectBtn.textContent = live ? 'Disconnect device' : 'Connect ESP32';
    els.deviceStatusTitle.textContent = live ? (state.hasLiveReading ? 'ESP32 connected' : 'Waiting for sensor data') : 'Running in demo mode';
    els.deviceStatusSubtitle.textContent = live
      ? 'Listening for neck/back pitch, roll, posture and battery telemetry over USB serial.'
      : 'Example values are shown so you can explore the dashboard.';
    els.connectionType.textContent = live ? 'USB serial · 115200 baud' : 'Demo mode';
    els.chartModeText.textContent = live ? 'Live sensor readings' : 'Demo readings';
    els.neckDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.backDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.neckDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.backDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.neckDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.backDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.calibrateBtn.disabled = live && !state.hasLiveReading;
    const demoButton = $('simulateSlouchBtn');
    if (demoButton) demoButton.hidden = live;
    els.deviceNote.textContent = live
      ? 'Calibration sends CALIBRATE to the firmware. Orientation depends on sensor mounting; battery fields appear only when the hardware monitor is enabled.'
      : 'For live data, connect your ESP32 over USB in a desktop Chromium browser.';
    renderReadings();
  }

  function updateFromLine(line) {
    // N/B remain scalar overall tilt; NP/NR/BP/BR are sensor pitch/roll.
    const readField = (key) => {
      const match = line.match(new RegExp('(?:^|[,\\s])' + key + '\\s*:\\s*(-?\\d+(?:\\.\\d+)?)', 'i'));
      return match ? Number(match[1]) : null;
    };
    const neck = readField('N'), back = readField('B');
    if (neck === null || back === null || !Number.isFinite(neck) || !Number.isFinite(back)) return;
    state.neck = neck; state.back = back;
    state.neckPitch = readField('NP') ?? neck; state.neckRoll = readField('NR') ?? 0;
    state.backPitch = readField('BP') ?? back; state.backRoll = readField('BR') ?? 0;
    const alert = readField('ALERT');
    if (alert !== null) { state.firmwareAlert = alert === 1; state.firmwareAlertKnown = true; }
    const cal = readField('CAL');
    if (cal !== null) { state.calibrationKnown = true; state.isCalibrated = cal === 1; }
    const neckOk = readField('NS'), backOk = readField('BS');
    state.neckSensorOk = neckOk === null ? true : neckOk === 1;
    state.backSensorOk = backOk === null ? true : backOk === 1;
    const voltage = readField('BAT'), percent = readField('PCT'), charging = readField('CHG'), full = readField('FULL');
    state.batteryAvailable = voltage !== null && percent !== null && voltage > 0 && percent >= 0;
    state.chargerStatusAvailable = charging !== null && charging >= 0 && full !== null && full >= 0;
    if (state.batteryAvailable) {
      state.batteryVoltage = voltage;
      state.batteryPercent = Math.max(0, Math.min(100, percent));
      state.batteryCharging = charging === 1;
      state.batteryFull = full === 1;
    }
    state.hasLiveReading = true;
    state.lastDataAt = Date.now();
    state.linkStale = false;
    els.topConnectionText.textContent = 'USB connected';
    els.connectionPill.classList.add('is-live');
    els.sideDot.classList.add('is-live');
    els.sideConnectionText.textContent = 'ESP32 connected';
    if (els.deviceStatusTitle) els.deviceStatusTitle.textContent = state.calibrationKnown && !state.isCalibrated ? 'ESP32 connected · calibrate sensors' : 'ESP32 connected';
    els.neckDeviceStatus.textContent = 'Reading'; els.backDeviceStatus.textContent = 'Reading';
    els.neckDeviceIndicator.className = 'tiny-indicator good'; els.backDeviceIndicator.className = 'tiny-indicator good';
    renderReadings(); renderBattery(); addHistorySample();
  }

  function handleSerialLine(line) {
    if (line === 'CALIBRATED') {
      state.calibrationKnown = true;
      state.isCalibrated = true;
      showToast('Sensors calibrated successfully.');
      renderReadings();
      return;
    }
    if (line === 'CALIBRATION FAILED') {
      state.calibrationKnown = true;
      state.isCalibrated = false;
      showToast('Calibration failed. Check both sensors and try again.', true);
      renderReadings();
      return;
    }
    updateFromLine(line);
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
      state.linkStale = false;
      state.lastDataAt = Date.now();
      state.calibrationKnown = false;
      state.isCalibrated = false;
      state.firmwareAlertKnown = false;
      state.neckSensorOk = false;
      state.backSensorOk = false;
      state.batteryAvailable = false;
      state.chargerStatusAvailable = false;
      state.history = [];
      state.lastHistoryAt = 0;
      renderChart();
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
            for (const line of lines) handleSerialLine(line.trim());
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
    state.hasLiveReading = false;
    state.linkStale = false;
    state.calibrationKnown = false;
    state.isCalibrated = false;
    state.firmwareAlert = false;
    state.firmwareAlertKnown = false;
    state.neckSensorOk = true;
    state.backSensorOk = true;
    state.chargerStatusAvailable = false;
    state.simulationSlouch = false;
    state.batteryVoltage = 3.87;
    state.batteryPercent = 78;
    state.batteryAvailable = false;
    state.batteryCharging = false;
    state.batteryFull = false;
    state.neckPitch = 4;
    state.neckRoll = 0.8;
    state.backPitch = 7;
    state.backRoll = -1.2;
    state.history = [];
    state.lastHistoryAt = 0;
    renderChart();
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

  function checkLiveFreshness() {
    if (state.mode !== 'live') return;
    const stale = Date.now() - state.lastDataAt > 2500;
    if (stale !== state.linkStale) {
      state.linkStale = stale;
      els.topConnectionText.textContent = stale ? 'No recent data' : 'USB connected';
      els.connectionPill.classList.toggle('is-live', !stale);
      els.sideDot.classList.toggle('is-live', !stale);
      els.sideConnectionText.textContent = stale ? 'Telemetry stalled' : 'ESP32 connected';
      els.deviceStatusTitle.textContent = stale ? 'No recent telemetry' : 'ESP32 connected';
      renderReadings();
    }
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
    state.neckPitch = state.neckRoll = state.backPitch = state.backRoll = 0;
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
    state.neckPitch = state.neck; state.neckRoll = Math.sin(t / 5) * (state.simulationSlouch ? 5 : 1.8);
    state.backPitch = state.back; state.backRoll = Math.cos(t / 6) * (state.simulationSlouch ? 4 : 2.4);
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
      state.neck = 6.1; state.back = 8.2;
      state.neckPitch = 5.4; state.neckRoll = 1.8; state.backPitch = 7.6; state.backRoll = -2.0;
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
      clearInterval(state.animationTimer);
      clearInterval(state.freshnessTimer);
      clearTimeout(state.toastTimer);
    });
  }

  els.connectBtn.addEventListener('click', toggleConnection);
  els.deviceConnectBtn.addEventListener('click', toggleConnection);
  els.calibrateBtn.addEventListener('click', calibrate);
  $('simulateSlouchBtn')?.addEventListener('click', toggleSlouch);
  window.addEventListener('resize', renderChart);

  setMode('demo');
  renderBattery();
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
  state.freshnessTimer = setInterval(checkLiveFreshness, 500);
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (state.port && event.target === state.port) disconnectSerial();
    });
  }
})();