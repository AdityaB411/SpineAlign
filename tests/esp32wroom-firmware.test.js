const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const telemetry = require('../telemetry-protocol.js');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('ESP32-WROOM firmware targets ESP32 architecture with dedicated standard pins', () => {
  const fw = read('firmware/SpineAlign_ESP32WROOM/SpineAlign_ESP32WROOM.ino');
  assert.match(fw, /#include <BLEDevice\.h>/);
  assert.match(fw, /#include <BLEServer\.h>/);
  assert.match(fw, /#include <Adafruit_SSD1306\.h>/);

  // ESP32-WROOM standard pin assignments: GPIO21 (SDA), GPIO22 (SCL), GPIO18 (Alert), GPIO0 (Boot/Calibrate)
  assert.match(fw, /#define SDA_PIN 21/);
  assert.match(fw, /#define SCL_PIN 22/);
  assert.match(fw, /#define ALERT_PIN 18/);
  assert.match(fw, /#define CALIBRATION_BUTTON_PIN 0/);

  // Root Arduino IDE sketch matches
  const rootArduino = read('SpineAlign.ino');
  assert.match(rootArduino, /#define SDA_PIN 21/);
  assert.match(rootArduino, /#define SCL_PIN 22/);
  assert.match(rootArduino, /#include <BLEDevice\.h>/);
});

test('ESP32-WROOM firmware configures Bluetooth Low Energy with SpineAlign service UUIDs', () => {
  const fw = read('firmware/SpineAlign_ESP32WROOM/SpineAlign_ESP32WROOM.ino');
  assert.match(fw, /67b7a001-9b7c-4eb7-a1a8-6b7f51a0a101/);
  assert.match(fw, /67b7a002-9b7c-4eb7-a1a8-6b7f51a0a101/);
  assert.match(fw, /SpineAlign-ESP32/);
  assert.match(fw, /PROPERTY_NOTIFY/);
  assert.match(fw, /PROPERTY_WRITE/);
  assert.match(fw, /"CALIBRATE"/);
  assert.match(fw, /"CALIBRATED"/);
  assert.match(fw, /"CALIBRATION FAILED"/);
});

test('ESP32-WROOM telemetry string matches SpineAlign strict protocol format', () => {
  const fw = read('firmware/SpineAlign_ESP32WROOM/SpineAlign_ESP32WROOM.ino');
  for (const field of ['N:', 'B:', 'NP:', 'NR:', 'BP:', 'BR:', 'MODE:', 'ALERT:', 'CAL:', 'NS:', 'BS:', 'BAT:', 'PCT:', 'CHG:', 'FULL:']) {
    assert.ok(fw.includes(field), `ESP32-WROOM firmware missing telemetry field: ${field}`);
  }

  const simulatedSample = 'N:5.2,B:8.7,NP:4.0,NR:0.8,BP:7.0,BR:-1.2,MODE:1,ALERT:0,CAL:1,NS:0,BS:1,BAT:-1,PCT:-1,CHG:-1,FULL:-1';
  const parsed = telemetry.parseLine(simulatedSample);
  assert.ok(parsed, 'Simulated ESP32-WROOM telemetry must parse successfully');
  assert.equal(parsed.MODE, 1);
  assert.equal(parsed.CAL, 1);
  assert.equal(parsed.ALERT, 0);
  assert.equal(parsed.N, 5.2);
  assert.equal(parsed.B, 8.7);
  assert.equal(parsed.BAT, -1);
});

test('ESP32-WROOM PlatformIO configuration specifies espressif32 and esp32dev board', () => {
  const pio = read('firmware/SpineAlign_ESP32WROOM/platformio.ini');
  assert.match(pio, /platform\s*=\s*espressif32/);
  assert.match(pio, /board\s*=\s*esp32dev/);
  assert.match(pio, /Adafruit SSD1306/);
});

test('ESP32-WROOM config template and gitignore prevent secret leakage', () => {
  assert.match(read('firmware/SpineAlign_ESP32WROOM/.gitignore'), /config\.h/);
  const example = read('firmware/SpineAlign_ESP32WROOM/config.example.h');
  assert.match(example, /SPINEALIGN_DUAL_IMU/);
  assert.match(example, /BATTERY_MONITOR_ENABLED/);
});
