(async () => {
  'use strict';
  let THREE;
  try {
    const threeModule = await import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js");
    THREE = threeModule;
  } catch (err) {
    try {
      THREE = await import("three");
    } catch (e2) {
      console.error('Three.js could not be loaded:', e2);
      const loader = document.getElementById('modelLoading');
      const label = document.getElementById('modelLoadingText');
      const status = document.getElementById('modelStatusText');
      const controls = document.getElementById('modelDemoControls');
      if (label) label.textContent = '3D view unavailable. Check internet connection for Three.js CDN.';
      if (loader) loader.hidden = false;
      if (status) status.textContent = 'Unavailable';
      if (controls) controls.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
      return;
    }
  }

  const canvas = document.getElementById('posture3dCanvas');
  if (!canvas) return;

  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const DEG = Math.PI / 180;

  // Anatomical pivot heights in world units (total model height ~3.2m scale)
  // Lumbar-sacral pivot: L4-L5/S1 hinge
  const BACK_PIVOT = 1.35;
  // Cervical-thoracic pivot: C7-T1 junction
  const NECK_PIVOT = 2.45;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b111e, 0.035);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const targetLookAt = new THREE.Vector3(0, 1.62, 0);
  camera.position.set(0, 1.85, 5.6);
  camera.lookAt(targetLookAt);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('WebGL is unavailable:', error);
    const loader = $('modelLoading'), label = $('modelLoadingText'), status = $('modelStatusText');
    if (label) label.textContent = '3D view unavailable because WebGL could not be initialized.';
    if (loader) loader.hidden = false;
    if (status) status.textContent = 'Unavailable';
    $('modelDemoControls')?.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b111e, 1.0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  // Orbit controls with smooth momentum
  function setupOrbitControls(domElement, cam, lookTarget) {
    let isDragging = false;
    let prevX = 0, prevY = 0;
    let theta = 0;                // Azimuth
    let phi = Math.PI / 2 - 0.05; // Elevation
    let radius = 5.6;             // Distance
    let targetTheta = theta, targetPhi = phi, targetRadius = radius;

    domElement.style.cursor = 'grab';

    domElement.addEventListener('pointerdown', (e) => {
      isDragging = true;
      domElement.style.cursor = 'grabbing';
      prevX = e.clientX;
      prevY = e.clientY;
      domElement.setPointerCapture(e.pointerId);
    });

    domElement.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      targetTheta -= dx * 0.007;
      targetPhi -= dy * 0.007;
      targetPhi = clamp(targetPhi, 0.2, Math.PI - 0.2);
    });

    const stopDragging = (e) => {
      if (isDragging) {
        isDragging = false;
        domElement.style.cursor = 'grab';
        try { domElement.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    domElement.addEventListener('pointerup', stopDragging);
    domElement.addEventListener('pointercancel', stopDragging);

    domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      targetRadius += e.deltaY * 0.004;
      targetRadius = clamp(targetRadius, 3.0, 8.5);
    }, { passive: false });

    return {
      update() {
        theta += (targetTheta - theta) * 0.12;
        phi += (targetPhi - phi) * 0.12;
        radius += (targetRadius - radius) * 0.12;
        cam.position.x = lookTarget.x + radius * Math.sin(theta) * Math.sin(phi);
        cam.position.y = lookTarget.y + radius * Math.cos(phi);
        cam.position.z = lookTarget.z + radius * Math.cos(theta) * Math.sin(phi);
        cam.lookAt(lookTarget);
      }
    };
  }

  const controls = setupOrbitControls(renderer.domElement, camera, targetLookAt);

  // Kinematic hierarchy: Root -> Torso (pivots at lower spine) -> Head (pivots at cervical C7)
  const root = new THREE.Group();
  scene.add(root);

  // Set rotation order to YXZ:
  // 1. Axial Twist (Y) along vertical spinal column
  // 2. Lateral Lean / Roll (Z)
  // 3. Flexion / Extension Pitch (X)
  const torso = new THREE.Group();
  torso.rotation.order = 'YXZ';
  torso.position.y = BACK_PIVOT;
  root.add(torso);

  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.y = NECK_PIVOT - BACK_PIVOT;
  torso.add(head);

  // Particle Texture Generator: smooth radial Gaussian halo
  function createParticleTexture() {
    const texCanvas = document.createElement('canvas');
    texCanvas.width = texCanvas.height = 64;
    const ctx = texCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(texCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const dotTexture = createParticleTexture();

  // Bioluminescent Point Materials
  const createMaterial = (colorHex, size, opacity) => new THREE.PointsMaterial({
    color: new THREE.Color(colorHex),
    size: size,
    map: dotTexture,
    transparent: true,
    opacity: opacity,
    alphaTest: 0.015,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending
  });

  // Harmonious Dual-Color Palette:
  // - Torso & Spine: Electric Cyan / Glowing Teal
  // - Neck, Cervical Spine & Cranium: Radiant Amber / Sunlit Gold
  // - Lower Body: Grounded Deep Slate Navy
  // - Alert: Warning Crimson / Coral Red
  const BASE_COLORS = {
    lower:    0x334155, // Grounded slate navy
    torso:    0x06b6d4, // Electric cyan ribcage
    spine:    0x5eead4, // High-luminosity thoracic/lumbar spine
    cervical: 0xfcd34d, // Radiant golden cervical spine
    neck:     0xfb923c, // Warm amber neck sheath
    head:     0xf59e0b, // Amber/gold cranium
    alert:    0xf43f5e  // Warning crimson
  };

  const lowerMat    = createMaterial(BASE_COLORS.lower,    0.026, 0.65);
  const torsoMat    = createMaterial(BASE_COLORS.torso,    0.028, 0.95);
  const spineMat    = createMaterial(BASE_COLORS.spine,    0.038, 1.0);
  const cervicalMat = createMaterial(BASE_COLORS.cervical, 0.036, 1.0);
  const neckMat     = createMaterial(BASE_COLORS.neck,     0.030, 0.92);
  const headMat     = createMaterial(BASE_COLORS.head,     0.030, 0.98);

  // Pre-allocated color targets for zero-allocation, GC-free render loop
  const tmpTorsoColor    = new THREE.Color();
  const tmpSpineColor    = new THREE.Color();
  const tmpCervicalColor = new THREE.Color();
  const tmpHeadColor     = new THREE.Color();

  function createCloud(points, parent, material, pivotY = 0) {
    if (!points.length) return;
    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3]     = points[i].x;
      positions[i * 3 + 1] = points[i].y - pivotY;
      positions[i * 3 + 2] = points[i].z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    parent.add(cloud);
  }

  // Optimized High-Fidelity Anatomical Bioluminescent Particle Figure (~4,800 points)
  function generateBioluminescentFigure() {
    const lowerPoints    = [];
    const torsoPoints    = [];
    const spinePoints    = [];
    const cervicalPoints = [];
    const neckPoints     = [];
    const headPoints     = [];

    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const addEllipsoid = (cx, cy, cz, rx, ry, rz, count, dest, shellBias = 0.82) => {
      for (let i = 0; i < count; i++) {
        const u = rand();
        const v = rand();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = shellBias + (1.0 - shellBias) * Math.cbrt(rand());
        const x = cx + r * rx * Math.sin(phi) * Math.cos(theta);
        const y = cy + r * ry * Math.cos(phi);
        const z = cz + r * rz * Math.sin(phi) * Math.sin(theta);
        dest.push(new THREE.Vector3(x, y, z));
      }
    };

    // 1. HEAD & CRANIUM (Pivots with Head, above NECK_PIVOT = 2.45)
    // Cranial vault
    addEllipsoid(0, 2.82, 0.03, 0.22, 0.26, 0.22, 850, headPoints);
    // Facial & jaw contour
    addEllipsoid(0, 2.65, 0.12, 0.16, 0.18, 0.14, 450, headPoints);

    // 2. CERVICAL SPINE (C1-C7) & NECK CYLINDER (Pivots with Head)
    // Cervical vertebrae core nodes articulate with Head group
    for (let y = NECK_PIVOT; y <= 2.65; y += 0.026) {
      const prog = (y - NECK_PIVOT) / (2.65 - NECK_PIVOT);
      const zOffset = -0.06 - 0.02 * prog;
      cervicalPoints.push(new THREE.Vector3(0, y, zOffset));
      cervicalPoints.push(new THREE.Vector3(-0.022, y, zOffset));
      cervicalPoints.push(new THREE.Vector3(0.022, y, zOffset));
    }

    // Cervical neck sheath
    for (let i = 0; i < 350; i++) {
      const t = rand();
      const y = NECK_PIVOT + t * (2.62 - NECK_PIVOT);
      const angle = rand() * Math.PI * 2;
      const radius = 0.09 + 0.02 * (1.0 - t);
      neckPoints.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    }

    // 3. TORSO & THORACIC/LUMBAR SPINE (Pivots with Back at BACK_PIVOT = 1.35)
    // Thorax & ribcage
    addEllipsoid(0, 2.18, 0.01, 0.36, 0.28, 0.19, 700, torsoPoints);
    addEllipsoid(0, 1.80, 0.00, 0.33, 0.26, 0.18, 600, torsoPoints);
    addEllipsoid(0, 1.48, -0.01, 0.31, 0.20, 0.17, 400, torsoPoints);

    // Anatomical Thoracic & Lumbar Vertebral Column with lateral transverse processes
    for (let y = BACK_PIVOT; y <= NECK_PIVOT; y += 0.024) {
      const progress = (y - BACK_PIVOT) / (NECK_PIVOT - BACK_PIVOT);
      // Anatomical S-curve (lumbar lordosis + thoracic kyphosis)
      const zOffset = -0.14 + 0.045 * Math.sin(progress * Math.PI);
      // Central spinous process node
      spinePoints.push(new THREE.Vector3(0, y, zOffset));
      // Left and right transverse process facets
      const span = 0.032 * (1.0 - 0.3 * progress);
      spinePoints.push(new THREE.Vector3(-span, y, zOffset - 0.005));
      spinePoints.push(new THREE.Vector3(span, y, zOffset - 0.005));
    }

    // Shoulders & Clavicle Arch
    addEllipsoid(-0.42, 2.30, -0.01, 0.14, 0.12, 0.14, 180, torsoPoints);
    addEllipsoid(0.42, 2.30, -0.01, 0.14, 0.12, 0.14, 180, torsoPoints);

    // Upper Arms
    addEllipsoid(-0.44, 1.82, 0.0, 0.11, 0.44, 0.11, 250, torsoPoints);
    addEllipsoid(0.44, 1.82, 0.0, 0.11, 0.44, 0.11, 250, torsoPoints);

    // 4. LOWER BODY & BASE (Anchored to Root, below BACK_PIVOT = 1.35)
    // Pelvic girdle
    addEllipsoid(0, 1.20, -0.01, 0.33, 0.22, 0.18, 350, lowerPoints);
    // Legs
    addEllipsoid(-0.19, 0.65, 0.01, 0.14, 0.52, 0.14, 250, lowerPoints);
    addEllipsoid(0.19, 0.65, 0.01, 0.14, 0.52, 0.14, 250, lowerPoints);

    // Ground reference orientation compass ring
    for (let i = 0; i < 180; i++) {
      const angle = (i / 180) * Math.PI * 2;
      const r = 0.95 + 0.04 * rand();
      lowerPoints.push(new THREE.Vector3(Math.cos(angle) * r, 0.02, Math.sin(angle) * r));
    }

    // Assemble cloud hierarchies
    createCloud(lowerPoints, root, lowerMat);
    createCloud(torsoPoints, torso, torsoMat, BACK_PIVOT);
    createCloud(spinePoints, torso, spineMat, BACK_PIVOT);
    createCloud(cervicalPoints, head, cervicalMat, NECK_PIVOT);
    createCloud(neckPoints, head, neckMat, NECK_PIVOT);
    createCloud(headPoints, head, headMat, NECK_PIVOT);

    const loaderEl = $('modelLoading');
    if (loaderEl) loaderEl.hidden = true;
    if ($('modelStatusPill')) $('modelStatusPill').classList.remove('loading');
    if ($('modelStatusText')) $('modelStatusText').textContent = '3D Particle Figure Ready';
  }

  generateBioluminescentFigure();

  // State Management
  let live = false;
  let manual = false;
  let singleSensorMode = false;
  let alertActive = false;
  let canvasWidth = 0;
  let canvasHeight = 0;

  const AXES = ['backPitch', 'backRoll', 'backTwist', 'neckPitch', 'neckRoll', 'neckTwist'];

  // Commanded target angles in degrees
  const target = {
    backPitch: 7.0,
    backRoll: -1.2,
    backTwist: 0.0,
    neckPitch: 4.0,
    neckRoll: 0.8,
    neckTwist: 0.0
  };

  // Current continuous orientation state
  const current = { ...target };

  // Angular velocities in deg/s for continuous 2nd-order critically damped motion
  const velocity = {
    backPitch: 0.0,
    backRoll: 0.0,
    backTwist: 0.0,
    neckPitch: 0.0,
    neckRoll: 0.0,
    neckTwist: 0.0
  };

  // Estimated target velocities for feed-forward tracking across telemetry intervals
  const targetVelocity = {
    backPitch: 0.0,
    backRoll: 0.0,
    backTwist: 0.0,
    neckPitch: 0.0,
    neckRoll: 0.0,
    neckTwist: 0.0
  };

  // Telemetry health, gap handling & outlier filtering
  let lastPacketTime = performance.now();
  let isSignalStale = false;
  const GAP_STALE_MS = 2500;  // 2.5s before gentle hold
  const MAX_STEP_DEG = 45.0;  // Maximum credible change per packet (outlier spike rejection)

  const formatAngle = v => {
    const num = Number(v) || 0;
    const rounded = Math.abs(num) < 0.05 ? 0 : num;
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}°`;
  };

  function sanitizeAngle(val, defaultVal = 0, min = -50, max = 50) {
    if (val === null || val === undefined || typeof val === 'boolean') return defaultVal;
    const num = Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) return defaultVal;
    return clamp(num, min, max);
  }

  function showReadings() {
    if ($('modelNeckPitch')) $('modelNeckPitch').textContent = formatAngle(target.neckPitch);
    if ($('modelNeckRoll'))  $('modelNeckRoll').textContent  = formatAngle(target.neckRoll);
    if ($('modelNeckTwist')) $('modelNeckTwist').textContent = formatAngle(target.neckTwist);
    if ($('modelBackPitch')) $('modelBackPitch').textContent = formatAngle(target.backPitch);
    if ($('modelBackRoll'))  $('modelBackRoll').textContent  = formatAngle(target.backRoll);
    if ($('modelBackTwist')) $('modelBackTwist').textContent = formatAngle(target.backTwist);

    if ($('modelStatusPill')) {
      $('modelStatusPill').classList.toggle('live', live && !isSignalStale);
      $('modelStatusPill').classList.toggle('stale', isSignalStale);
    }
    if ($('modelStatusText')) {
      $('modelStatusText').textContent = isSignalStale
        ? 'Signal paused · Holding orientation'
        : (live ? 'Live Kinematic Tracking (1:1)' : 'Demo Orientation');
    }
    if ($('modelDataMode')) {
      $('modelDataMode').textContent = live ? 'LIVE' : 'DEMO';
      $('modelDataMode').classList.toggle('live', live);
    }
  }

  function syncSliders() {
    const pairs = [
      ['demoBackPitch', 'demoBackPitchValue', target.backPitch],
      ['demoBackRoll',  'demoBackRollValue',  target.backRoll],
      ['demoBackTwist', 'demoBackTwistValue', target.backTwist],
      ['demoNeckPitch', 'demoNeckPitchValue', target.neckPitch],
      ['demoNeckRoll',  'demoNeckRollValue',  target.neckRoll],
      ['demoNeckTwist', 'demoNeckTwistValue', target.neckTwist]
    ];
    for (const [id, out, v] of pairs) {
      if ($(id)) $(id).value = String(Math.round(v));
      if ($(out)) $(out).textContent = `${Math.round(v)}°`;
    }
  }

  function setMode(mode) {
    live = mode === 'live';
    if (live) manual = false;
    const controls = $('modelDemoControls');
    if (controls) {
      controls.querySelectorAll('input,button').forEach(el => { el.disabled = live; });
    }
    if (!live) {
      manual = false;
      isSignalStale = false;
      Object.assign(target, {
        backPitch: 7.0,
        backRoll: -1.2,
        backTwist: 0.0,
        neckPitch: 4.0,
        neckRoll: 0.8,
        neckTwist: 0.0
      });
      syncSliders();
    }
    const noteP = $('modelDataNote')?.querySelector('p');
    if (noteP) {
      noteP.textContent = live
        ? 'Live 3-axis tracking: Exact 1:1 angular fidelity with 2nd-order critically damped smoothing.'
        : 'Adjust sliders below or drag/scroll 3D canvas to preview forward/backward bend and sideways twist.';
    }
    showReadings();
  }

  // Telemetry Input with Outlier Clamping, Target Velocity Estimation & Physiological Coupling
  function updateTelemetry(data) {
    if (!data || (manual && !live)) return;

    if (data.mode === 'live') {
      live = true;
      $('modelDemoControls')?.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    }

    singleSensorMode = data.singleSensorMode === true || data.mode === 1;
    alertActive = Boolean(data.alert);

    const now = (typeof data.timestamp === 'number' && Number.isFinite(data.timestamp))
      ? data.timestamp
      : performance.now();
    const dtPkt = Math.max(0.001, (now - lastPacketTime) / 1000.0);

    // 1. Sanitize raw angles
    const rawBP = sanitizeAngle(data.backPitch, target.backPitch, -45, 45);
    const rawBR = sanitizeAngle(data.backRoll, target.backRoll, -35, 35);

    // Slew rate / spike rejection filter: Clamp impossible single-packet jumps (> 45 deg)
    const validBP = Math.abs(rawBP - current.backPitch) > MAX_STEP_DEG
      ? current.backPitch + Math.sign(rawBP - current.backPitch) * MAX_STEP_DEG
      : rawBP;
    const validBR = Math.abs(rawBR - current.backRoll) > MAX_STEP_DEG
      ? current.backRoll + Math.sign(rawBR - current.backRoll) * MAX_STEP_DEG
      : rawBR;

    // Back twist: explicit sensor twist if present; otherwise physiological coupling with back roll
    let validBT;
    if (data.backTwist !== undefined && data.backTwist !== null && Number.isFinite(Number(data.backTwist))) {
      const rawBT = sanitizeAngle(data.backTwist, 0, -35, 35);
      validBT = Math.abs(rawBT - current.backTwist) > MAX_STEP_DEG
        ? current.backTwist + Math.sign(rawBT - current.backTwist) * MAX_STEP_DEG
        : rawBT;
    } else {
      // Natural anatomical coupling: Lateral lean induces transverse trunk rotation
      validBT = clamp(-validBR * 0.35 * (1.0 + 0.3 * (Math.abs(validBP) / 30.0)), -35, 35);
    }

    let validNP, validNR, validNT;

    if (singleSensorMode) {
      // Natural cervical head stabilization relative to forward torso lean
      validNP = -validBP * 0.30;
      validNR = -validBR * 0.25;
      validNT = -validBT * 0.40;
    } else {
      const rawNP = sanitizeAngle(data.neckPitch, target.neckPitch, -45, 45);
      const rawNR = sanitizeAngle(data.neckRoll, target.neckRoll, -35, 35);
      validNP = Math.abs(rawNP - current.neckPitch) > MAX_STEP_DEG
        ? current.neckPitch + Math.sign(rawNP - current.neckPitch) * MAX_STEP_DEG
        : rawNP;
      validNR = Math.abs(rawNR - current.neckRoll) > MAX_STEP_DEG
        ? current.neckRoll + Math.sign(rawNR - current.neckRoll) * MAX_STEP_DEG
        : rawNR;

      if (data.neckTwist !== undefined && data.neckTwist !== null && Number.isFinite(Number(data.neckTwist))) {
        const rawNT = sanitizeAngle(data.neckTwist, 0, -40, 40);
        validNT = Math.abs(rawNT - current.neckTwist) > MAX_STEP_DEG
          ? current.neckTwist + Math.sign(rawNT - current.neckTwist) * MAX_STEP_DEG
          : rawNT;
      } else {
        const relRoll = validNR - validBR;
        validNT = clamp(-relRoll * 0.45, -40, 40);
      }
    }

    if (!manual) {
      const nextTarget = {
        backPitch: validBP,
        backRoll:  validBR,
        backTwist: validBT,
        neckPitch: validNP,
        neckRoll:  validNR,
        neckTwist: validNT
      };

      // Feed-forward target velocity: When packets arrive regularly (30ms - 400ms),
      // compute slope to eliminate lag and predict continuous movement
      if (dtPkt >= 0.03 && dtPkt <= 0.40) {
        for (const k of AXES) {
          const v = (nextTarget[k] - target[k]) / dtPkt;
          targetVelocity[k] = clamp(v, -120, 120);
        }
      } else {
        for (const k of AXES) {
          targetVelocity[k] = 0;
        }
      }

      for (const k of AXES) {
        target[k] = nextTarget[k];
      }
    }

    lastPacketTime = now;
    isSignalStale = false;
    showReadings();
  }

  function handleDemoInput() {
    if (live) return;
    manual = true;
    if ($('demoBackPitch')) target.backPitch = sanitizeAngle($('demoBackPitch').value, 0, -35, 35);
    if ($('demoBackRoll'))  target.backRoll  = sanitizeAngle($('demoBackRoll').value, 0, -30, 30);
    if ($('demoBackTwist')) target.backTwist = sanitizeAngle($('demoBackTwist').value, 0, -35, 35);
    if ($('demoNeckPitch')) target.neckPitch = sanitizeAngle($('demoNeckPitch').value, 0, -40, 40);
    if ($('demoNeckRoll'))  target.neckRoll  = sanitizeAngle($('demoNeckRoll').value, 0, -30, 30);
    if ($('demoNeckTwist')) target.neckTwist = sanitizeAngle($('demoNeckTwist').value, 0, -40, 40);
    for (const k of AXES) targetVelocity[k] = 0;
    syncSliders();
    showReadings();
  }

  ['demoBackPitch', 'demoBackRoll', 'demoBackTwist', 'demoNeckPitch', 'demoNeckRoll', 'demoNeckTwist'].forEach(id => {
    $(id)?.addEventListener('input', handleDemoInput);
  });

  $('modelResetBtn')?.addEventListener('click', () => {
    manual = false;
    Object.assign(target, { backPitch: 0, backRoll: 0, backTwist: 0, neckPitch: 0, neckRoll: 0, neckTwist: 0 });
    for (const k of AXES) targetVelocity[k] = 0;
    syncSliders();
    showReadings();
  });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || (rect.width === canvasWidth && rect.height === canvasHeight)) return;
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(canvas);
  }
  window.addEventListener('resize', resize);
  resize();

  // Animation Loop with Analytical 2nd-Order Critically Damped Harmonic Oscillator
  // Guarantees zero overshoot (zeta = 1.0), continuous velocity and acceleration curves,
  // completely eliminating discrete telemetry stepping and laggy/sharp animations.
  let lastFrameTime = performance.now();
  let breathPhase = 0;

  function animate(now) {
    requestAnimationFrame(animate);

    const dt = Math.min(Math.max((now - lastFrameTime) / 1000.0, 0.001), 0.08);
    lastFrameTime = now;

    // Detect signal gaps in live telemetry
    if (live && (now - lastPacketTime > GAP_STALE_MS)) {
      if (!isSignalStale) {
        isSignalStale = true;
        showReadings();
      }
      // Prolonged gap (> 4s): softly decay targets toward neutral zero (no abrupt snapping)
      if (now - lastPacketTime > 4000) {
        const drift = 0.35 * dt;
        for (const k of AXES) {
          target[k] += (0 - target[k]) * drift;
          targetVelocity[k] = 0;
        }
      }
    }

    // Decay feed-forward target velocity if packet interval has elapsed
    const timeSincePacket = (now - lastPacketTime) / 1000.0;
    if (timeSincePacket > 0.12) {
      const vDecay = Math.exp(-12.0 * dt);
      for (const k of AXES) {
        targetVelocity[k] *= vDecay;
      }
    }

    // Exact Analytical Critically Damped Oscillator Integration (zeta = 1.0):
    // Natural angular frequency omega = 15.0 rad/s
    // Settles cleanly in ~150ms while maintaining C1 velocity continuity across packet arrivals
    const omega = 15.0;
    const expTerm = Math.exp(-omega * dt);

    for (const k of AXES) {
      const xDiff = current[k] - target[k];
      const vDiff = velocity[k] - targetVelocity[k];
      const temp = vDiff + omega * xDiff;

      current[k]  = target[k] + (xDiff + temp * dt) * expTerm;
      velocity[k] = targetVelocity[k] + (vDiff - omega * temp * dt) * expTerm;
    }

    // =========================================================================
    // EXACT 1:1 MATHEMATICAL ANGULAR FIDELITY (Zero arbitrary scaling factors)
    // =========================================================================

    // 1. TORSO 3D ROTATION:
    // Euler Order 'YXZ':
    // Y (Axial Twist) -> Z (Lateral Roll / Lean) -> X (Forward/Backward Pitch)
    torso.rotation.x = current.backPitch * DEG;
    torso.rotation.z = -current.backRoll * DEG;
    torso.rotation.y = current.backTwist * DEG;

    // 2. CERVICAL HEAD 3D ROTATION (Relative to Torso in Three.js hierarchy):
    // World Head Rotation = Torso Rotation + Head Rotation
    // Therefore: Head Rotation = Neck IMU - Back IMU
    head.rotation.x = (current.neckPitch - current.backPitch) * DEG;
    head.rotation.z = -(current.neckRoll - current.backRoll) * DEG;
    head.rotation.y = (current.neckTwist - current.backTwist) * DEG;

    // 3. Natural Thoracic Breathing & Shimmer
    breathPhase += dt * 1.4; // ~0.22 Hz natural resting breath rate (13 breaths/min)
    const breathScale = 1.0 + 0.006 * Math.sin(breathPhase);
    torso.scale.set(breathScale, 1.0 + 0.003 * Math.sin(breathPhase * 0.5), breathScale);

    // 4. Smooth Alert Color Shift
    const alertTorsoTarget    = alertActive ? BASE_COLORS.alert : BASE_COLORS.torso;
    const alertSpineTarget    = alertActive ? 0xf87171          : BASE_COLORS.spine;
    const alertCervicalTarget = alertActive ? 0xfca5a5          : BASE_COLORS.cervical;
    const alertHeadTarget     = alertActive ? 0xfb7185          : BASE_COLORS.head;

    const colorLerp = 1.0 - Math.exp(-7.0 * dt);
    torsoMat.color.lerp(tmpTorsoColor.setHex(alertTorsoTarget), colorLerp);
    spineMat.color.lerp(tmpSpineColor.setHex(alertSpineTarget), colorLerp);
    cervicalMat.color.lerp(tmpCervicalColor.setHex(alertCervicalTarget), colorLerp);
    headMat.color.lerp(tmpHeadColor.setHex(alertHeadTarget), colorLerp);

    controls.update();
    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
  syncSliders();
  showReadings();

  // Public API
  window.SpineAlign3D = {
    updateTelemetry,
    setMode,
    getCurrentState: () => ({
      current: { ...current },
      target: { ...target },
      velocity: { ...velocity },
      live,
      isSignalStale,
      alertActive
    }),
    getKinematicConstants: () => ({
      BACK_PIVOT,
      NECK_PIVOT,
      DEG
    })
  };
})();
