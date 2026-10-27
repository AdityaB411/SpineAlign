const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../telemetry-protocol.js');

const full = 'N:5.2,B:8.7,NP:4.1,NR:1.0,BP:7.2,BR:-2.1,ALERT:0,CAL:1,NS:1,BS:1,BAT:3.87,PCT:78,CHG:0,FULL:0';

test('accepts full firmware telemetry including battery and charging fields', () => {
  const parsed = parseLine(full);
  assert.equal(parsed.N, 5.2);
  assert.equal(parsed.BR, -2.1);
  assert.equal(parsed.CAL, 1);
  assert.equal(parsed.PCT, 78);
  assert.equal(parsed.CHG, 0);
});

test('accepts missing optional fields for older firmware', () => {
  assert.deepEqual(parseLine('N:1.2,B:3.4'), { N: 1.2, B: 3.4 });
});

test('accepts unavailable battery and charger sentinels', () => {
  const parsed = parseLine('N:0,B:0,ALERT:0,CAL:0,NS:1,BS:1,BAT:-1,PCT:-1,CHG:-1,FULL:-1');
  assert.equal(parsed.BAT, -1);
  assert.equal(parsed.CHG, -1);
});

test('rejects missing mandatory angles and non-telemetry text', () => {
  assert.equal(parseLine('N:1.2,NP:2'), null);
  assert.equal(parseLine('CALIBRATED'), null);
  assert.equal(parseLine(''), null);
});

test('rejects malformed and partially corrupted numbers', () => {
  assert.equal(parseLine('N:5.2garbage,B:3.0'), null);
  assert.equal(parseLine('N:NaN,B:3.0'), null);
  assert.equal(parseLine('N:Infinity,B:3.0'), null);
  assert.equal(parseLine('N:1e3,B:2'), null);
});

test('rejects duplicate keys, unknown keys, and incomplete tokens', () => {
  assert.equal(parseLine('N:1,B:2,N:3'), null);
  assert.equal(parseLine('N:1,B:2,EXTRA:4'), null);
  assert.equal(parseLine('N:1,B:2,BAT'), null);
});

test('rejects invalid state flags and impossible battery percentages', () => {
  assert.equal(parseLine('N:1,B:2,CAL:2'), null);
  assert.equal(parseLine('N:1,B:2,CHG:2'), null);
  assert.equal(parseLine('N:1,B:2,PCT:101'), null);
  assert.equal(parseLine('N:1,B:2,BAT:8.4'), null);
});

test('rejects excessively long frames and out-of-range angles', () => {
  assert.equal(parseLine('N:1,B:2,' + 'X'.repeat(260)), null);
  assert.equal(parseLine('N:361,B:2'), null);
});

test('does not coerce missing optional values to zero', () => {
  const parsed = parseLine('N:1,B:2');
  assert.equal(parsed.NP, undefined);
  assert.equal(parsed.CHG, undefined);
});

test('validates the explicit physical sensor mode', () => {
  assert.equal(parseLine('N:0,B:4.3,MODE:1,NS:0,BS:1,ALERT:0,CAL:1,BAT:3.9,PCT:80,CHG:0,FULL:0').MODE, 1);
  assert.equal(parseLine('N:2,B:4.3,MODE:2,NS:1,BS:1').MODE, 2);
  assert.equal(parseLine('N:0,B:4.3,MODE:0'), null);
});
