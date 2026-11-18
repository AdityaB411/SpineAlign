(() => {
  'use strict';

  const ALERT_THRESHOLD = 15;
  const MAX_BAR_ANGLE = 30;
  const WIFI_RECONNECT_DELAYS = [1500, 3000, 5000, 8000, 10000];
  const $ = (id) => document.getElementById(id);

  const TRANSPORT_ICONS = {
    ble: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11L12 22V2l5.5 4.5-11 11"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>'
  };

  const TRANSPORT_LABELS = {
    ble: { name: 'Bluetooth', connect: 'Connect Bluetooth', switchTo: 'Switch to Bluetooth', connected: 'Bluetooth connected', detail: 'Bluetooth Low Energy' },
    wifi: { name: 'Wi-Fi', connect: 'Connect Wi-Fi', switchTo: 'Switch to Wi-Fi', connected: 'Wi-Fi connected', detail: 'Wi-Fi WebSocket' }
  };

  const els = {
    connectBtn: $('connectBtn'), connectBtnIcon: $('connectBtnIcon'), connectBtnText: $('connectBtnText'), deviceConnectBtn: $('deviceConnectBtn'),
    calibrateBtn: $('calibrateBtn'), topConnectionText: $('topConnectionText'), connectionPill: $('connectionPill'),
    sideDot: $('sideDot'), sideConnectionText: $('sideConnectionText'), deviceStatusIcon: $('deviceStatusIcon'),
    deviceStatusTitle: $('deviceStatusTitle'), deviceStatusSubtitle: $('deviceStatusSubtitle'), connectionType: $('connectionType'),
    deviceNote: $('deviceNote'), neckAngle: $('neckAngle'), backAngle: $('backAngle'), neckRangeLabel: $('neckRangeLabel'),
    backRangeLabel: $('backRangeLabel'), neckFill: $('neckFill'), backFill: $('backFill'), neckDot: $('neckDot'), backDot: $('backDot'),
    statusCard: $('statusCard'), statusIcon: $('statusIcon'), statusTitle: $('statusTitle'), statusBadge: $('statusBadge'),
    statusDescription: $('statusDescription'), statusFootIcon: $('statusFootIcon'), statusFootText: $('statusFootText'),
    neckDeviceIndicator: $('neckDeviceIndicator'), backDeviceIndicator: $('backDeviceIndicator'), neckDeviceStatus: $('neckDeviceStatus'),
    deviceNeckStatus: $('deviceNeckStatus'), backDeviceStatus: $('backDeviceStatus'), neckDetailAngle: $('neckDetailAngle'), backDetailAngle: $('backDetailAngle'),
    neckMeter: $('neckMeter'), backMeter: $('backMeter'), toast: $('toast'),
    batteryCard: $('battery'), batteryPercent: $('batteryPercent'), batteryVoltage: $('batteryVoltage'), batteryState: $('chargerState'),
    batteryStatusPill: $('batteryStatusPill'), batteryProgress: $('batteryProgress'), batteryProgressTrack: $('batteryProgressTrack'),
    batteryGlyphFill: $('batteryGlyphFill'), batteryHint: $('batteryHint'), batteryMonitorState: $('batteryMonitorState'), chargerSignalState: $('chargerSignalState'), batteryLevelCaption: $('batteryLevelCaption'),
    tabWifi: $('tabWifi'), tabBle: $('tabBle'),
    headerTabWifi: $('headerTabWifi'), headerTabBle: $('headerTabBle'),
    deviceCard: $('device'), wifiConfigPanel: $('wifiConfigPanel'),
    wifiProtocolSelect: $('wifiProtocolSelect'), wifiHostInput: $('wifiHostInput'), wifiPortInput: $('wifiPortInput'),
    wifiAutoReconnect: $('wifiAutoReconnect'), transportWarning: $('transportWarning')
  };

  const state = {
    mode: 'demo', connected: false, connecting: false, port: null, reader: null, readTask: null, writer: null, keepReading: false,
    selectedTransport: 'wifi',
    activeTransport: null,
    activeDeviceLabel: '',
    reconnecting: false, reconnectAttempts: 0, reconnectTimer: null, manualDisconnect: false, autoReconnectWifi: true, lastWifiConfig: null,
    singleSensorMode: false,
    neck: 5.2, back: 8.7, neckPitch: 4.0, neckRoll: 0.8, neckTwist: 0.0, backPitch: 7.0, backRoll: -1.2, backTwist: 0.0,
    batteryVoltage: 3.87, batteryPercent: 78, batteryCharging: false, batteryFull: false, batteryAvailable: false,
    calibrationKnown: false, isCalibrated: false, firmwareAlert: false, firmwareAlertKnown: false,
    neckSensorOk: true, backSensorOk: true, linkStale: false, chargerStatusAvailable: false,
    hasLiveReading: false, simulationSlouch: false, sampleCounter: 0, lastUiRenderAt: 0,
    toastTimer: null, animationTimer: null, freshnessTimer: null, lastDataAt: Date.now()
  };

  function safeStorageGet(key) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch (_) {}
  }

  function setNeckDeviceStatus(text) {
    if (els.neckDeviceStatus) els.neckDeviceStatus.textContent = text;
    if (els.deviceNeckStatus) els.deviceNeckStatus.textContent = text;
  }

  function isLocalHostname(hostname) {
    const clean = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1';
  }

  function buildWebSocketUrl(rawHost, rawPort, protocolPref = 'ws') {
    const hostInput = String(rawHost || '').trim() || 'spinealign.local';
    const portStr = String(rawPort ?? '').trim();
    const defaultProto = protocolPref === 'wss' ? 'wss' : 'ws';

    const validatePort = (p) => {
      if (!p) return null;
      if (!/^\d+$/.test(p)) throw new Error('Wi-Fi port must be a number between 1 and 65535.');
      const n = Number(p);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Wi-Fi port must be between 1 and 65535.');
      return String(n);
    };

    const explicitPort = validatePort(portStr);

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(hostInput)) {
      let parsed;
      try {
        parsed = new URL(hostInput);
      } catch (_) {
        throw new Error('Enter a valid Wi-Fi host, IP address, or WebSocket URL.');
      }
      let protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
      if (protocol === 'http') protocol = 'ws';
      else if (protocol === 'https') protocol = 'wss';
      if (protocol !== 'ws' && protocol !== 'wss') {
        throw new Error('Unsupported Wi-Fi URL scheme. Use ws:// or wss://.');
      }
      if (!parsed.hostname) throw new Error('Enter a valid Wi-Fi host or IP address.');
      const urlPort = parsed.port || (protocol === 'ws' ? (explicitPort || '81') : '');
      const portPart = urlPort ? `:${urlPort}` : '';
      const pathPart = parsed.pathname && parsed.pathname !== '/' ? `${parsed.pathname}${parsed.search || ''}` : '/';
      return {
        url: `${protocol}://${parsed.hostname}${portPart}${pathPart}`,
        protocol,
        host: parsed.hostname,
        port: urlPort || (protocol === 'wss' ? '443' : '81')
      };
    }

    if (/\s/.test(hostInput)) {
      throw new Error('Wi-Fi host cannot contain spaces.');
    }

    let candidateHost = hostInput;
    let candidatePort = explicitPort;
    let candidatePath = '/';

    const slashIndex = candidateHost.indexOf('/');
    if (slashIndex >= 0) {
      candidatePath = candidateHost.slice(slashIndex) || '/';
      candidateHost = candidateHost.slice(0, slashIndex);
    }

    const ipv6Match = candidateHost.match(/^(\[[^\]]+\])(?::(\d+))?$/);
    if (ipv6Match) {
      candidateHost = ipv6Match[1];
      if (ipv6Match[2]) candidatePort = validatePort(ipv6Match[2]);
    } else if (candidateHost.includes(':')) {
      const parts = candidateHost.split(':');
      if (parts.length !== 2 || !parts[0]) {
        throw new Error('Enter a valid Wi-Fi host or IP address.');
      }
      candidateHost = parts[0];
      candidatePort = validatePort(parts[1]);
    }

    if (!candidateHost || !/^[a-zA-Z0-9._\-\[\]:]+$/.test(candidateHost)) {
      throw new Error('Enter a valid Wi-Fi host or IP address (e.g. spinealign.local or 192.168.4.1).');
    }

    const finalPort = candidatePort || (defaultProto === 'wss' ? '443' : '81');
    const omitPort = defaultProto === 'wss' && finalPort === '443';
    return {
      url: `${defaultProto}://${candidateHost}${omitPort ? '' : `:${finalPort}`}${candidatePath}`,
      protocol: defaultProto,
      host: candidateHost,
      port: finalPort
    };
  }

  function isMixedContentWs(url, pageProtocol = (typeof location !== 'undefined' ? location.protocol : 'http:')) {
    if (pageProtocol !== 'https:' || !String(url).startsWith('ws://')) return false;
    try {
      const parsed = new URL(url);
      return !isLocalHostname(parsed.hostname);
    } catch (_) {
      return true;
    }
  }

  function getTransportAdvisory(transport) {
    if (transport === 'ble') {
      if (!window.isSecureContext) {
        return 'Bluetooth requires HTTPS or localhost. Switch to the Wi-Fi tab or open this dashboard over HTTPS/localhost.';
      }
      if (!navigator.bluetooth) {
        return 'Web Bluetooth is unavailable in this browser. Use Chrome or Edge for Bluetooth, or switch to the Wi-Fi tab.';
      }
      return '';
    }
    if (transport === 'wifi') {
      try {
        const built = buildWebSocketUrl(
          els.wifiHostInput?.value,
          els.wifiPortInput?.value,
          els.wifiProtocolSelect?.value || 'ws'
        );
        if (isMixedContentWs(built.url)) {
          return 'This page is on HTTPS, so browsers block unencrypted ws:// links. Choose wss://, open locally at http://localhost (supports both Wi-Fi & Bluetooth), or switch to Bluetooth.';
        }
      } catch (_) {
        return '';
      }
      return '';
    }
    return '';
  }

  function updateTransportAdvisory() {
    if (!els.transportWarning) return;
    const message = getTransportAdvisory(state.selectedTransport);
    els.transportWarning.textContent = message;
    els.transportWarning.hidden = !message;
  }

  function updatePresetHighlights() {
    const currentHost = (els.wifiHostInput?.value || '').trim().toLowerCase();
    document.querySelectorAll('[data-wifi-preset]').forEach((btn) => {
      const preset = (btn.getAttribute('data-wifi-preset') || '').toLowerCase();
      btn.classList.toggle('active', currentHost === preset);
    });
  }

  window.SpineAlignTransports = Object.freeze({
    buildWebSocketUrl,
    isMixedContentWs,
    isLocalHostname,
    getTransportAdvisory
  });

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
    return `${Math.max(0, Math.min(Math.abs(value) / MAX_BAR_ANGLE * 100, 100))}%`;
  }

  function setRangeStyle(label, fill, value, dot) {
    const outOfRange = Math.abs(value) >= ALERT_THRESHOLD;
    label.textContent = outOfRange ? 'Above threshold' : 'In range';
    label.classList.toggle('bad', outOfRange);
    fill.style.width = deviationFill(value);
    dot.style.background = outOfRange ? '#c77f72' : '#789d80';
    return outOfRange;
  }

  function renderReadings(skipModelUpdate = false) {
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
    if (!skipModelUpdate) updateModelOrientation();
  }

  function updateModelOrientation() {
    if (window.SpineAlign3D && typeof window.SpineAlign3D.updateTelemetry === 'function') {
      const live = state.mode === 'live';
      const fallbackAlert = state.singleSensorMode
        ? Math.abs(state.back) >= ALERT_THRESHOLD
        : (Math.abs(state.back) >= ALERT_THRESHOLD || Math.abs(state.neck) >= ALERT_THRESHOLD);
      window.SpineAlign3D.updateTelemetry({
        neckPitch: state.neckPitch,
        neckRoll: state.neckRoll,
        neckTwist: state.neckTwist ?? 0,
        backPitch: state.backPitch,
        backRoll: state.backRoll,
        backTwist: state.backTwist ?? 0,
        mode: state.mode,
        alert: live && state.firmwareAlertKnown ? state.firmwareAlert : fallbackAlert,
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

  function getTransportNote(transport) {
    if (transport === 'wifi') {
      return 'Connect to your device over Wi-Fi WebSockets (ws:// or wss://) on your local network or AP hotspot (192.168.4.1).';
    }
    return 'Pair your SpineAlign BLE device wirelessly in Chrome or Edge over HTTPS or localhost.';
  }

  function getActiveDeviceTitle() {
    if (state.activeTransport === 'wifi') return state.activeDeviceLabel || 'Wi-Fi device';
    if (state.activeTransport === 'ble') return state.activeDeviceLabel || 'Bluetooth device';
    return 'Device';
  }

  function updateConnectionControls() {
    const live = state.mode === 'live';
    const active = state.activeTransport;
    const selected = state.selectedTransport;
    const selectedMeta = TRANSPORT_LABELS[selected] || TRANSPORT_LABELS.ble;
    const activeMeta = (active && TRANSPORT_LABELS[active]) || selectedMeta;
    const iconTransport = live && active ? active : selected;

    if (els.connectBtnIcon) {
      els.connectBtnIcon.innerHTML = TRANSPORT_ICONS[iconTransport] || TRANSPORT_ICONS.ble;
    }
    if (els.deviceStatusIcon) {
      els.deviceStatusIcon.innerHTML = TRANSPORT_ICONS[iconTransport] || TRANSPORT_ICONS.ble;
    }

    if (state.connecting) {
      els.connectBtn.disabled = true;
      els.deviceConnectBtn.disabled = true;
      els.connectBtnText.textContent = 'Connecting…';
      els.deviceConnectBtn.textContent = `Connecting ${selectedMeta.name}…`;
      return;
    }

    els.connectBtn.disabled = false;
    els.deviceConnectBtn.disabled = false;

    if (state.reconnecting) {
      els.connectBtnText.textContent = 'Cancel reconnect';
      els.deviceConnectBtn.textContent = selected !== 'wifi' ? selectedMeta.switchTo : 'Cancel reconnect';
      return;
    }

    if (live) {
      els.connectBtnText.textContent = 'Disconnect';
      els.deviceConnectBtn.textContent = selected !== active ? selectedMeta.switchTo : `Disconnect ${activeMeta.name}`;
      return;
    }

    els.connectBtnText.textContent = selectedMeta.connect;
    els.deviceConnectBtn.textContent = selectedMeta.connect;
  }

  function setMode(mode) {
    state.mode = mode;
    const live = mode === 'live';
    const transport = live ? (state.activeTransport || state.selectedTransport) : state.selectedTransport;
    const meta = TRANSPORT_LABELS[transport] || TRANSPORT_LABELS.ble;
    const devTitle = getActiveDeviceTitle();
    if (window.SpineAlign3D && typeof window.SpineAlign3D.setMode === 'function') window.SpineAlign3D.setMode(mode);
    renderBattery();

    if (state.reconnecting) {
      els.topConnectionText.textContent = `Reconnecting Wi-Fi (${state.reconnectAttempts}/${WIFI_RECONNECT_DELAYS.length})…`;
      els.connectionPill.classList.remove('is-live');
      els.connectionPill.classList.add('is-reconnecting');
      els.sideDot.classList.remove('is-live');
      els.sideConnectionText.textContent = 'Reconnecting Wi-Fi…';
      els.deviceStatusTitle.textContent = 'Reconnecting over Wi-Fi…';
      els.deviceStatusSubtitle.textContent = `Attempt ${state.reconnectAttempts} of ${WIFI_RECONNECT_DELAYS.length} to ${state.lastWifiConfig?.url || 'Wi-Fi device'}.`;
      els.connectionType.textContent = state.lastWifiConfig?.url ? `Wi-Fi · ${state.lastWifiConfig.url}` : 'Wi-Fi WebSocket';
    } else {
      els.connectionPill.classList.remove('is-reconnecting');
      els.topConnectionText.textContent = live ? meta.connected : 'Demo mode';
      els.connectionPill.classList.toggle('is-live', live);
      els.sideDot.classList.toggle('is-live', live);
      els.sideConnectionText.textContent = live ? `${devTitle} connected` : 'Demo data active';
      els.deviceStatusTitle.textContent = live ? (state.hasLiveReading ? `${devTitle} connected` : 'Waiting for sensor data') : 'Running in demo mode';
      els.deviceStatusSubtitle.textContent = live
        ? (transport === 'wifi'
          ? 'Streaming neck/back pitch, roll, posture and battery telemetry over Wi-Fi WebSockets.'
          : 'Streaming neck/back pitch, roll, posture and battery telemetry over Bluetooth Low Energy.')
        : 'Example values are shown so you can explore the dashboard.';
      els.connectionType.textContent = live
        ? (transport === 'wifi'
          ? (state.port?.url ? `Wi-Fi · ${state.port.url}` : 'Wi-Fi WebSocket')
          : (state.activeDeviceLabel ? `Bluetooth · ${state.activeDeviceLabel}` : 'Bluetooth Low Energy'))
        : 'Demo mode';
    }

    setNeckDeviceStatus(live ? (state.singleSensorMode ? 'Not fitted' : (state.hasLiveReading ? 'Reading' : 'Waiting')) : 'Simulated');
    els.backDeviceStatus.textContent = live ? (state.hasLiveReading ? 'Reading' : 'Waiting') : 'Simulated';
    els.neckDeviceIndicator.className = `tiny-indicator${live && !state.singleSensorMode && state.hasLiveReading ? ' good' : ''}`;
    els.backDeviceIndicator.className = `tiny-indicator${live && state.hasLiveReading ? ' good' : ''}`;
    els.neckDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.backDot.style.background = live && !state.hasLiveReading ? '#c59a66' : '#789d80';
    els.calibrateBtn.disabled = state.reconnecting;
    const demoButton = $('simulateSlouchBtn');
    if (demoButton) demoButton.hidden = live || state.reconnecting;
    els.deviceNote.textContent = live
      ? (state.selectedTransport !== state.activeTransport
        ? `Currently connected via ${meta.name}. Click "${(TRANSPORT_LABELS[state.selectedTransport] || meta).switchTo}" to switch links seamlessly.`
        : 'Calibration sends CALIBRATE to the firmware. You can switch between Wi-Fi and Bluetooth at any time.')
      : getTransportNote(state.selectedTransport);
    updateConnectionControls();
    updateTransportAdvisory();
    renderReadings();
  }

  function updateFromLine(line) {
    // N/B remain scalar overall tilt; NP/NR/BP/BR are sensor pitch/roll.
    const parsed = window.SpineAlignTelemetry && window.SpineAlignTelemetry.parseLine(line);
    if (!parsed) return;
    const readField = (key) => Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : null;
    const prevAlert = state.firmwareAlert;
    const prevCal = state.isCalibrated;
    const prevNeckOk = state.neckSensorOk;
    const prevBackOk = state.backSensorOk;
    const prevSingle = state.singleSensorMode;
    const wasFirstLive = !state.hasLiveReading || state.linkStale;

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
    const nowMs = Date.now();
    state.lastDataAt = nowMs;
    state.linkStale = false;

    // Push live orientation immediately to the 3D WebGL model at full sensor rate (25 Hz)
    updateModelOrientation();

    // Throttle DOM text/bar repaints to ~16 Hz unless a status flag changed
    const stateChanged = wasFirstLive ||
      prevAlert !== state.firmwareAlert ||
      prevCal !== state.isCalibrated ||
      prevNeckOk !== state.neckSensorOk ||
      prevBackOk !== state.backSensorOk ||
      prevSingle !== state.singleSensorMode;
    if (stateChanged || nowMs - state.lastUiRenderAt >= 60) {
      state.lastUiRenderAt = nowMs;
      const active = state.activeTransport || state.port?.transport || 'ble';
      const meta = TRANSPORT_LABELS[active] || TRANSPORT_LABELS.ble;
      const devTitle = getActiveDeviceTitle();
      els.topConnectionText.textContent = meta.connected;
      els.connectionPill.classList.add('is-live');
      els.connectionPill.classList.remove('is-reconnecting');
      els.sideDot.classList.add('is-live');
      els.sideConnectionText.textContent = `${devTitle} connected`;
      if (els.deviceStatusTitle) {
        els.deviceStatusTitle.textContent = state.calibrationKnown && !state.isCalibrated ? `${devTitle} connected · calibrate sensors` : `${devTitle} connected`;
      }
      els.calibrateBtn.disabled = false;
      setNeckDeviceStatus(state.singleSensorMode ? 'Not fitted' : 'Reading');
      els.backDeviceStatus.textContent = 'Reading';
      els.neckDeviceIndicator.className = state.singleSensorMode ? 'tiny-indicator' : 'tiny-indicator good';
      els.backDeviceIndicator.className = 'tiny-indicator good';
      renderReadings(true);
      renderBattery();
    }
  }

  function handleSerialLine(line) {
    if (!line) return;
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
    if (line === 'STATUS:CALIBRATED') {
      state.calibrationKnown = true;
      state.isCalibrated = true;
      renderReadings();
      return;
    }
    if (line === 'STATUS:UNCALIBRATED') {
      state.calibrationKnown = true;
      state.isCalibrated = false;
      renderReadings();
      return;
    }
    updateFromLine(line);
  }

  function cancelWifiReconnect() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.reconnecting = false;
    state.reconnectAttempts = 0;
  }

  function scheduleWifiReconnect() {
    if (!state.autoReconnectWifi || state.manualDisconnect || !state.lastWifiConfig) return false;
    if (state.reconnectAttempts >= WIFI_RECONNECT_DELAYS.length) {
      cancelWifiReconnect();
      setMode('demo');
      showToast('Wi-Fi reconnect failed after 5 attempts. Returned to demo mode.', true);
      return false;
    }
    const delay = WIFI_RECONNECT_DELAYS[state.reconnectAttempts];
    state.reconnectAttempts += 1;
    state.reconnecting = true;
    setMode('demo');
    showToast(`Wi-Fi dropped. Reconnecting (${state.reconnectAttempts}/${WIFI_RECONNECT_DELAYS.length})…`, true);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (!state.reconnecting || state.manualDisconnect) return;
      connectWebSocket({ isRetry: true, config: state.lastWifiConfig });
    }, delay);
    return true;
  }

  function beginLiveSession(port, transport, deviceLabel) {
    cancelWifiReconnect();
    state.manualDisconnect = false;
    state.simulationSlouch = false;
    const slouchButton = $('simulateSlouchBtn');
    if (slouchButton) slouchButton.textContent = 'Simulate slouch';
    state.port = port;
    state.activeTransport = transport;
    state.activeDeviceLabel = deviceLabel || '';
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
    setMode('live');
    state.readTask = readSerialLoop(port);
  }

  function createWebSocketPort(host, port, protocolPref = 'ws') {
    const built = buildWebSocketUrl(host, port, protocolPref);
    let ws = null;
    let controller = null;
    let closed = false;
    let manualClose = false;
    const url = built.url;

    function closeController() {
      if (controller && !closed) {
        try { controller.close(); } catch (_) {}
        closed = true;
      }
    }

    const wsPort = {
      transport: 'wifi',
      url,
      host: built.host,
      port: built.port,
      protocol: built.protocol,
      readable: new ReadableStream({
        start(c) { controller = c; },
        cancel() {
          manualClose = true;
          if (ws) try { ws.close(); } catch (_) {}
          closeController();
        }
      }),
      writable: new WritableStream({
        write(chunk) {
          if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Wi-Fi WebSocket is not connected.');
          const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          ws.send(text.trim());
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
              manualClose = true;
              try { ws.close(); } catch (_) {}
              reject(new Error(`Connection to ${url} timed out. Ensure the device is powered on and reachable.`));
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
              reject(new Error(`WebSocket error connecting to ${url}. Verify Wi-Fi network, protocol, and IP address.`));
            }
          };

          ws.onmessage = (event) => {
            if (controller && !closed) {
              const text = typeof event.data === 'string' ? event.data : '';
              if (text) controller.enqueue(text.endsWith('\n') ? text : `${text}\n`);
            }
          };

          ws.onclose = () => {
            closeController();
            if (!manualClose && state.connected && state.port === wsPort) {
              handleUnexpectedWifiDrop();
            }
          };
        });
      },
      async close() {
        manualClose = true;
        if (ws) {
          const socket = ws;
          ws = null;
          try { socket.close(); } catch (_) {}
        }
        closeController();
      }
    };
    return wsPort;
  }

  async function handleUnexpectedWifiDrop() {
    await disconnectSerial(false, { preserveReconnect: true });
    if (!scheduleWifiReconnect()) {
      showToast('Wi-Fi connection closed.', true);
    }
  }

  async function connectWebSocket(options = {}) {
    const isRetry = Boolean(options.isRetry);
    let built;
    try {
      const cfg = options.config || {
        host: els.wifiHostInput?.value?.trim() || 'spinealign.local',
        port: els.wifiPortInput?.value?.trim() || '81',
        protocol: els.wifiProtocolSelect?.value || 'ws'
      };
      built = buildWebSocketUrl(cfg.host, cfg.port, cfg.protocol);
      if (isMixedContentWs(built.url)) {
        throw new Error('Blocked by HTTPS mixed-content policy: use wss://, run locally on http://localhost, or connect via Bluetooth.');
      }
      if (!isRetry) {
        safeStorageSet('spinealign_wifi_host', built.host);
        safeStorageSet('spinealign_wifi_port', built.port);
        safeStorageSet('spinealign_wifi_protocol', built.protocol);
      }
      state.lastWifiConfig = { host: built.host, port: built.port, protocol: built.protocol, url: built.url };
    } catch (error) {
      cancelWifiReconnect();
      showToast(error && error.message ? error.message : 'Invalid Wi-Fi address.', true);
      setMode('demo');
      return false;
    }

    if (state.connecting) return false;
    state.connecting = true;
    state.manualDisconnect = false;
    updateConnectionControls();

    const port = createWebSocketPort(built.host, built.port, built.protocol);
    try {
      if (!isRetry) showToast(`Connecting over Wi-Fi to ${built.url}…`);
      await port.open();
      state.connecting = false;
      beginLiveSession(port, 'wifi', built.host);
      showToast(`Connected over Wi-Fi (${built.host}). Waiting for telemetry…`);
      return true;
    } catch (error) {
      state.connecting = false;
      console.error('WebSocket connection error:', error);
      if (isRetry && state.reconnecting && !state.manualDisconnect) {
        scheduleWifiReconnect();
      } else {
        updateConnectionControls();
        showToast(error && error.message ? error.message : 'Could not connect over Wi-Fi.', true);
      }
      return false;
    }
  }

  async function connectBle() {
    if (!window.SpineAlignBle || typeof window.SpineAlignBle.requestBleDevice !== 'function') {
      showToast('Bluetooth bridge failed to load. Refresh the page or connect over Wi-Fi.', true);
      return false;
    }
    if (state.connecting) return false;
    cancelWifiReconnect();
    state.connecting = true;
    updateConnectionControls();

    try {
      const port = await window.SpineAlignBle.requestBleDevice();
      await port.open();
      port.addEventListener?.('disconnect', () => {
        if (state.port === port && state.connected) {
          disconnectSerial(false);
          showToast('Bluetooth device disconnected.', true);
        }
      });
      state.connecting = false;
      beginLiveSession(port, 'ble', port.deviceName || 'SpineAlign BLE');
      showToast(`Connected via Bluetooth (${port.deviceName || 'BLE'}). Waiting for telemetry…`);
      return true;
    } catch (error) {
      state.connecting = false;
      updateConnectionControls();
      if (error && error.name === 'NotFoundError') return false;
      console.error('BLE connection error:', error);
      showToast(`Could not connect via Bluetooth${error && error.message ? `: ${error.message}` : '.'}`, true);
      return false;
    }
  }

  async function connectSelectedTransport() {
    if (state.selectedTransport === 'wifi') return connectWebSocket();
    return connectBle();
  }

  async function switchTransport(targetTransport) {
    if (state.connecting) return;
    selectTransport(targetTransport);
    if (state.reconnecting) cancelWifiReconnect();
    if (state.mode === 'live' || state.connected) {
      await disconnectSerial(false);
    }
    await connectSelectedTransport();
  }

  function selectTransport(transport) {
    const valid = transport === 'ble' ? 'ble' : 'wifi';
    state.selectedTransport = valid;
    safeStorageSet('spinealign_transport', valid);
    const syncTab = (el, isSelected) => {
      if (!el) return;
      el.classList.toggle('active', isSelected);
      el.setAttribute('aria-selected', String(isSelected));
      el.tabIndex = isSelected ? 0 : -1;
    };
    syncTab(els.tabWifi, valid === 'wifi');
    syncTab(els.tabBle, valid === 'ble');
    syncTab(els.headerTabWifi, valid === 'wifi');
    syncTab(els.headerTabBle, valid === 'ble');
    if (els.wifiConfigPanel) els.wifiConfigPanel.hidden = valid !== 'wifi';
    updatePresetHighlights();
    updateTransportAdvisory();

    if (state.mode === 'live') {
      const activeMeta = TRANSPORT_LABELS[state.activeTransport] || TRANSPORT_LABELS.ble;
      const selectedMeta = TRANSPORT_LABELS[valid] || TRANSPORT_LABELS.ble;
      els.deviceNote.textContent = valid !== state.activeTransport
        ? `Currently connected via ${activeMeta.name}. Click "${selectedMeta.switchTo}" to switch links seamlessly.`
        : 'Calibration sends CALIBRATE to the firmware. You can switch between Wi-Fi and Bluetooth at any time.';
    } else {
      els.deviceNote.textContent = getTransportNote(valid);
    }
    updateConnectionControls();
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
      if (state.keepReading && state.port === port) {
        console.error('Stream read error:', error);
        const label = state.activeTransport === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
        showToast(`The ${label} stream stopped unexpectedly.`, true);
      }
    } finally {
      if (state.keepReading && state.port === port) {
        if (state.activeTransport === 'wifi') {
          await handleUnexpectedWifiDrop();
        } else {
          await disconnectSerial(false);
        }
      }
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

  async function disconnectSerial(showMessage = true, options = {}) {
    const preserveReconnect = Boolean(options.preserveReconnect);
    if (!preserveReconnect) {
      state.manualDisconnect = true;
      cancelWifiReconnect();
    }
    state.keepReading = false;
    state.singleSensorMode = false;
    document.body.classList.remove('single-sensor-mode');
    state.connected = false;
    state.activeTransport = null;
    state.activeDeviceLabel = '';
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
      const active = state.activeTransport || state.port?.transport || 'ble';
      const meta = TRANSPORT_LABELS[active] || TRANSPORT_LABELS.ble;
      const devTitle = getActiveDeviceTitle();
      els.topConnectionText.textContent = stale ? 'No recent data' : meta.connected;
      els.connectionPill.classList.toggle('is-live', !stale);
      els.sideDot.classList.toggle('is-live', !stale);
      els.sideConnectionText.textContent = stale ? 'Telemetry stalled' : `${devTitle} connected`;
      els.deviceStatusTitle.textContent = stale ? 'No recent telemetry' : `${devTitle} connected`;
      renderReadings();
    }
  }

  async function toggleConnection() {
    if (state.reconnecting) {
      state.manualDisconnect = true;
      cancelWifiReconnect();
      setMode('demo');
      showToast('Wi-Fi reconnect cancelled.');
      return;
    }
    if (state.mode === 'live') {
      await disconnectSerial();
    } else {
      await connectSelectedTransport();
    }
  }

  async function handleDeviceConnectClick() {
    if (state.mode === 'live' && state.selectedTransport !== state.activeTransport) {
      await switchTransport(state.selectedTransport);
      return;
    }
    if (state.reconnecting && state.selectedTransport !== 'wifi') {
      await switchTransport(state.selectedTransport);
      return;
    }
    await toggleConnection();
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
    renderReadings();
    showToast('Demo reference reset. Connect a device via Wi-Fi or Bluetooth to calibrate real sensors.');
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
      state.manualDisconnect = true;
      cancelWifiReconnect();
      state.keepReading = false;
      if (state.reader) state.reader.cancel().catch(() => {});
      if (state.port) state.port.close().catch(() => {});
      clearInterval(state.animationTimer);
      clearInterval(state.freshnessTimer);
      clearTimeout(state.toastTimer);
    });
  }

  els.connectBtn.addEventListener('click', toggleConnection);
  els.deviceConnectBtn.addEventListener('click', handleDeviceConnectClick);
  els.calibrateBtn.addEventListener('click', calibrate);
  $('simulateSlouchBtn')?.addEventListener('click', toggleSlouch);

  function bindTabGroup(items, revealDeviceOnWifi = false) {
    const activeItems = items.filter((item) => Boolean(item.el));
    activeItems.forEach(({ el, transport }, index) => {
      el.addEventListener('click', () => {
        selectTransport(transport);
        if (revealDeviceOnWifi && transport === 'wifi' && els.deviceCard && typeof els.deviceCard.getBoundingClientRect === 'function') {
          const rect = els.deviceCard.getBoundingClientRect();
          if (rect.top > (window.innerHeight || 900) - 80 || rect.bottom < 0) {
            els.deviceCard.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
      el.addEventListener('keydown', (event) => {
        let nextIdx = -1;
        if (event.key === 'ArrowRight') nextIdx = (index + 1) % activeItems.length;
        else if (event.key === 'ArrowLeft') nextIdx = (index - 1 + activeItems.length) % activeItems.length;
        else if (event.key === 'Home') nextIdx = 0;
        else if (event.key === 'End') nextIdx = activeItems.length - 1;
        if (nextIdx >= 0) {
          event.preventDefault();
          selectTransport(activeItems[nextIdx].transport);
          activeItems[nextIdx].el.focus();
        }
      });
    });
  }

  bindTabGroup([
    { el: els.tabWifi, transport: 'wifi' },
    { el: els.tabBle, transport: 'ble' }
  ]);

  bindTabGroup([
    { el: els.headerTabWifi, transport: 'wifi' },
    { el: els.headerTabBle, transport: 'ble' }
  ], true);

  document.querySelectorAll('[data-wifi-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const presetHost = btn.getAttribute('data-wifi-preset') || 'spinealign.local';
      const presetPort = btn.getAttribute('data-wifi-port') || '81';
      if (els.wifiHostInput) els.wifiHostInput.value = presetHost;
      if (els.wifiPortInput) els.wifiPortInput.value = presetPort;
      if (els.wifiProtocolSelect) els.wifiProtocolSelect.value = 'ws';
      safeStorageSet('spinealign_wifi_host', presetHost);
      safeStorageSet('spinealign_wifi_port', presetPort);
      safeStorageSet('spinealign_wifi_protocol', 'ws');
      updatePresetHighlights();
      updateTransportAdvisory();
    });
  });

  if (els.wifiHostInput) {
    const storedHost = safeStorageGet('spinealign_wifi_host');
    const hostLooksLocalDevice = Boolean(location.hostname && (/^(\d{1,3}\.){3}\d{1,3}$/.test(location.hostname) || location.hostname.endsWith('.local')) && !isLocalHostname(location.hostname));
    const defaultHost = hostLooksLocalDevice ? location.hostname : 'spinealign.local';
    els.wifiHostInput.value = storedHost || defaultHost;
    els.wifiHostInput.addEventListener('input', () => {
      updatePresetHighlights();
      updateTransportAdvisory();
    });
    els.wifiHostInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && state.selectedTransport === 'wifi') {
        event.preventDefault();
        handleDeviceConnectClick();
      }
    });
  }

  if (els.wifiPortInput) {
    const storedPort = safeStorageGet('spinealign_wifi_port');
    els.wifiPortInput.value = storedPort || '81';
    els.wifiPortInput.addEventListener('input', updateTransportAdvisory);
    els.wifiPortInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && state.selectedTransport === 'wifi') {
        event.preventDefault();
        handleDeviceConnectClick();
      }
    });
  }

  if (els.wifiProtocolSelect) {
    const storedProto = safeStorageGet('spinealign_wifi_protocol');
    if (storedProto === 'ws' || storedProto === 'wss') {
      els.wifiProtocolSelect.value = storedProto;
    } else if (location.protocol === 'https:') {
      els.wifiProtocolSelect.value = 'wss';
    }
    els.wifiProtocolSelect.addEventListener('change', () => {
      const proto = els.wifiProtocolSelect.value;
      if (els.wifiPortInput) {
        if (proto === 'wss' && els.wifiPortInput.value === '81') els.wifiPortInput.value = '443';
        else if (proto === 'ws' && els.wifiPortInput.value === '443') els.wifiPortInput.value = '81';
      }
      safeStorageSet('spinealign_wifi_protocol', proto);
      updateTransportAdvisory();
    });
  }

  if (els.wifiAutoReconnect) {
    const storedAuto = safeStorageGet('spinealign_wifi_autoreconnect');
    state.autoReconnectWifi = storedAuto === null ? true : storedAuto === '1';
    els.wifiAutoReconnect.checked = state.autoReconnectWifi;
    els.wifiAutoReconnect.addEventListener('change', () => {
      state.autoReconnectWifi = Boolean(els.wifiAutoReconnect.checked);
      safeStorageSet('spinealign_wifi_autoreconnect', state.autoReconnectWifi ? '1' : '0');
    });
  }

  const queryTransport = new URLSearchParams(location.search).get('transport');
  const storedTransport = safeStorageGet('spinealign_transport');
  const initialTransport = queryTransport || storedTransport || 'wifi';
  selectTransport(initialTransport);

  setMode('demo');
  renderBattery();
  renderReadings();
  // Add the demo-only slouch test without making the live UI pretend to be hardware.
  addSimulationControl();
  state.animationTimer = setInterval(updateDemo, 1000);
  state.freshnessTimer = setInterval(checkLiveFreshness, 500);
})();