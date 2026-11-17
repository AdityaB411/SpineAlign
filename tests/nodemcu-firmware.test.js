const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const telemetry = require('../telemetry-protocol.js');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('NodeMCU firmware targets ESP8266 architecture with dedicated standard pins', () => {
  const fw = read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino');
  // ESP8266 includes
  assert.match(fw, /#include <ESP8266WiFi\.h>/);
  assert.match(fw, /#include <WebSocketsServer\.h>/);
  assert.match(fw, /#include <ESP8266WebServer\.h>/);
  assert.match(fw, /#include <ArduinoOTA\.h>/);
  // Must NOT include ESP32-only BLE headers
  assert.doesNotMatch(fw, /#include <BLEDevice\.h>/);

  // Standard NodeMCU pin assignments: D2=GPIO4 (SDA), D1=GPIO5 (SCL), D5=GPIO14 (Alert)
  assert.match(fw, /#define SDA_PIN 4/);
  assert.match(fw, /#define SCL_PIN 5/);
  assert.match(fw, /#define ALERT_PIN 14/);
});

test('NodeMCU firmware configures WebSockets on port 81 and HTTP on port 80 with AP fallback', () => {
  const fw = read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino');
  assert.match(fw, /WebSocketsServer\s+webSocket\s*=\s*WebSocketsServer\(81\)/);
  assert.match(fw, /ESP8266WebServer\s+httpServer\(80\)/);
  assert.match(fw, /WiFi\.softAP\("SpineAlign-NodeMCU"\)/);
  assert.match(fw, /192,\s*168,\s*4,\s*1/);
  assert.match(fw, /MDNS\.begin\("spinealign"\)/);
  assert.match(fw, /"CALIBRATE"/);
  assert.match(fw, /"CALIBRATED"/);
  assert.match(fw, /"CALIBRATION FAILED"/);
});

test('NodeMCU telemetry string matches SpineAlign strict protocol format', () => {
  const fw = read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino');
  for (const field of ['N:', 'B:', 'NP:', 'NR:', 'BP:', 'BR:', 'MODE:', 'ALERT:', 'CAL:', 'NS:', 'BS:', 'BAT:', 'PCT:', 'CHG:', 'FULL:']) {
    assert.ok(fw.includes(field), `NodeMCU firmware missing telemetry field: ${field}`);
  }

  // Generate simulated telemetry line from NodeMCU format
  const simulatedSample = 'N:5.2,B:8.7,NP:4.0,NR:0.8,BP:7.0,BR:-1.2,MODE:1,ALERT:0,CAL:1,NS:0,BS:1,BAT:3.85,PCT:75,CHG:-1,FULL:-1';
  const parsed = telemetry.parseLine(simulatedSample);
  assert.ok(parsed, 'Simulated NodeMCU telemetry must parse successfully');
  assert.equal(parsed.MODE, 1);
  assert.equal(parsed.CAL, 1);
  assert.equal(parsed.ALERT, 0);
  assert.equal(parsed.N, 5.2);
  assert.equal(parsed.B, 8.7);
  assert.equal(parsed.BAT, 3.85);
  assert.equal(parsed.PCT, 75);
});

test('NodeMCU config template and gitignore prevent secret leakage', () => {
  assert.match(read('firmware/SpineAlign_NodeMCU/.gitignore'), /config\.h/);
  const example = read('firmware/SpineAlign_NodeMCU/config.example.h');
  assert.match(example, /REPLACE_ME_SSID/);
  assert.match(example, /REPLACE_ME_PASSWORD/);
  assert.match(example, /SPINEALIGN_DUAL_IMU/);
  const fw = read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino');
  assert.match(fw, /isPlaceholderCredential/);
});

test('NodeMCU PlatformIO configuration specifies ESP8266 and WebSocket library', () => {
  const pio = read('firmware/SpineAlign_NodeMCU/platformio.ini');
  assert.match(pio, /platform\s*=\s*espressif8266/);
  assert.match(pio, /board\s*=\s*nodemcuv2/);
  assert.match(pio, /links2004\/WebSockets/);
});

test('dashboard includes Wi-Fi connection inputs and WebSocket transport handlers', () => {
  const html = read('index.html');
  assert.match(html, /id="tabWifi"/);
  assert.match(html, /id="wifiConfigPanel"/);
  assert.match(html, /id="wifiHostInput"/);
  assert.match(html, /id="wifiPortInput"/);

  const app = read('app.js');
  assert.match(app, /createWebSocketPort/);
  assert.match(app, /connectWebSocket/);
  assert.match(app, /selectTransport/);
  assert.match(app, /tabWifi/);
});
