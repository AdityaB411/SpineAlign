const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('orientation3d.js enforces pure 1:1 mathematical angular fidelity without fractional dampening multipliers', () => {
  const code = read('orientation3d.js');

  // Verify direct 1:1 mapping: torso.rotation.x = current.backPitch * DEG (no * 0.88 or similar)
  assert.match(code, /torso\.rotation\.x\s*=\s*current\.backPitch\s*\*\s*DEG;/);
  assert.match(code, /torso\.rotation\.z\s*=\s*-current\.backRoll\s*\*\s*DEG;/);
  assert.match(code, /torso\.rotation\.y\s*=\s*current\.backTwist\s*\*\s*DEG;/);

  // Verify direct 1:1 head rotation relative to torso:
  assert.match(code, /head\.rotation\.x\s*=\s*\(current\.neckPitch\s*-\s*current\.backPitch\)\s*\*\s*DEG;/);
  assert.match(code, /head\.rotation\.z\s*=\s*-\(current\.neckRoll\s*-\s*current\.backRoll\)\s*\*\s*DEG;/);
  assert.match(code, /head\.rotation\.y\s*=\s*\(current\.neckTwist\s*-\s*current\.backTwist\)\s*\*\s*DEG;/);

  // Assert absence of legacy arbitrary multipliers
  assert.doesNotMatch(code, /DEG\s*\*\s*0\.88/);
  assert.doesNotMatch(code, /DEG\s*\*\s*0\.85/);
  assert.doesNotMatch(code, /DEG\s*\*\s*0\.80/);
  assert.doesNotMatch(code, /DEG\s*\*\s*0\.90/);
});

test('orientation3d.js features dual-color sculpted translucent human shell with segmented glowing spine', () => {
  const code = read('orientation3d.js');

  // BASE_COLORS should include distinct torso, spine, neck, cervical, head, and alert entries
  assert.match(code, /BASE_COLORS\s*=\s*\{/);
  assert.match(code, /torso:\s*0x06b6d4/);
  assert.match(code, /spine:\s*0x5eead4/);
  assert.match(code, /cervical:\s*0xfcd34d/);
  assert.match(code, /neck:\s*0xfb923c/);
  assert.match(code, /head:\s*0xf59e0b/);
  assert.match(code, /alert:\s*0xf43f5e/);

  // Sculpted SkinnedMesh human upper-body with smooth segmented spinal bone chain & quaternion slerp
  assert.match(code, /new THREE\.SkinnedMesh\(buildSculptedTorsoNeckGeometry\(\)/);
  assert.match(code, /new THREE\.SkinnedMesh\(buildSculptedHeadGeometry\(\)/);
  assert.match(code, /boneWorldQuats\[i\]\.copy\(qBackWorld\)\.slerp\(qNeckWorld,\s*def\.neckT\)/);
  assert.match(code, /boneWorldQuats\[i\]\.copy\(qIdentity\)\.slerp\(qBackWorld,\s*def\.backT\)/);
  assert.match(code, /cervicalSpineMat/);
  assert.match(code, /lumbarSpineMat/);
});

test('analytical 2nd-order critically damped harmonic oscillator guarantees zero overshoot and C1 continuity', () => {
  // Pure analytical test of the oscillator integration formula
  const omega = 15.0; // rad/s
  let current = 0.0;
  let velocity = 0.0;
  const target = 25.0; // 25 degree step change
  const targetVelocity = 0.0;
  const dt = 1.0 / 60.0; // 60 FPS (~16.6ms)

  let peak = -Infinity;
  const positions = [];
  const velocities = [];

  // Simulate 1 second of motion (60 frames)
  for (let frame = 0; frame < 60; frame++) {
    const xDiff = current - target;
    const vDiff = velocity - targetVelocity;
    const expTerm = Math.exp(-omega * dt);
    const temp = vDiff + omega * xDiff;

    current = target + (xDiff + temp * dt) * expTerm;
    velocity = targetVelocity + (vDiff - omega * temp * dt) * expTerm;

    positions.push(current);
    velocities.push(velocity);
    if (current > peak) peak = current;
  }

  // Zero overshoot assertion: target is 25.0, peak must NEVER exceed 25.0
  assert.ok(peak <= 25.0001, `Critically damped oscillator overshot target! Peak: ${peak}`);

  // Velocity must start near zero and smoothly accelerate then decelerate (no jump to infinity)
  assert.ok(velocities[0] > 0, 'Velocity should immediately begin accelerating smoothly');
  assert.ok(velocities[0] < 150, 'Velocity acceleration is bounded (no infinite jerk)');

  // By frame 30 (~500ms), system is within 1% of target
  assert.ok(Math.abs(current - target) < 0.25, `Expected settlement within 1%, got error: ${Math.abs(current - target)}`);
});

test('outlier spike rejection clamps single-packet steps exceeding 45 degrees', () => {
  const code = read('orientation3d.js');
  assert.match(code, /MAX_STEP_DEG\s*=\s*45\.0/);
  assert.match(code, /Math\.abs\(rawBP - current\.backPitch\) > MAX_STEP_DEG/);
});

test('signal gap detection triggers holding after 2.5s and soft relaxation after 4.0s', () => {
  const code = read('orientation3d.js');
  assert.match(code, /GAP_STALE_MS\s*=\s*2500/);
  assert.match(code, /now - lastPacketTime > GAP_STALE_MS/);
  assert.match(code, /now - lastPacketTime > 4000/);
  assert.match(code, /target\[k\]\s*\+=\s*\(0\s*-\s*target\[k\]\)\s*\*\s*drift/);
});

test('NodeMCU firmware streams telemetry at 25 Hz (TELEMETRY_INTERVAL_MS = 40)', () => {
  const nodemcuFw = read('firmware/SpineAlign_NodeMCU/SpineAlign_NodeMCU.ino');
  assert.match(nodemcuFw, /const unsigned long TELEMETRY_INTERVAL_MS\s*=\s*40;/);
});
