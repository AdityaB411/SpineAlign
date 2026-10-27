const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('keeps Wokwi simulation separate from physical wireless firmware', () => {
  const sim = read('SpineAlign.ino');
  const physical = read('firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino');
  assert.match(sim, /#define SDA_PIN 21/);
  assert.match(sim, /#define SCL_PIN 23/);
  assert.doesNotMatch(sim, /#include <BLEDevice\.h>/);
  assert.match(physical, /#include <BLEDevice\.h>/);
  assert.match(physical, /ArduinoOTA\.handle\(\)/);
  assert.match(physical, /Adafruit_ADS1X15\.h/);
  assert.doesNotMatch(physical, /analogReadMilliVolts|analogRead\(BATTERY_ADC_PIN\)/);
});

test('dashboard script order loads transport and parser before application', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('ble-serial-bridge.js') >= 0);
  assert.ok(html.indexOf('telemetry-protocol.js') > html.indexOf('ble-serial-bridge.js'));
  assert.ok(html.indexOf('app.js') > html.indexOf('telemetry-protocol.js'));
});

test('native USB byte decoding and BLE adapter both preserve text chunks', () => {
  assert.match(read('app.js'), /decoder\.decode\(value, \{ stream: true \}\)/);
  const bridge = read('ble-serial-bridge.js');
  assert.match(bridge, /decoder\.decode\(bytes,\{stream:true\}\)/);
  assert.match(bridge, /writeValueWithResponse/);
});

test('firmware exposes telemetry, calibration, BLE security, OTA and separated ADC channels', () => {
  const fw = read('firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino');
  for (const text of ['BLEService','BLECharacteristic::PROPERTY_NOTIFY','CALIBRATE','ArduinoOTA.handle()',
    'ESP_LE_AUTH_REQ_SC_BOND','BATTERY_ADC_CHANNEL=0','CHARGER_ADC_CHANNEL=1','NS:', 'BS:', 'CHG:'])
    assert.ok(fw.includes(text), 'missing firmware element: ' + text);
});

test('OTA partition table has two non-overlapping slots within 4 MB flash', () => {
  const csv = read('firmware/SpineAlign_ESP32CAM/partitions.csv');
  const entries = csv.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const [name,type,subtype,offset,size] = line.split(',').map((v)=>v.trim());
    return { name,type,subtype,offset: Number(offset),size: Number(size) };
  });
  assert.equal(entries.filter((x)=>x.subtype==='ota_0').length, 1);
  assert.equal(entries.filter((x)=>x.subtype==='ota_1').length, 1);
  const sorted=entries.slice().sort((a,b)=>a.offset-b.offset);
  for (let i=1;i<sorted.length;i++) assert.ok(sorted[i-1].offset+sorted[i-1].size<=sorted[i].offset,'overlapping partitions');
  assert.ok(Math.max(...entries.map((x)=>x.offset+x.size))<=0x400000,'partition table exceeds 4MB');
});

test('OTA configuration is ignored and example credentials cannot be mistaken for real secrets', () => {
  assert.match(read('firmware/SpineAlign_ESP32CAM/.gitignore'), /config\.h/);
  assert.match(read('firmware/SpineAlign_ESP32CAM/config.example.h'), /REPLACE_ME/);
  assert.match(read('firmware/SpineAlign_ESP32CAM/SpineAlign_ESP32CAM.ino'), /isPlaceholderCredential/);
});

test('CI compiles physical sketch with its own build configuration and validates tests', () => {
  const workflow=read('.github/workflows/arduino-build.yml');
  assert.match(workflow,/npm|node --test/);
  assert.match(workflow,/platformio|pio run/);
  assert.match(workflow,/firmware\/SpineAlign_ESP32CAM/);
});
