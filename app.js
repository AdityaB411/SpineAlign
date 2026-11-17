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
    batteryGlyphFill: $('batteryGlyphFill'), batteryHint: $('batteryHint'), batteryMonitorState: $('batteryMonitorState'), chargerSignalState: $('chargerSignalState'), batteryLevelCaption: $('batteryLevelCaption'),
    tabWifi: $('tabWifi'), tabUsb: $('tabUsb'), tabBle: $('tabBle'), wifiConfigPanel: $('wifiConfigPanel'), wifiHostInput: $('wifiHostInput'), wifiPortInput: $('wifiPortInput')
  };

  const state = {
    mode: 'demo', connected: false, port: null, reader: null, readTask: null, writer: null, keepReading: false,
    selectedTransport: 'ble',
    singleSensorMode: false,
    neck: 5.2, back: 8.7, neckPitch: 4.0, neckRoll: 0.8, neckTwist: 0.0, backPitch: 7.0, backRoll: -1.2, backTwist: 0.0,
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
    document.body.classList.toggle('single-sensor-mode', live && state.singleSensorMode);
    const sensorFault = live && state.hasLiveReading && (state.singleSensorMode ? !state.backSensorOk : (!state.neckSensorOk || !state.backSensorOk));
    const uncalibrated = live && state.hasLiveReading && state.calibrationKnown && !state.isCalibrated && !sensorFault && !stale;
    const overallBad = live && state.firmwareAlertKnown ? state.firmwareAlert : (state.singleSensorMode ? backBad : (neckBad || backBad));
    const worst = state.singleSensorMode ? Math.abs(state.back) : Math.max(Math.abs(state.neck), Math.abs(state.back));

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
      els.statusDescription.textContent = 'Device link is connected. Waiting for a valid reading from the firmware.';
      els.statusFootIcon.textContent = '…';
      els.statusFootText.textContent = 'No live sample received yet';
    } else if (stale) {
      els.statusTitle.textContent = 'Live data has stopped';
      els.statusBadge.textContent = 'Stale data';
      els.statusDescription.textContent = 'No valid telemetry has arrived recently. Check the device connection and firmware.';
      els.statusFootIcon.textContent = '!';
      els.statusFootText.textContent = 'Displayed angles may be old';
    } else if (sensorFault) {
      els.statusTitle.textContent = 'Sensor unavailable';
      els.statusBadge.textContent = 'Check hardware';
      els.statusDescription.textContent = `${state.singleSensorMode ? 'The back sensor is' : !state.neckSensorOk && !state.backSensorOk ? 'Both sensors are' : !state.neckSensorOk ? 'The neck sensor is' : 'The back sensor is'} not responding. Affected angle values may be from an earlier sample.`;
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
        : (state.singleSensorMode ? 'The back sensor is below the configured posture threshold.' : 'Both sensors are below the configured posture threshold.');
      els.statusFootIcon.textContent = overallBad ? '!' : '✓';
      els.statusFootText.textContent = overallBad ? `Maximum deviation: ${worst.toFixed(1)}°` : 'You are in your target range';
    }
    els.statusFootText.parentElement.style.color = (overallBad || sensorFault || stale) ? '#b95f51' : uncalibrated || waiting ? '#9b7947' : '#587c5d';
    updateModelOrientation();
  }

  function updateModelOrientation() {
    if (window.SpineAlign3D && typeof window.SpineAlign3D.updateTelemetry === 'function') {
      window.SpineAlign3D.updateTelemetry({
        neckPitch: state.neckPitch,
        neckRoll: state.neckRoll,
        neckTwist: state.neckTwist ?? 0,
        backPitch: state.backPitch,
        backRoll: state.backRoll,
        backTwist: state.backTwist ?? 0,
        mode: state.mode,
        alert: state.firmwareAlert || (state.back > 15 || state.neck > 15),
        singleSensorMode: state.singleSensorMode,
        timestamp: performance.now()
      });
    }
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

    const allLines = [
      { key: 'neck', color: '#c28f68', fill: 'rgba(194,143,104,.10)' },
      { key: 'back', color: '#789d80', fill: 'rgba(120,157,128,.10)' }
    ];
    const lines = state.singleSensorMode ? allLines.filter((line) => line.key === 'back') : allLines;
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
    const isWifi = (state.port && state.port.transport === 'wifi') || state.selectedTransport === 'wifi';
    const isBle = (state.port && state.port.transport === 'ble') || state.selectedTransport === 'ble';
    if (window.SpineAlign3D && typeof window.SpineAlign3D.setMode === 'function') window.SpineAlign3D.setMode(mode);
    renderBattery();
    els.topConnectionText.textContent = live ? (isWifi ? 'Wi-Fi connected' : isBle ? 'Bluetooth connected' : 'USB connected') : 'Demo mode';
    els.connectionPill.classList.toggle('is-live', live);
    els.sideDot.classList.toggle('is-live', live);
    els.sideConnectionText.textContent = live ? (isWifi ? 'NodeMCU connected' : 'ESP32 connected') : 'Demo data active';
    els.connectBtnText.textContent = live ? 'Disconnect' : (isBle ? 'Connect Bluetooth' : (isWifi ? 'Connect Wi-Fi' : 'Connect USB'));
    els.deviceConnectBtn.textContent = live ? 'Disconnect device' : (isWifi ? 'Connect NodeMCU' : (isBle ? 'Connect Bluetooth' : 'Connect USB'));
    els.deviceStatusTitle.textContent = live ? (state.hasLiveReading ? (isWifi ? 'NodeMCU connected' : 'ESP32 connected') : 'Waiting for sensor data') : 'Running in demo mode';
    els.deviceStatusSubtitle.textContent = live
      ? (isWifi ? 'Streaming neck/back pitch, roll, posture and battery telemetry over Wi-Fi WebSockets.' : 'Listening for neck/back pitch, roll, posture and battery telemetry.')
      : 'Example values are shown so you can explore the dashboard.';
    els.connectionType.textContent = live ? (isWifi ? (state.port?.url ? `Wi-Fi · ${state.port.url}` : 'Wi-Fi WebSocket · port 81') : isBle ? 'Bluetooth Low Energy' : 'USB serial · 115200 baud') : 'Demo mode';
    els.chartModeText.textContent = live ? 'Live sensor readings' : 'Demo readings';
    els.neckDeviceStatus.textContent = live ? (state.singleSensorMode ? 'Not fitted' : (state.hasLiveReading ? 'Reading' : 'Waiting')) : 'Simulated';
    els.backDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.neckDeviceIndicator.className = `tiny-indicator${live && !state.singleSensorMode && state.hasLiveReading ? ' good' : ''}`;
    els.backDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.neckDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.backDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.calibrateBtn.disabled = live && !state.hasLiveReading;
    const demoButton = $('simulateSlouchBtn');
    if (demoButton) demoButton.hidden = live;
    els.deviceNote.textContent = live
      ? 'Calibration sends CALIBRATE to the firmware. Orientation depends on sensor mounting; battery fields appear only when the hardware monitor is enabled.'
      : (isWifi ? 'Connect to the same Wi-Fi network (or NodeMCU hotspot at 192.168.4.1) and click Connect.' : isBle ? 'Pair your ESP32-WROOM via Bluetooth Low Energy in Chrome/Edge over HTTPS or localhost.' : 'For live data, connect your hardware over USB in a desktop Chromium browser.');
    renderReadings();
  }

  function updateFromLine(line) {
    // N/B remain scalar overall tilt; NP/NR/BP/BR are sensor pitch/roll.
    const parsed = window.SpineAlignTelemetry && window.SpineAlignTelemetry.parseLine(line);
    if (!parsed) return;
    const readField = (key) => Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : null;
    const deviceMode = readField('MODE');
    state.singleSensorMode = deviceMode === 1;
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
    const isWifi = (state.port && state.port.transport === 'wifi') || state.selectedTransport === 'wifi';
    const isBle = (state.port && state.port.transport === 'ble');
    els.topConnectionText.textContent = isWifi ? 'Wi-Fi connected' : isBle ? 'Bluetooth connected' : 'USB connected';
    els.connectionPill.classList.add('is-live');
    els.sideDot.classList.add('is-live');
    els.sideConnectionText.textContent = isWifi ? 'NodeMCU connected' : 'ESP32 connected';
    if (els.deviceStatusTitle) {
      const devName = isWifi ? 'NodeMCU' : 'ESP32';
      els.deviceStatusTitle.textContent = state.calibrationKnown && !state.isCalibrated ? `${devName} connected · calibrate sensors` : `${devName} connected`;
    }
    els.neckDeviceStatus.textContent = state.singleSensorMode ? 'Not fitted' : 'Reading';
    els.backDeviceStatus.textContent = 'Reading';
    els.neckDeviceIndicator.className = state.singleSensorMode ? 'tiny-indicator' : 'tiny-indicator good';
    els.backDeviceIndicator.className = 'tiny-indicator good';
    renderReadings();
    renderBattery();
    if ((state.singleSensorMode ? state.backSensorOk : state.neckSensorOk && state.backSensorOk) && (!state.calibrationKnown || state.isCalibrated)) addHistorySample();
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

  function createWebSocketPort(host, port) {
    let ws = null;
    let controller = null;
    const url = `ws://${host}:${port}/`;
    return {
      transport: 'wifi',
      url: url,
      readable: new ReadableStream({
        start(c) { controller = c; },
        cancel() { if (ws) ws.close(); }
      }),
      writable: new WritableStream({
        write(chunk) {
          if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('NodeMCU WebSocket is not connected.');
          const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          ws.send(text);
        }
      }),
      async open() {
        return new Promise((resolve, reject) => {
          try {
            ws = new WebSocket(url);
          } catch (e) {
            return reject(e);
          }
          let settled = false;
          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { ws.close(); } catch (_) {}
              reject(new Error(`Connection to ${url} timed out. Ensure NodeMCU is powered on and reachable.`));
            }
          }, 8000);

          ws.onopen = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve();
            }
          };

          ws.onerror = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error(`WebSocket error connecting to ${url}. Verify Wi-Fi network and IP address.`));
            }
          };

          ws.onmessage = (event) => {
            if (controller) {
              const text = typeof event.data === 'string' ? event.data : '';
              if (text) controller.enqueue(text.endsWith('\n') ? text : text + '\n');
            }
          };

          ws.onclose = () => {
            if (controller) {
              try { controller.close(); } catch (_) {}
            }
            if (state.connected && state.port?.transport === 'wifi') {
              disconnectSerial(false);
              showToast('NodeMCU Wi-Fi connection closed.', true);
            }
          };
        });
      },
      async close() {
        if (ws) {
          const socket = ws;
          ws = null;
          try { socket.close(); } catch (_) {}
        }
        if (controller) {
          try { controller.close(); } catch (_) {}
          controller = null;
        }
      }
    };
  }

  async function connectWebSocket() {
    const hostInput = els.wifiHostInput?.value?.trim() || 'spinealign.local';
    const portInput = els.wifiPortInput?.value?.trim() || '81';
    try {
      localStorage.setItem('spinealign_wifi_host', hostInput);
      localStorage.setItem('spinealign_wifi_port', portInput);
    } catch (_) {}

    const port = createWebSocketPort(hostInput, portInput);
    try {
      showToast(`Connecting to NodeMCU at ws://${hostInput}:${portInput}…`);
      await port.open();
      state.simulationSlouch = false;
      const slouchButton = $('simulateSlouchBtn');
      if (slouchButton) slouchButton.textContent = 'Simulate slouch';
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
      showToast('Connected to NodeMCU over Wi-Fi. Waiting for telemetry…');
      state.readTask = readSerialLoop(port);
    } catch (error) {
      console.error('WebSocket connection error:', error);
      showToast(error && error.message ? error.message : 'Could not connect to NodeMCU over Wi-Fi.', true);
    }
  }

  async function connectBle() {
    if (window.SpineAlignBle && typeof window.SpineAlignBle.requestBleDevice === 'function') {
      try {
        const port = await window.SpineAlignBle.requestBleDevice();
        state.simulationSlouch = false;
        const slouchButton = $('simulateSlouchBtn');
        if (slouchButton) slouchButton.textContent = 'Simulate slouch';
        await port.open();
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
        showToast('Connected to Bluetooth device. Waiting for telemetry…');
        state.readTask = readSerialLoop(port);
      } catch (error) {
        if (error && error.name === 'NotFoundError') return;
        console.error('BLE connection error:', error);
        showToast(`Could not connect via Bluetooth${error && error.message ? `: ${error.message}` : '.'}`, true);
      }
    } else {
      await connectSerial();
    }
  }

  function selectTransport(transport) {
    state.selectedTransport = transport;
    try { localStorage.setItem('spinealign_transport', transport); } catch (_) {}
    if (els.tabWifi) {
      els.tabWifi.classList.toggle('active', transport === 'wifi');
      els.tabWifi.setAttribute('aria-selected', String(transport === 'wifi'));
    }
    if (els.tabUsb) {
      els.tabUsb.classList.toggle('active', transport === 'usb');
      els.tabUsb.setAttribute('aria-selected', String(transport === 'usb'));
    }
    if (els.tabBle) {
      els.tabBle.classList.toggle('active', transport === 'ble');
      els.tabBle.setAttribute('aria-selected', String(transport === 'ble'));
    }
    if (els.wifiConfigPanel) els.wifiConfigPanel.hidden = transport !== 'wifi';
    if (state.mode !== 'live') {
      if (transport === 'wifi') {
        els.deviceConnectBtn.textContent = 'Connect NodeMCU';
        els.deviceNote.textContent = 'Connect to the same Wi-Fi network (or NodeMCU hotspot at 192.168.4.1) and click Connect.';
      } else if (transport === 'ble') {
        els.deviceConnectBtn.textContent = 'Connect Bluetooth (ESP32)';
        els.deviceNote.textContent = 'Pair your ESP32-WROOM via Bluetooth Low Energy in Chrome/Edge over HTTPS or localhost.';
      } else {
        els.deviceConnectBtn.textContent = 'Connect USB';
        els.deviceNote.textContent = 'Connect your device via USB at 115200 baud in a desktop Chromium browser.';
      }
    }
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
    const decoder = new TextDecoder();
    try {
      while (port.readable && state.keepReading) {
        state.reader = port.readable.getReader();
        try {
          while (state.keepReading) {
            const { value, done } = await state.reader.read();
            if (done) break;
            if (!value) continue;
            buffer += (typeof value === 'string' ? value : decoder.decode(value, { stream: true }));
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
    state.singleSensorMode = false;
    document.body.classList.remove('single-sensor-mode');
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
      const isWifi = state.port && state.port.transport === 'wifi';
      const isBle = state.port && state.port.transport === 'ble';
      els.topConnectionText.textContent = stale ? 'No recent data' : (isWifi ? 'Wi-Fi connected' : isBle ? 'Bluetooth connected' : 'USB connected');
      els.connectionPill.classList.toggle('is-live', !stale);
      els.sideDot.classList.toggle('is-live', !stale);
      els.sideConnectionText.textContent = stale ? 'Telemetry stalled' : (isWifi ? 'NodeMCU connected' : 'ESP32 connected');
      els.deviceStatusTitle.textContent = stale ? 'No recent telemetry' : (isWifi ? 'NodeMCU connected' : 'ESP32 connected');
      renderReadings();
    }
  }

  async function toggleConnection() {
    if (state.mode === 'live') {
      await disconnectSerial();
    } else {
      if (state.selectedTransport === 'wifi') {
        await connectWebSocket();
      } else if (state.selectedTransport === 'ble') {
        await connectBle();
      } else {
        await connectSerial();
      }
    }
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
    state.neckPitch = state.neck;
    state.neckRoll = Math.sin(t / 5) * (state.simulationSlouch ? 5 : 1.8);
    state.neckTwist = Math.cos(t / 7) * (state.simulationSlouch ? 6 : 2.0);
    state.backPitch = state.back;
    state.backRoll = Math.cos(t / 6) * (state.simulationSlouch ? 4 : 2.4);
    state.backTwist = Math.sin(t / 8) * (state.simulationSlouch ? 5 : 1.8);
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
      state.neckPitch = 5.4; state.neckRoll = 1.8; state.neckTwist = 1.0;
      state.backPitch = 7.6; state.backRoll = -2.0; state.backTwist = -1.2;
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

  els.tabWifi?.addEventListener('click', () => selectTransport('wifi'));
  els.tabUsb?.addEventListener('click', () => selectTransport('usb'));
  els.tabBle?.addEventListener('click', () => selectTransport('ble'));

  const queryTransport = new URLSearchParams(location.search).get('transport');
  const storedTransport = (typeof localStorage !== 'undefined' && localStorage.getItem('spinealign_transport')) || null;
  const initialTransport = queryTransport || storedTransport || 'ble';
  selectTransport(initialTransport);

  if (els.wifiHostInput) {
    const storedHost = (typeof localStorage !== 'undefined' && localStorage.getItem('spinealign_wifi_host')) || null;
    const defaultHost = (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') ? location.hostname : 'spinealign.local';
    els.wifiHostInput.value = storedHost || defaultHost;
  }
  if (els.wifiPortInput) {
    const storedPort = (typeof localStorage !== 'undefined' && localStorage.getItem('spinealign_wifi_port')) || null;
    els.wifiPortInput.value = storedPort || '81';
  }

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