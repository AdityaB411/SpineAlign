const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('repository contains NodeMCU firmware only and removes legacy ESP32 folders', () => {
  assert.ok(fs.existsSync(path.join(root, 'firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino')));
  assert.equal(fs.existsSync(path.join(root, 'SpineAlign.ino')), false);
  assert.equal(fs.existsSync(path.join(root, 'firmware/SpineAlign_ESP32WROOM')), false);
  assert.equal(fs.existsSync(path.join(root, 'firmware/SpineAlign_ESP32CAM')), false);
});

test('dashboard script order loads transport and parser before application', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('ble-serial-bridge.js') >= 0);
  assert.ok(html.indexOf('telemetry-protocol.js') > html.indexOf('ble-serial-bridge.js'));
  assert.ok(html.indexOf('app.js') > html.indexOf('telemetry-protocol.js'));
});

test('stream byte decoding and BLE adapter both preserve text chunks', () => {
  assert.match(read('app.js'), /decoder\.decode\(value, \{ stream: true \}\)/);
  const bridge = read('ble-serial-bridge.js');
  assert.match(bridge, /decoder\.decode\(bytes,\{stream:true\}\)/);
  assert.match(bridge, /writeValueWithResponse/);
});

test('NodeMCU configuration is ignored and example credentials cannot be mistaken for real secrets', () => {
  assert.match(read('firmware/SpineAlign_NodeMCU/.gitignore'), /config\.h/);
  assert.match(read('firmware/SpineAlign_NodeMCU/config.example.h'), /REPLACE_ME/);
  assert.match(read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino'), /isPlaceholderCredential/);
});

test('CI compiles NodeMCU firmware with PlatformIO and validates tests', () => {
  const workflow = read('.github/workflows/arduino-build.yml');
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /pio run -d firmware\/SpineAlign_NodeMCU/);
});
