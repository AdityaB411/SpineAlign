const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function createMockClassList() {
  const set = new Set();
  return {
    add(...names) { names.forEach((n) => set.add(n)); },
    remove(...names) { names.forEach((n) => set.delete(n)); },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) { set.delete(name); return false; }
        set.add(name); return true;
      }
      if (force) set.add(name); else set.delete(name);
      return Boolean(force);
    },
    contains(name) { return set.has(name); }
  };
}

function createMockElement(id = '', tag = 'div') {
  const listeners = new Map();
  const attrs = new Map();
  const el = {
    id,
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    tabIndex: 0,
    className: '',
    style: {},
    classList: createMockClassList(),
    parentElement: { style: {} },
    children: [],
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) { listeners.get(type)?.delete(cb); },
    dispatch(type, event = {}) {
      const evt = { target: el, preventDefault() {}, ...event };
      for (const cb of listeners.get(type) || []) cb(evt);
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    appendChild(child) { el.children.push(child); return child; },
    focus() { el._focused = true; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    getContext() { return null; }
  };
  return el;
}

function createDashboardHarness(options = {}) {
  const {
    protocol = 'http:',
    hostname = 'localhost',
    search = '',
    isSecureContext = true,
    hasBluetooth = true,
    hasSerial = true
  } = options;

  const elements = new Map();
  const ensure = (id, tag = 'div') => {
    if (!elements.has(id)) elements.set(id, createMockElement(id, tag));
    return elements.get(id);
  };

  [
    'connectBtn', 'connectBtnIcon', 'connectBtnText', 'deviceConnectBtn', 'calibrateBtn',
    'topConnectionText', 'connectionPill', 'sideDot', 'sideConnectionText', 'deviceStatusIcon',
    'deviceStatusTitle', 'deviceStatusSubtitle', 'connectionType', 'deviceNote',
    'neckAngle', 'backAngle', 'neckRangeLabel', 'backRangeLabel', 'neckFill', 'backFill',
    'neckDot', 'backDot', 'statusCard', 'statusIcon', 'statusTitle', 'statusBadge',
    'statusDescription', 'statusFootIcon', 'statusFootText', 'neckDeviceIndicator',
    'backDeviceIndicator', 'neckDeviceStatus', 'deviceNeckStatus', 'backDeviceStatus',
    'neckDetailAngle', 'backDetailAngle', 'neckMeter', 'backMeter',
    'toast', 'battery', 'batteryPercent', 'batteryVoltage', 'chargerState',
    'batteryStatusPill', 'batteryProgress', 'batteryProgressTrack', 'batteryGlyphFill',
    'batteryHint', 'batteryMonitorState', 'chargerSignalState', 'batteryLevelCaption',
    'tabWifi', 'tabBle', 'headerTabWifi', 'headerTabBle',
    'device', 'wifiConfigPanel', 'wifiProtocolSelect', 'wifiHostInput',
    'wifiPortInput', 'wifiAutoReconnect', 'transportWarning'
  ].forEach((id) => ensure(id));

  ensure('wifiProtocolSelect', 'select').value = 'ws';
  ensure('wifiHostInput', 'input').value = 'spinealign.local';
  ensure('wifiPortInput', 'input').value = '81';
  ensure('wifiAutoReconnect', 'input').checked = true;

  const preset1 = createMockElement('presetMdns', 'button');
  preset1.setAttribute('data-wifi-preset', 'spinealign.local');
  preset1.setAttribute('data-wifi-port', '81');
  const preset2 = createMockElement('presetAp', 'button');
  preset2.setAttribute('data-wifi-preset', '192.168.4.1');
  preset2.setAttribute('data-wifi-port', '81');
  const presets = [preset1, preset2];

  const deviceActions = createMockElement('deviceActions', 'div');
  const body = createMockElement('body', 'body');

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); }
  };

  const timers = [];
  const intervals = [];
  const fakeSetTimeout = (fn, ms) => {
    const handle = { fn, ms, cleared: false };
    timers.push(handle);
    return handle;
  };
  const fakeClearTimeout = (h) => { if (h) h.cleared = true; };
  const fakeSetInterval = (fn, ms) => {
    const handle = { fn, ms, cleared: false };
    intervals.push(handle);
    return handle;
  };
  const fakeClearInterval = (h) => { if (h) h.cleared = true; };

  const wsInstances = [];
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      wsInstances.push(this);
    }
    send(data) { this.sent.push(data); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
    _open() {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    _message(data) {
      if (this.onmessage) this.onmessage({ data });
    }
    _error() {
      if (this.onerror) this.onerror(new Error('ws error'));
    }
  }
  MockWebSocket.OPEN = 1;

  const serialCalls = [];
  const bleDevices = [];
  const navigatorObj = {};
  if (hasSerial) {
    navigatorObj.serial = {
      async requestPort() {
        serialCalls.push('requestPort');
        let controller;
        const port = {
          readable: new ReadableStream({ start(c) { controller = c; } }),
          writable: new WritableStream({ write() {} }),
          async open() { serialCalls.push('open'); },
          async close() { serialCalls.push('close'); try { controller.close(); } catch (_) {} }
        };
        return port;
      },
      addEventListener() {},
      removeEventListener() {}
    };
  }
  if (hasBluetooth) {
    navigatorObj.bluetooth = {
      async requestDevice() {
        const chListeners = new Map();
        const devListeners = new Map();
        const writes = [];
        const characteristic = {
          async startNotifications() {},
          async stopNotifications() {},
          async writeValueWithResponse(bytes) { writes.push(new TextDecoder().decode(bytes)); },
          addEventListener(type, cb) {
            if (!chListeners.has(type)) chListeners.set(type, new Set());
            chListeners.get(type).add(cb);
          },
          removeEventListener(type, cb) { chListeners.get(type)?.delete(cb); },
          _notify(text) {
            const bytes = new TextEncoder().encode(text);
            const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (const cb of chListeners.get('characteristicvaluechanged') || []) {
              cb({ target: { value } });
            }
          }
        };
        const device = {
          name: 'SpineAlign-ESP32',
          gatt: {
            connected: true,
            async connect() { return this; },
            disconnect() {
              this.connected = false;
              for (const cb of devListeners.get('gattserverdisconnected') || []) cb();
            },
            async getPrimaryService() {
              return { async getCharacteristic() { return characteristic; } };
            }
          },
          addEventListener(type, cb) {
            if (!devListeners.has(type)) devListeners.set(type, new Set());
            devListeners.get(type).add(cb);
          },
          removeEventListener(type, cb) { devListeners.get(type)?.delete(cb); },
          _characteristic: characteristic,
          _writes: writes
        };
        bleDevices.push(device);
        return device;
      }
    };
  }

  const windowListeners = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    Uint8Array,
    DataView,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    WritableStream,
    WebSocket: MockWebSocket,
    performance: { now: () => 0 },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    location: { protocol, hostname, search },
    localStorage,
    navigator: navigatorObj,
    document: {
      body,
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => {
        const el = createMockElement('', tag);
        return new Proxy(el, {
          set(target, prop, value) {
            target[prop] = value;
            if (prop === 'id' && value) elements.set(value, target);
            return true;
          }
        });
      },
      querySelector: (sel) => (sel === '.device-actions' ? deviceActions : null),
      querySelectorAll: (sel) => (sel === '[data-wifi-preset]' ? presets : []),
      addEventListener() {}
    },
    isSecureContext,
    devicePixelRatio: 1,
    addEventListener(type, cb) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(cb);
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const modelUpdates = [];
  sandbox.SpineAlign3D = {
    setMode() {},
    updateTelemetry(payload) { modelUpdates.push(payload); }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('ble-serial-bridge.js'), ctx);
  vm.runInContext(read('telemetry-protocol.js'), ctx);
  vm.runInContext(read('app.js'), ctx);

  return { sandbox, elements, presets, wsInstances, bleDevices, serialCalls, timers, storage, modelUpdates };
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

test('index.html has zero duplicate IDs, keeps Wi-Fi/Bluetooth/3D, and removes chart, sliders, and USB', () => {
  const html = read('index.html');
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
  const seen = new Set();
  const duplicates = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  assert.deepEqual(duplicates, [], `Duplicate IDs found in index.html: ${duplicates.join(', ')}`);
  assert.ok(seen.has('tabBle'));
  assert.ok(seen.has('tabWifi'));
  assert.ok(seen.has('headerTabBle'));
  assert.ok(seen.has('headerTabWifi'));
  assert.ok(seen.has('wifiProtocolSelect'));
  assert.ok(seen.has('wifiHostInput'));
  assert.ok(seen.has('wifiPortInput'));
  assert.ok(seen.has('wifiAutoReconnect'));
  assert.ok(seen.has('transportWarning'));
  assert.ok(seen.has('deviceNeckStatus'));
  assert.ok(seen.has('posture3dCanvas'));

  // Removed unnecessary UI features
  assert.equal(seen.has('tabUsb'), false);
  assert.equal(seen.has('headerTabUsb'), false);
  assert.equal(seen.has('angleChart'), false);
  assert.equal(seen.has('modelDemoControls'), false);
});

test('ble-serial-bridge.js exposes BLE transport and works with single-IMU telemetry and alert hysteresis', async () => {
  const { sandbox, elements, bleDevices, modelUpdates } = createDashboardHarness();
  assert.equal(typeof sandbox.SpineAlignBle.requestBleDevice, 'function');
  assert.equal(sandbox.SpineAlignBle.isSupported(), true);

  // Switch to Bluetooth and connect
  elements.get('tabBle').dispatch('click');
  elements.get('deviceConnectBtn').dispatch('click');
  await flushMicrotasks();
  assert.equal(bleDevices.length, 1);
  assert.equal(elements.get('topConnectionText').textContent, 'Bluetooth connected');

  // Calibrate button is immediately enabled so firmware can calibrate on connect
  assert.equal(elements.get('calibrateBtn').disabled, false);

  // Simulate single-IMU line with angle > 15° during 3s hold (ALERT:0)
  bleDevices[0]._characteristic._notify('N:0.0,B:17.2,NP:0.0,NR:0.0,BP:16.8,BR:3.7,MODE:1,ALERT:0,CAL:1,NS:0,BS:1,BAT:-1,PCT:-1,CHG:-1,FULL:-1\n');
  await flushMicrotasks();
  assert.equal(elements.get('neckDeviceStatus').textContent, 'Not fitted');
  assert.equal(elements.get('deviceNeckStatus').textContent, 'Not fitted');
  assert.equal(elements.get('backDeviceStatus').textContent, 'Reading');
  assert.equal(elements.get('batteryPercent').textContent, '—');
  // 3D alert must strictly respect firmware ALERT:0 hysteresis
  assert.equal(modelUpdates[modelUpdates.length - 1].alert, false);
  assert.equal(modelUpdates[modelUpdates.length - 1].singleSensorMode, true);

  // After 3s hold, firmware sets ALERT:1
  bleDevices[0]._characteristic._notify('N:0.0,B:17.5,NP:0.0,NR:0.0,BP:17.0,BR:4.1,MODE:1,ALERT:1,CAL:1,NS:0,BS:1,BAT:-1,PCT:-1,CHG:-1,FULL:-1\n');
  await flushMicrotasks();
  assert.equal(modelUpdates[modelUpdates.length - 1].alert, true);

  // Calibration command over BLE sends CALIBRATE\n
  elements.get('calibrateBtn').dispatch('click');
  await flushMicrotasks();
  assert.deepEqual(bleDevices[0]._writes, ['CALIBRATE\n']);
});

test('buildWebSocketUrl supports ws://, wss://, AP IPs, full URLs, and flags HTTPS mixed content', () => {
  const { sandbox } = createDashboardHarness({ protocol: 'https:', hostname: 'example.github.io' });
  const { buildWebSocketUrl, isMixedContentWs } = sandbox.SpineAlignTransports;

  assert.equal(buildWebSocketUrl('spinealign.local', '81', 'ws').url, 'ws://spinealign.local:81/');
  assert.equal(buildWebSocketUrl('192.168.4.1', '81', 'ws').url, 'ws://192.168.4.1:81/');
  assert.equal(buildWebSocketUrl('posture.example.com', '443', 'wss').url, 'wss://posture.example.com/');
  assert.equal(buildWebSocketUrl('posture.example.com', '8443', 'wss').url, 'wss://posture.example.com:8443/');
  assert.equal(buildWebSocketUrl('http://192.168.4.1', '81', 'ws').url, 'ws://192.168.4.1:81/');
  assert.equal(buildWebSocketUrl('https://posture.example.com/ws', '81', 'ws').url, 'wss://posture.example.com/ws');
  assert.equal(buildWebSocketUrl('192.168.1.25:9000', '81', 'ws').url, 'ws://192.168.1.25:9000/');

  assert.throws(() => buildWebSocketUrl('192.168.4.1', '99999', 'ws'), /between 1 and 65535/);
  assert.throws(() => buildWebSocketUrl('bad host name', '81', 'ws'), /spaces/);

  assert.equal(isMixedContentWs('ws://192.168.4.1:81/', 'https:'), true);
  assert.equal(isMixedContentWs('wss://posture.example.com/', 'https:'), false);
  assert.equal(isMixedContentWs('ws://localhost:81/', 'https:'), false);
  assert.equal(isMixedContentWs('ws://192.168.4.1:81/', 'http:'), false);
});

test('defaults to Wi-Fi for NodeMCU and syncs top and card connect buttons and Wi-Fi presets', () => {
  const { elements, presets } = createDashboardHarness();

  assert.equal(elements.get('connectBtnText').textContent, 'Connect Wi-Fi');
  assert.equal(elements.get('wifiConfigPanel').hidden, false);

  elements.get('headerTabBle').dispatch('click');
  assert.equal(elements.get('tabBle').classList.contains('active'), true);
  assert.equal(elements.get('connectBtnText').textContent, 'Connect Bluetooth');
  assert.equal(elements.get('deviceConnectBtn').textContent, 'Connect Bluetooth');
  assert.equal(elements.get('wifiConfigPanel').hidden, true);

  elements.get('headerTabWifi').dispatch('click');
  assert.equal(elements.get('tabWifi').classList.contains('active'), true);
  assert.equal(elements.get('headerTabWifi').classList.contains('active'), true);
  assert.equal(elements.get('connectBtnText').textContent, 'Connect Wi-Fi');
  assert.equal(elements.get('deviceConnectBtn').textContent, 'Connect Wi-Fi');
  assert.equal(elements.get('wifiConfigPanel').hidden, false);

  // Select AP preset (192.168.4.1)
  presets[1].dispatch('click');
  assert.equal(elements.get('wifiHostInput').value, '192.168.4.1');
  assert.equal(elements.get('wifiPortInput').value, '81');
  assert.equal(presets[1].classList.contains('active'), true);
});

test('Bluetooth connects cleanly and one-click switches to Wi-Fi without state corruption', async () => {
  const { elements, bleDevices, wsInstances } = createDashboardHarness();

  // Select and connect Bluetooth
  elements.get('tabBle').dispatch('click');
  elements.get('deviceConnectBtn').dispatch('click');
  await flushMicrotasks();
  assert.equal(bleDevices.length, 1);
  assert.equal(elements.get('topConnectionText').textContent, 'Bluetooth connected');

  // Stream a BLE telemetry line
  bleDevices[0]._characteristic._notify('N:4.5,B:7.2,NP:4.0,NR:0.5,BP:6.8,BR:-1.1,MODE:2,ALERT:0,CAL:1,NS:1,BS:1\n');
  await flushMicrotasks();
  assert.equal(elements.get('topConnectionText').textContent, 'Bluetooth connected');
  assert.equal(elements.get('neckDeviceStatus').textContent, 'Reading');
  assert.equal(elements.get('deviceNeckStatus').textContent, 'Reading');

  // Preview Wi-Fi tab while still live on Bluetooth: live status must stay Bluetooth!
  elements.get('tabWifi').dispatch('click');
  assert.equal(elements.get('topConnectionText').textContent, 'Bluetooth connected');
  assert.equal(elements.get('connectBtnText').textContent, 'Disconnect');
  assert.equal(elements.get('deviceConnectBtn').textContent, 'Switch to Wi-Fi');

  // Click Switch to Wi-Fi: BLE disconnects and Wi-Fi WebSocket opens
  elements.get('wifiHostInput').value = '192.168.4.1';
  elements.get('deviceConnectBtn').dispatch('click');
  await flushMicrotasks();
  assert.equal(bleDevices[0].gatt.connected, false);
  assert.equal(wsInstances.length, 1);
  assert.equal(wsInstances[0].url, 'ws://192.168.4.1:81/');

  wsInstances[0]._open();
  await flushMicrotasks();
  assert.equal(elements.get('topConnectionText').textContent, 'Wi-Fi connected');

  // Firmware sends STATUS:UNCALIBRATED then live telemetry
  wsInstances[0]._message('STATUS:UNCALIBRATED');
  wsInstances[0]._message('N:2.1,B:3.4,NP:2.0,NR:0.1,BP:3.2,BR:0.2,MODE:2,ALERT:0,CAL:0,NS:1,BS:1');
  await flushMicrotasks();
  assert.equal(elements.get('statusBadge').textContent, 'Not calibrated');

  // Calibrate sends clean trimmed CALIBRATE command over WebSocket (matching SpineAlign_NodeMCU.ino)
  elements.get('calibrateBtn').dispatch('click');
  await flushMicrotasks();
  assert.deepEqual(wsInstances[0].sent, ['CALIBRATE']);

  wsInstances[0]._message('CALIBRATED');
  await flushMicrotasks();
  assert.equal(elements.get('statusBadge').textContent, 'Within range');
});

test('Wi-Fi auto-reconnect schedules retry on unexpected drop and cancels cleanly on user action', async () => {
  const { elements, wsInstances, timers } = createDashboardHarness();

  elements.get('tabWifi').dispatch('click');
  elements.get('wifiHostInput').value = '192.168.4.1';
  elements.get('deviceConnectBtn').dispatch('click');
  await flushMicrotasks();

  wsInstances[0]._open();
  await flushMicrotasks();
  assert.equal(elements.get('topConnectionText').textContent, 'Wi-Fi connected');

  // Simulate unexpected drop from microcontroller
  wsInstances[0].close();
  await flushMicrotasks();

  assert.match(elements.get('topConnectionText').textContent, /Reconnecting Wi-Fi \(1\/5\)/);
  assert.equal(elements.get('connectionPill').classList.contains('is-reconnecting'), true);
  assert.equal(elements.get('connectBtnText').textContent, 'Cancel reconnect');

  // Trigger scheduled reconnect timer
  const reconnectTimer = timers.find((t) => !t.cleared && t.ms === 1500);
  assert.ok(reconnectTimer, 'Expected 1500ms reconnect timer to be scheduled');
  reconnectTimer.fn();
  await flushMicrotasks();
  assert.equal(wsInstances.length, 2);

  wsInstances[1]._open();
  await flushMicrotasks();
  assert.equal(elements.get('topConnectionText').textContent, 'Wi-Fi connected');
  assert.equal(elements.get('connectionPill').classList.contains('is-reconnecting'), false);
});

test('defaults gracefully to Wi-Fi when Web Bluetooth is unavailable in browser', () => {
  const { elements } = createDashboardHarness({ hasBluetooth: false });
  assert.equal(elements.get('tabWifi').classList.contains('active'), true);
  assert.equal(elements.get('connectBtnText').textContent, 'Connect Wi-Fi');
  assert.equal(elements.get('wifiConfigPanel').hidden, false);

  // Switching to Bluetooth tab shows clear browser compatibility advisory
  elements.get('tabBle').dispatch('click');
  assert.equal(elements.get('transportWarning').hidden, false);
  assert.match(elements.get('transportWarning').textContent, /Web Bluetooth is unavailable/);
});
