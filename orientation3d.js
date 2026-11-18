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
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const gaussian = (x, mu, sigma) => {
    const d = (x - mu) / sigma;
    return Math.exp(-0.5 * d * d);
  };
  const DEG = Math.PI / 180;

  // Anatomical pivot heights in upper-body model space (pelvis base y = 0.0 -> crown y = 1.85)
  const BACK_PIVOT = 0.22; // L4-L5 lumbar flexion origin
  const NECK_PIVOT = 1.06; // C7-T1 cervical-thoracic junction

  const prefersReducedMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // =========================================================================
  // Scene, Camera & Renderer
  // =========================================================================
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x09101d, 0.042);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  const targetLookAt = new THREE.Vector3(0, 0.90, 0);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
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
  renderer.setClearColor(0x09101d, 1.0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  // Soft studio rim lighting for internal vertebrae & sculptural depth
  const ambientLight = new THREE.AmbientLight(0x8ba7c7, 0.55);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.15);
  keyLight.position.set(2.4, 3.2, 3.0);
  scene.add(keyLight);

  const rimCyanLight = new THREE.PointLight(0x22d3ee, 2.2, 7.0);
  rimCyanLight.position.set(-1.9, 1.1, -1.6);
  scene.add(rimCyanLight);

  const rimAmberLight = new THREE.PointLight(0xfbbf24, 2.0, 6.5);
  rimAmberLight.position.set(1.7, 2.1, -1.3);
  scene.add(rimAmberLight);

  // =========================================================================
  // Smooth Orbit Controls with Camera Presets
  // =========================================================================
  const CAMERA_PRESETS = {
    threeQuarter: { theta: 0.44, phi: Math.PI / 2 - 0.06, radius: 3.65 },
    front:        { theta: 0.0,  phi: Math.PI / 2 - 0.04, radius: 3.65 },
    side:         { theta: Math.PI / 2, phi: Math.PI / 2 - 0.04, radius: 3.65 },
    back:         { theta: Math.PI,     phi: Math.PI / 2 - 0.05, radius: 3.65 }
  };

  function setupOrbitControls(domElement, cam, lookTarget) {
    let isDragging = false;
    let prevX = 0, prevY = 0;
    let theta = CAMERA_PRESETS.threeQuarter.theta;
    let phi = CAMERA_PRESETS.threeQuarter.phi;
    let radius = CAMERA_PRESETS.threeQuarter.radius;
    let targetTheta = theta;
    let targetPhi = phi;
    let targetRadius = radius;

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
      targetTheta -= dx * 0.0072;
      targetPhi -= dy * 0.0068;
      targetPhi = clamp(targetPhi, 0.35, Math.PI - 0.35);
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
      targetRadius += e.deltaY * 0.003;
      targetRadius = clamp(targetRadius, 2.0, 5.4);
    }, { passive: false });

    function setPreset(name) {
      const preset = CAMERA_PRESETS[name];
      if (!preset) return;
      // Shortest angular path around azimuth
      const diff = Math.atan2(Math.sin(preset.theta - theta), Math.cos(preset.theta - theta));
      targetTheta = theta + diff;
      targetPhi = preset.phi;
      targetRadius = preset.radius;
    }

    return {
      setPreset,
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

  // Wire optional view preset buttons if present in DOM
  document.querySelectorAll('[data-camera-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-camera-preset');
      controls.setPreset(preset);
      document.querySelectorAll('[data-camera-preset]').forEach((other) => {
        const active = other === btn;
        other.classList.toggle('active', active);
        other.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
  });

  // =========================================================================
  // Harmonious Dual-Color Palette (Cyan/Teal Back + Amber/Gold Neck + Alert)
  // =========================================================================
  const BASE_COLORS = {
    lower:    0x334155, // Grounded slate navy
    torso:    0x06b6d4, // Electric cyan ribcage & upper torso
    spine:    0x5eead4, // High-luminosity thoracic/lumbar spine
    cervical: 0xfcd34d, // Radiant golden cervical spine
    neck:     0xfb923c, // Warm amber neck transition
    head:     0xf59e0b, // Amber/gold cranium
    alert:    0xf43f5e  // Warning crimson
  };

  // =========================================================================
  // Exact 1:1 Kinematic Reference Groups (Torso & Head)
  // Used as exact source-of-truth orientations for smooth segmented slerp
  // =========================================================================
  const root = new THREE.Group();
  scene.add(root);

  const torso = new THREE.Group();
  torso.rotation.order = 'YXZ';
  torso.position.y = BACK_PIVOT;
  root.add(torso);

  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.y = NECK_PIVOT - BACK_PIVOT;
  torso.add(head);

  // =========================================================================
  // Anatomical S-Curve Centerline & Piecewise Profile Helpers
  // =========================================================================
  function sampleCurve(points, y) {
    if (y <= points[0][0]) return points[0][1];
    const last = points.length - 1;
    if (y >= points[last][0]) return points[last][1];
    for (let i = 0; i < last; i++) {
      const [y0, v0] = points[i];
      const [y1, v1] = points[i + 1];
      if (y >= y0 && y <= y1) {
        const t = smoothstep(y0, y1, y);
        return lerp(v0, v1, t);
      }
    }
    return points[last][1];
  }

  // Natural anatomical sagittal S-curve (lumbar lordosis -> thoracic kyphosis -> cervical lordosis)
  const SPINE_Z_CTRL = [
    [0.00, -0.024],
    [0.16, -0.014],
    [0.34,  0.008],
    [0.58, -0.016],
    [0.80, -0.036],
    [1.00, -0.022],
    [1.12, -0.008],
    [1.26,  0.012],
    [1.40,  0.008]
  ];

  const TORSO_RX_CTRL = [
    [0.00, 0.214],
    [0.12, 0.218],
    [0.24, 0.194],
    [0.36, 0.180],
    [0.52, 0.205],
    [0.68, 0.238],
    [0.82, 0.264],
    [0.92, 0.282],
    [0.99, 0.232],
    [1.05, 0.148],
    [1.13, 0.088],
    [1.25, 0.072],
    [1.38, 0.074],
    [1.43, 0.076]
  ];

  const TORSO_RZ_CTRL = [
    [0.00, 0.132],
    [0.14, 0.134],
    [0.34, 0.120],
    [0.54, 0.136],
    [0.74, 0.150],
    [0.88, 0.142],
    [0.98, 0.114],
    [1.06, 0.092],
    [1.15, 0.080],
    [1.28, 0.075],
    [1.43, 0.078]
  ];

  function getSpineCenterZ(y) {
    return sampleCurve(SPINE_Z_CTRL, y);
  }

  // =========================================================================
  // 7-Bone Hierarchical Spinal Skeleton (Smooth Segmented Bending)
  // =========================================================================
  const BONE_DEF = [
    { name: 'pelvis',    y: 0.00, z: getSpineCenterZ(0.00), backT: 0.00, neckT: 0.00 },
    { name: 'lumbar1',   y: 0.22, z: getSpineCenterZ(0.22), backT: 0.26, neckT: 0.00 },
    { name: 'lumbar2',   y: 0.48, z: getSpineCenterZ(0.48), backT: 0.62, neckT: 0.00 },
    { name: 'thoracic',  y: 0.78, z: getSpineCenterZ(0.78), backT: 1.00, neckT: 0.00 },
    { name: 'cervical1', y: 1.06, z: getSpineCenterZ(1.06), backT: 1.00, neckT: 0.36 },
    { name: 'cervical2', y: 1.22, z: getSpineCenterZ(1.22), backT: 1.00, neckT: 0.74 },
    { name: 'headBone',  y: 1.38, z: getSpineCenterZ(1.38), backT: 1.00, neckT: 1.00 }
  ];

  const bones = [];
  for (let i = 0; i < BONE_DEF.length; i++) {
    const bone = new THREE.Bone();
    bone.name = BONE_DEF[i].name;
    if (i === 0) {
      bone.position.set(0, BONE_DEF[i].y, BONE_DEF[i].z);
      root.add(bone);
    } else {
      bone.position.set(
        0,
        BONE_DEF[i].y - BONE_DEF[i - 1].y,
        BONE_DEF[i].z - BONE_DEF[i - 1].z
      );
      bones[i - 1].add(bone);
    }
    bones.push(bone);
  }
  // Compute rest-pose world matrices BEFORE constructing Skeleton so boneInverses match rest geometry!
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  // Smooth C1 skinning weight computation along height y across the 7 spinal bones
  function computeSpineSkinWeights(y, forceHead = false) {
    if (forceHead && y >= 1.41) {
      return { idx: [6, 5, 0, 0], w: [1, 0, 0, 0] };
    }
    const raw = new Array(BONE_DEF.length).fill(0);
    // Overlapping Gaussian kernels centered at each bone height produce silky crease-free bending
    const sigmas = [0.16, 0.17, 0.19, 0.21, 0.13, 0.11, 0.14];
    for (let i = 0; i < BONE_DEF.length; i++) {
      let g = gaussian(y, BONE_DEF[i].y, sigmas[i]);
      if (i === 0 && y < BONE_DEF[0].y) g = 1.0;
      if (i === BONE_DEF.length - 1 && y > BONE_DEF[i].y) g = 1.0;
      raw[i] = g;
    }
    // Pick top 4 weights and normalize
    const pairs = raw.map((w, idx) => ({ idx, w })).sort((a, b) => b.w - a.w).slice(0, 4);
    const sum = pairs.reduce((acc, p) => acc + p.w, 0) || 1;
    return {
      idx: [pairs[0].idx, pairs[1].idx, pairs[2].idx, pairs[3].idx],
      w: [pairs[0].w / sum, pairs[1].w / sum, pairs[2].w / sum, pairs[3].w / sum]
    };
  }

  // =========================================================================
  // Procedural Sculpted Human Geometry Builders
  // =========================================================================
  function buildSculptedTorsoNeckGeometry() {
    const vSegs = 76;
    const uSegs = 64;
    const yMin = 0.00;
    const yMax = 1.42;

    const positions = [];
    const uvs = [];
    const regions = [];
    const fades = [];
    const skinIndices = [];
    const skinWeights = [];
    const indices = [];

    for (let iv = 0; iv <= vSegs; iv++) {
      const v = iv / vSegs;
      const y = lerp(yMin, yMax, v);
      const baseRx = sampleCurve(TORSO_RX_CTRL, y);
      const baseRz = sampleCurve(TORSO_RZ_CTRL, y);
      const centerZ = getSpineCenterZ(y);

      // Superellipse squaring factor: natural broad chest/back vs rounded neck
      const torsoMask = smoothstep(0.08, 0.30, y) * (1.0 - smoothstep(0.96, 1.12, y));
      const superExp = 1.0 / (1.0 + 0.16 * torsoMask);

      // Smooth dual-color zone blend: 0 = cyan/teal back-torso, 1 = amber/gold neck-head
      const regionVal = smoothstep(0.98, 1.18, y);
      // Graceful lower hip dissolve so bust floats organically above pedestal
      const fadeVal = smoothstep(0.00, 0.16, y) * (1.0 - 0.15 * smoothstep(1.36, 1.42, y));

      const sw = computeSpineSkinWeights(y, false);

      for (let iu = 0; iu <= uSegs; iu++) {
        const u = iu / uSegs;
        const theta = u * Math.PI * 2;
        const s = Math.sin(theta); // X axis
        const c = Math.cos(theta); // Z axis (+1 front, -1 back)
        const absS = Math.abs(s);

        // Superellipse base shape
        const sx = Math.sign(s) * Math.pow(absS, superExp);
        const cz = Math.sign(c) * Math.pow(Math.abs(c), superExp);

        let rx = baseRx;
        let rz = baseRz;

        // 1. Pectoral contours & sternum valley (anterior chest)
        const chestBand = gaussian(y, 0.78, 0.105);
        if (c > 0) {
          const pecSwell = chestBand * Math.pow(c, 1.4) * gaussian(absS, 0.44, 0.24) * 0.022;
          const sternumGroove = chestBand * Math.pow(c, 3.0) * gaussian(absS, 0.0, 0.11) * 0.011;
          rz += pecSwell - sternumGroove;
        }

        // 2. Clavicle (collarbone) sculptural ridge
        const clavBand = gaussian(y, 0.965, 0.028);
        if (c > 0.25) {
          const clavRidge = clavBand * Math.pow(c, 1.2) * smoothstep(0.10, 0.26, absS) * (1.0 - smoothstep(0.75, 0.96, absS)) * 0.013;
          rz += clavRidge;
        }

        // 3. Suprasternal notch (hollow at base of front throat)
        if (c > 0.6) {
          const notch = gaussian(y, 1.005, 0.028) * gaussian(absS, 0.0, 0.14) * Math.pow(c, 2.0) * 0.012;
          rz -= notch;
        }

        // 4. Dorsal spinal furrow & paraspinal erector muscles (posterior back)
        if (c < -0.15) {
          const backFactor = Math.pow(-c, 1.5);
          const backBand = smoothstep(0.06, 0.20, y) * (1.0 - smoothstep(0.98, 1.12, y));
          const furrow = backBand * backFactor * gaussian(absS, 0.0, 0.13) * 0.018;
          const erectors = backBand * backFactor * gaussian(absS, 0.24, 0.15) * 0.010;
          // Scapulae (shoulder blades)
          const scapula = gaussian(y, 0.80, 0.11) * backFactor * gaussian(absS, 0.48, 0.20) * 0.016;
          rz += erectors + scapula - furrow;
        }

        // 5. Lower abdomen & subtle gluteal relief near pelvis
        const hipBand = gaussian(y, 0.10, 0.11);
        if (c < 0) {
          rz += hipBand * Math.pow(-c, 1.6) * gaussian(absS, 0.34, 0.28) * 0.015;
        } else {
          rz += gaussian(y, 0.30, 0.14) * Math.pow(c, 1.8) * 0.008;
        }

        // 6. Neck sternocleidomastoid (SCM) diagonal contours
        const neckBand = smoothstep(1.06, 1.16, y) * (1.0 - smoothstep(1.32, 1.40, y));
        if (neckBand > 0.01 && c > 0.1) {
          const tNeck = clamp((y - 1.06) / 0.32, 0, 1);
          const scmTargetSide = lerp(0.18, 0.62, tNeck);
          const scm = neckBand * gaussian(absS, scmTargetSide, 0.15) * Math.pow(c, 0.8) * 0.0065;
          rz += scm;
        }

        // 7. Gentle trapezius ridge fullness at upper back-sides
        const trapBand = gaussian(y, 1.02, 0.065);
        if (c < 0.2) {
          rx += trapBand * Math.pow(absS, 1.3) * 0.012;
        }

        const x = sx * rx;
        const z = centerZ + cz * rz;

        positions.push(x, y, z);
        uvs.push(u, v);
        regions.push(regionVal);
        fades.push(fadeVal);
        skinIndices.push(sw.idx[0], sw.idx[1], sw.idx[2], sw.idx[3]);
        skinWeights.push(sw.w[0], sw.w[1], sw.w[2], sw.w[3]);
      }
    }

    const row = uSegs + 1;
    for (let iv = 0; iv < vSegs; iv++) {
      for (let iu = 0; iu < uSegs; iu++) {
        const a = iv * row + iu;
        const b = a + 1;
        const c = (iv + 1) * row + iu;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('aRegion', new THREE.Float32BufferAttribute(regions, 1));
    geom.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  function buildSculptedArmGeometry(sideSign) {
    // Sculpted deltoid cap + upper arm emerging smoothly from the shoulder girdle and dissolving near mid-arm
    const vSegs = 40;
    const uSegs = 32;
    const positions = [];
    const uvs = [];
    const regions = [];
    const fades = [];
    const skinIndices = [];
    const skinWeights = [];
    const indices = [];

    for (let iv = 0; iv <= vSegs; iv++) {
      const v = iv / vSegs; // 0 = lower bicep dissolve, 1 = seamless acromion top cap
      const y = lerp(0.42, 0.995, v);

      // Centerline curves smoothly out from inside the shoulder girdle (at top) over deltoid cap then downward
      const topBlend = smoothstep(0.72, 1.0, v);
      const cx = sideSign * (lerp(0.285, 0.305, Math.sin(v * Math.PI * 0.8)) - 0.115 * Math.pow(topBlend, 1.5));
      const cz = getSpineCenterZ(clamp(y, 0.42, 0.98)) - 0.010 + 0.015 * (1.0 - v);

      // Radius profile: smooth deltoid fullness tapering cleanly down into bicep/tricep
      let rLat = 0.068 + 0.034 * gaussian(v, 0.78, 0.24) + 0.006 * gaussian(v, 0.32, 0.22);
      let rAnt = 0.072 + 0.036 * gaussian(v, 0.78, 0.24) + 0.008 * gaussian(v, 0.35, 0.22);
      const topClose = Math.sqrt(Math.max(0.0005, 1.0 - Math.pow(smoothstep(0.84, 1.0, v), 2.0)));
      rLat *= topClose;
      rAnt *= topClose;

      const armBottomFade = smoothstep(0.00, 0.28, v);
      const regionVal = smoothstep(0.90, 1.0, v) * 0.20;

      // Weight smoothly with upper torso so shoulders & arms bend organically with the ribcage
      const thoracicW = lerp(0.84, 1.0, smoothstep(0.0, 0.60, v));
      const lumbarW = 1.0 - thoracicW;

      for (let iu = 0; iu <= uSegs; iu++) {
        const u = iu / uSegs;
        const theta = u * Math.PI * 2;
        const s = Math.sin(theta);
        const c = Math.cos(theta);

        const x = cx + s * rLat;
        const z = cz + c * rAnt;

        // Softly feather inner-facing overlap inside the ribcage so shoulder blends like continuous glass
        const facingInward = smoothstep(-0.15, -0.75, sideSign * s);
        const innerFade = 1.0 - 0.72 * facingInward * smoothstep(0.45, 0.88, v);
        const finalFade = armBottomFade * innerFade;

        positions.push(x, y, z);
        uvs.push(u, v);
        regions.push(regionVal);
        fades.push(finalFade);
        skinIndices.push(3, 2, 0, 0);
        skinWeights.push(thoracicW, lumbarW, 0, 0);
      }
    }

    const row = uSegs + 1;
    for (let iv = 0; iv < vSegs; iv++) {
      for (let iu = 0; iu < uSegs; iu++) {
        const a = iv * row + iu;
        const b = a + 1;
        const c = (iv + 1) * row + iu;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('aRegion', new THREE.Float32BufferAttribute(regions, 1));
    geom.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  function buildSculptedHeadGeometry() {
    // Anatomically sculpted human cranium, brow, orbital hollows, nose bridge, cheekbones, jaw, chin & ears
    const latSegs = 56;
    const lonSegs = 64;
    const headCenterY = 1.565;
    const headCenterZ = 0.018;

    const positions = [];
    const uvs = [];
    const regions = [];
    const fades = [];
    const skinIndices = [];
    const skinWeights = [];
    const indices = [];

    for (let iv = 0; iv <= latSegs; iv++) {
      // v = 0 (bottom / jaw underside) -> v = 1 (crown top) so outward winding matches torso
      const v = iv / latSegs;
      const phi = (1.0 - v) * Math.PI; // PI at bottom pole, 0 at top crown
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      for (let iu = 0; iu <= lonSegs; iu++) {
        const u = iu / lonSegs;
        const theta = u * Math.PI * 2;
        const s = Math.sin(theta); // X
        const c = Math.cos(theta); // Z (+1 face front, -1 occiput back)
        const absS = Math.abs(s);

        // Base cranial egg dimensions
        let rx = 0.118;
        let ry = 0.162;
        let rz = 0.142;

        // Narrower jaw & tapered lower face (below cheekbones)
        const lowerFace = smoothstep(0.52 * Math.PI, 0.90 * Math.PI, phi);
        rx *= (1.0 - 0.34 * lowerFace * (c > -0.1 ? 1.0 : 0.65));
        rz *= (1.0 - 0.16 * smoothstep(0.68 * Math.PI, 0.98 * Math.PI, phi));

        // Subtle temple narrowing
        const templeMask = gaussian(phi, 0.42 * Math.PI, 0.14) * gaussian(absS, 0.85, 0.25) * smoothstep(-0.1, 0.4, c);
        rx -= templeMask * 0.008;

        let x = sinP * s * rx;
        let y = headCenterY + cosP * ry;
        let z = headCenterZ + sinP * c * rz;

        // 1. Occipital dome fullness (back of skull)
        if (c < 0) {
          const occiput = gaussian(phi, 0.42 * Math.PI, 0.26) * Math.pow(-c, 1.3) * 0.022;
          z -= occiput;
          // Nape tuck where skull meets posterior neck
          const napeTuck = smoothstep(0.66 * Math.PI, 0.88 * Math.PI, phi) * Math.pow(-c, 1.2) * 0.036;
          z += napeTuck;
        }

        // 2. Forehead slope & brow ridge
        if (c > 0.2) {
          const front = Math.pow(c, 1.4);
          const brow = gaussian(phi, 0.43 * Math.PI, 0.055) * front * (1.0 - 0.4 * absS) * 0.011;
          z += brow;

          // Subtle orbital eye hollows
          const eyeSocket = gaussian(phi, 0.50 * Math.PI, 0.048) * gaussian(absS, 0.30, 0.14) * Math.pow(c, 1.8) * 0.013;
          z -= eyeSocket;

          // Sculpted classical nose bridge & tip
          const noseBridge = gaussian(phi, 0.555 * Math.PI, 0.075) * gaussian(absS, 0.0, 0.10) * Math.pow(c, 3.0) * 0.029;
          const noseTip = gaussian(phi, 0.605 * Math.PI, 0.032) * gaussian(absS, 0.0, 0.085) * Math.pow(c, 3.5) * 0.017;
          z += noseBridge + noseTip;

          // Zygomatic cheekbones
          const cheek = gaussian(phi, 0.57 * Math.PI, 0.085) * gaussian(absS, 0.52, 0.20) * front * 0.010;
          x += Math.sign(s) * cheek * 0.7;
          z += cheek * 0.6;

          // Sculptural mouth / lips fullness
          const lips = gaussian(phi, 0.695 * Math.PI, 0.038) * gaussian(absS, 0.0, 0.18) * Math.pow(c, 2.5) * 0.011;
          z += lips;

          // Defined chin & jawline
          const chin = gaussian(phi, 0.805 * Math.PI, 0.065) * gaussian(absS, 0.0, 0.22) * Math.pow(c, 1.8) * 0.024;
          z += chin;
          y -= gaussian(phi, 0.82 * Math.PI, 0.08) * Math.pow(c, 1.6) * 0.012;
        }

        // 3. Sculpted jaw angle (gonion)
        const jawAngle = gaussian(phi, 0.72 * Math.PI, 0.08) * gaussian(absS, 0.86, 0.16) * gaussian(c, -0.05, 0.35);
        x += Math.sign(s) * jawAngle * 0.009;

        // 4. Refined ear silhouettes on lateral sides
        const earBand = gaussian(phi, 0.565 * Math.PI, 0.065) * smoothstep(0.86, 0.98, absS) * gaussian(c, -0.14, 0.18);
        x += Math.sign(s) * earBand * 0.016;

        // Neck-underside fade so head merges cleanly into top of neck with zero seam artifact
        const underNeckFade = 1.0 - 0.65 * smoothstep(0.88 * Math.PI, 0.99 * Math.PI, phi);

        // Skinning: 100% headBone (index 6) across cranium/face, gentle blend to cervical2 at very bottom pole
        const headW = smoothstep(0.95 * Math.PI, 0.82 * Math.PI, phi);
        const cervW = 1.0 - headW;

        positions.push(x, y, z);
        uvs.push(u, v);
        regions.push(1.0);
        fades.push(underNeckFade);
        skinIndices.push(6, 5, 0, 0);
        skinWeights.push(headW, cervW, 0, 0);
      }
    }

    const row = lonSegs + 1;
    for (let iv = 0; iv < latSegs; iv++) {
      for (let iu = 0; iu < lonSegs; iu++) {
        const a = iv * row + iu;
        const b = a + 1;
        const c = (iv + 1) * row + iu;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('aRegion', new THREE.Float32BufferAttribute(regions, 1));
    geom.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  // =========================================================================
  // Custom Translucent Holographic Glass + Flowing Contour Shader Material
  // Supports Three.js Hardware Skinning natively via shader chunks!
  // =========================================================================
  const shellUniforms = {
    uTime:       { value: 0.0 },
    uBreath:     { value: 0.0 },
    uMotionScale:{ value: prefersReducedMotion ? 0.18 : 1.0 },
    uTorsoColor: { value: new THREE.Color(BASE_COLORS.torso) },
    uSpineGlow:  { value: new THREE.Color(BASE_COLORS.spine) },
    uNeckColor:  { value: new THREE.Color(BASE_COLORS.neck) },
    uHeadColor:  { value: new THREE.Color(BASE_COLORS.head) },
    uAlertMix:   { value: 0.0 }
  };

  const humanShellMaterial = new THREE.ShaderMaterial({
    uniforms: shellUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>

      attribute float aRegion;
      attribute float aFade;

      uniform float uBreath;

      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec3 vRestPos;
      varying float vRegion;
      varying float vFade;

      void main() {
        vRegion = aRegion;
        vFade = aFade;
        vRestPos = position;

        // Subtle anatomical thoracic breathing expansion (ribcage zone only)
        vec3 transformed = position;
        float ribMask = smoothstep(0.32, 0.62, position.y) * (1.0 - smoothstep(0.92, 1.08, position.y));
        transformed.x *= 1.0 + uBreath * 0.014 * ribMask;
        transformed.z += uBreath * 0.008 * ribMask * smoothstep(-0.05, 0.12, position.z);

        vec3 objectNormal = normal;

        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalView = normalize(normalMatrix * objectNormal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uMotionScale;
      uniform vec3 uTorsoColor;
      uniform vec3 uSpineGlow;
      uniform vec3 uNeckColor;
      uniform vec3 uHeadColor;
      uniform float uAlertMix;

      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying vec3 vRestPos;
      varying float vRegion;
      varying float vFade;

      void main() {
        vec3 N = normalize(vNormalView);
        vec3 V = normalize(vViewPos);
        float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

        // Rich silky Fresnel rim glow + subtle studio specular sheen
        float fresnel = pow(1.0 - ndotv, 2.35);
        float rimSharp = pow(1.0 - ndotv, 4.5);

        vec3 L1 = normalize(vec3(0.55, 0.75, 0.65));
        vec3 H1 = normalize(L1 + V);
        float spec = pow(clamp(dot(N, H1), 0.0, 1.0), 26.0) * 0.35;
        float diffuse = clamp(dot(N, L1) * 0.5 + 0.5, 0.0, 1.0);

        // Seamless dual-color gradient: Electric Cyan/Teal torso -> Warm Amber/Gold neck & head
        vec3 torsoTone = mix(uTorsoColor, uSpineGlow, 0.28 + 0.35 * fresnel);
        vec3 headTone  = mix(uNeckColor, uHeadColor, smoothstep(1.12, 1.48, vRestPos.y));
        headTone = mix(headTone, vec3(1.0, 0.90, 0.58), 0.22 * fresnel);
        vec3 baseCol = mix(torsoTone, headTone, smoothstep(0.0, 1.0, vRegion));

        // Flowing upward biometric contour waves (organic topographic ribbons)
        float flowT = uTime * 0.55 * uMotionScale;
        float waveCoord = vRestPos.y * 26.0 - flowT * 2.2 + sin(vRestPos.x * 7.5 + vRestPos.z * 5.0) * 0.55;
        float contourLine = smoothstep(0.84, 0.985, sin(waveCoord) * 0.5 + 0.5);

        // Delicate longitudinal meridian streams along human form
        float angle = atan(vRestPos.x, vRestPos.z);
        float meridian = smoothstep(0.92, 0.995, cos(angle * 12.0 + sin(vRestPos.y * 4.5 - flowT) * 0.35) * 0.5 + 0.5);

        // Flowing ascending energy shimmer pulse
        float pulsePos = fract(uTime * 0.16 * uMotionScale);
        float pulseBand = exp(-pow((vRestPos.y / 1.85 - pulsePos) * 7.5, 2.0));

        // Subtle anatomical dorsal highlight near spine furrow
        float backGlow = smoothstep(-0.04, -0.14, vRestPos.z) * exp(-pow(vRestPos.x * 9.5, 2.0)) * 0.22;

        // Combine sculpted glass body + glowing rim + flowing lines
        vec3 bodyFill = baseCol * (0.14 + 0.22 * diffuse);
        vec3 rimLight = mix(baseCol, vec3(1.0), 0.26) * (fresnel * 1.15 + rimSharp * 0.72);
        vec3 lineLight = mix(baseCol, vec3(1.0), 0.45) * (contourLine * 0.28 + meridian * 0.12 + pulseBand * 0.26);
        vec3 specLight = mix(baseCol, vec3(1.0), 0.65) * spec;

        // Gentle alert pulse accent
        float alertPulse = uAlertMix * (0.12 + 0.10 * sin(uTime * 5.0 * uMotionScale));
        vec3 finalColor = bodyFill + rimLight + lineLight + specLight + baseCol * (backGlow + alertPulse);

        // Translucent interior so glowing articulated spine shines through cleanly!
        float alpha = (0.13 + fresnel * 0.66 + contourLine * 0.15 + meridian * 0.06 + pulseBand * 0.12 + spec * 0.22);
        alpha = clamp(alpha, 0.0, 0.92) * vFade;

        if (alpha < 0.01) discard;
        gl_FragColor = vec4(finalColor, alpha);
      }
    `
  });

  // Assemble SkinnedMeshes sharing the 7-bone spinal skeleton
  const torsoMesh = new THREE.SkinnedMesh(buildSculptedTorsoNeckGeometry(), humanShellMaterial);
  torsoMesh.bind(skeleton);
  torsoMesh.frustumCulled = false;
  torsoMesh.renderOrder = 4;
  root.add(torsoMesh);

  const leftArmMesh = new THREE.SkinnedMesh(buildSculptedArmGeometry(1), humanShellMaterial);
  leftArmMesh.bind(skeleton);
  leftArmMesh.frustumCulled = false;
  leftArmMesh.renderOrder = 4;
  root.add(leftArmMesh);

  const rightArmMesh = new THREE.SkinnedMesh(buildSculptedArmGeometry(-1), humanShellMaterial);
  rightArmMesh.bind(skeleton);
  rightArmMesh.frustumCulled = false;
  rightArmMesh.renderOrder = 4;
  root.add(rightArmMesh);

  const headMesh = new THREE.SkinnedMesh(buildSculptedHeadGeometry(), humanShellMaterial);
  headMesh.bind(skeleton);
  headMesh.frustumCulled = false;
  headMesh.renderOrder = 4;
  root.add(headMesh);

  // =========================================================================
  // Internal Articulated Glowing Spine (16 Vertebrae + Continuous Energy Cord)
  // =========================================================================
  const spineGroup = new THREE.Group();
  root.add(spineGroup);

  const lumbarSpineMat = new THREE.MeshStandardMaterial({
    color: BASE_COLORS.spine,
    emissive: BASE_COLORS.spine,
    emissiveIntensity: 1.05,
    roughness: 0.22,
    metalness: 0.15,
    transparent: true,
    opacity: 0.95
  });

  const cervicalSpineMat = new THREE.MeshStandardMaterial({
    color: BASE_COLORS.cervical,
    emissive: BASE_COLORS.cervical,
    emissiveIntensity: 1.12,
    roughness: 0.22,
    metalness: 0.15,
    transparent: true,
    opacity: 0.96
  });

  const discGeom = new THREE.CylinderGeometry(0.025, 0.028, 0.022, 16);
  const processGeom = new THREE.ConeGeometry(0.011, 0.044, 8);
  processGeom.rotateX(-Math.PI / 2);
  processGeom.translate(0, -0.004, -0.034);

  const transverseGeom = new THREE.CapsuleGeometry(0.0055, 0.056, 4, 8);
  transverseGeom.rotateZ(Math.PI / 2);
  transverseGeom.translate(0, 0, -0.012);

  const VERTEBRA_COUNT = 16; // L5..L1 + T12..T1 (11) + C7..C1 (5)
  const vertebrae = [];

  for (let i = 0; i < VERTEBRA_COUNT; i++) {
    const t = i / (VERTEBRA_COUNT - 1);
    const y = lerp(0.14, 1.37, t);
    const isCervical = y >= NECK_PIVOT - 0.02;
    const mat = isCervical ? cervicalSpineMat : lumbarSpineMat;

    const vGroup = new THREE.Group();
    const scale = isCervical
      ? lerp(0.76, 0.62, clamp((y - NECK_PIVOT) / 0.34, 0, 1))
      : lerp(1.06, 0.82, clamp((y - 0.14) / (NECK_PIVOT - 0.14), 0, 1));

    const body = new THREE.Mesh(discGeom, mat);
    body.scale.set(scale, scale, scale * 0.9);
    vGroup.add(body);

    const spinous = new THREE.Mesh(processGeom, mat);
    spinous.scale.setScalar(scale);
    vGroup.add(spinous);

    const trans = new THREE.Mesh(transverseGeom, mat);
    trans.scale.setScalar(scale);
    vGroup.add(trans);

    vGroup.renderOrder = 2;
    spineGroup.add(vGroup);

    // Find enclosing bone segment for exact live spline placement
    let segIdx = 0;
    for (let b = 0; b < BONE_DEF.length - 1; b++) {
      if (y >= BONE_DEF[b].y) segIdx = b;
    }
    const y0 = BONE_DEF[segIdx].y;
    const y1 = BONE_DEF[Math.min(segIdx + 1, BONE_DEF.length - 1)].y;
    const localT = y1 > y0 ? clamp((y - y0) / (y1 - y0), 0, 1) : 0;

    vertebrae.push({
      group: vGroup,
      restY: y,
      isCervical,
      segIdx,
      localT,
      // Posterior dorsal offset relative to bone centerline
      dorsalZ: isCervical ? -0.022 : -0.056
    });
  }

  // Continuous Glowing Spinal Cord Ribbon (updated smoothly each frame)
  const CORD_SEGMENTS = 48;
  const cordPositions = new Float32Array((CORD_SEGMENTS + 1) * 3);
  const cordColors = new Float32Array((CORD_SEGMENTS + 1) * 3);
  const cordGeom = new THREE.BufferGeometry();
  cordGeom.setAttribute('position', new THREE.BufferAttribute(cordPositions, 3));
  cordGeom.setAttribute('color', new THREE.BufferAttribute(cordColors, 3));

  const cordMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending
  });
  const spinalCordLine = new THREE.Line(cordGeom, cordMat);
  spinalCordLine.frustumCulled = false;
  spinalCordLine.renderOrder = 3;
  spineGroup.add(spinalCordLine);

  // Glowing Dorsal IMU Sensor Beacons (anchored directly to Back & Neck bones)
  function createSensorBeacon(colorHex) {
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 16), coreMat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.036, 32), ringMat);
    const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.044, 0.049, 32), ringMat);
    group.add(core, ring, outerRing);
    group.renderOrder = 5;
    return { group, coreMat, ringMat, outerRing };
  }

  const backSensorBeacon = createSensorBeacon(BASE_COLORS.spine);
  backSensorBeacon.group.position.set(0, 0.06, -0.155); // T3-T4 dorsal surface
  bones[3].add(backSensorBeacon.group);

  const neckSensorBeacon = createSensorBeacon(BASE_COLORS.cervical);
  neckSensorBeacon.group.position.set(0, 0.04, -0.095); // C6-C7 posterior neck surface
  bones[4].add(neckSensorBeacon.group);

  // =========================================================================
  // Flowing Ambient Bioluminescent Energy Micro-Particles along Silhouette
  // =========================================================================
  function createParticleTexture() {
    const texCanvas = document.createElement('canvas');
    texCanvas.width = texCanvas.height = 64;
    const ctx = texCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(texCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const particleTex = createParticleTexture();
  const FLOW_PARTICLE_COUNT = 120;
  const flowSeeds = [];
  const flowPosArray = new Float32Array(FLOW_PARTICLE_COUNT * 3);
  const flowColArray = new Float32Array(FLOW_PARTICLE_COUNT * 3);

  let rngSeed = 1337;
  const rand = () => {
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
  };

  for (let i = 0; i < FLOW_PARTICLE_COUNT; i++) {
    flowSeeds.push({
      phase: rand(),
      speed: 0.07 + rand() * 0.08,
      angle: rand() * Math.PI * 2,
      radialPad: 0.035 + rand() * 0.14,
      swirl: (rand() - 0.5) * 0.8
    });
  }

  const flowGeom = new THREE.BufferGeometry();
  flowGeom.setAttribute('position', new THREE.BufferAttribute(flowPosArray, 3));
  flowGeom.setAttribute('color', new THREE.BufferAttribute(flowColArray, 3));
  const flowMat = new THREE.PointsMaterial({
    size: 0.036,
    map: particleTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const flowParticles = new THREE.Points(flowGeom, flowMat);
  flowParticles.frustumCulled = false;
  flowParticles.renderOrder = 3;
  root.add(flowParticles);

  // =========================================================================
  // Holographic Posture Base Platform & Neutral Plumb Reference Axis
  // =========================================================================
  const baseGroup = new THREE.Group();
  baseGroup.position.y = -0.02;
  root.add(baseGroup);

  const ringInner = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.372, 72),
    new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  ringInner.rotation.x = -Math.PI / 2;
  baseGroup.add(ringInner);

  const ringOuter = new THREE.Mesh(
    new THREE.RingGeometry(0.56, 0.568, 96),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.20,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  ringOuter.rotation.x = -Math.PI / 2;
  baseGroup.add(ringOuter);

  // Subtle compass tick marks & forward chevron on base platform
  const tickPts = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const major = i % 9 === 0;
    const r0 = major ? 0.50 : 0.535;
    const r1 = 0.565;
    tickPts.push(
      Math.sin(a) * r0, 0.002, Math.cos(a) * r0,
      Math.sin(a) * r1, 0.002, Math.cos(a) * r1
    );
  }
  // Forward-facing directional chevron (+Z)
  tickPts.push(
    -0.055, 0.003, 0.61, 0.0, 0.003, 0.67,
     0.055, 0.003, 0.61, 0.0, 0.003, 0.67
  );
  const ticksGeom = new THREE.BufferGeometry();
  ticksGeom.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));
  const ticksLines = new THREE.LineSegments(
    ticksGeom,
    new THREE.LineBasicMaterial({
      color: 0x5eead4,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending
    })
  );
  baseGroup.add(ticksLines);

  // Neutral ideal posture vertical reference plumb line (0 deg benchmark)
  const plumbGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.0, -0.024),
    new THREE.Vector3(0, 1.88, -0.024)
  ]);
  const plumbLine = new THREE.Line(
    plumbGeom,
    new THREE.LineDashedMaterial({
      color: 0x64748b,
      dashSize: 0.04,
      gapSize: 0.045,
      transparent: true,
      opacity: 0.28
    })
  );
  plumbLine.computeLineDistances();
  root.add(plumbLine);

  // Mark model ready
  const loaderEl = $('modelLoading');
  if (loaderEl) loaderEl.hidden = true;
  if ($('modelStatusPill')) $('modelStatusPill').classList.remove('loading');
  if ($('modelStatusText')) $('modelStatusText').textContent = '3D Posture Model Ready';

  // =========================================================================
  // State Management, Telemetry Filtering & Analytical Critically Damped Motion
  // =========================================================================
  let live = false;
  let manual = false;
  let singleSensorMode = false;
  let alertActive = false;
  let canvasWidth = 0;
  let canvasHeight = 0;

  const AXES = ['backPitch', 'backRoll', 'backTwist', 'neckPitch', 'neckRoll', 'neckTwist'];

  const target = {
    backPitch: 7.0,
    backRoll: -1.2,
    backTwist: 0.0,
    neckPitch: 4.0,
    neckRoll: 0.8,
    neckTwist: 0.0
  };

  const current = { ...target };

  const velocity = {
    backPitch: 0.0,
    backRoll: 0.0,
    backTwist: 0.0,
    neckPitch: 0.0,
    neckRoll: 0.0,
    neckTwist: 0.0
  };

  const targetVelocity = {
    backPitch: 0.0,
    backRoll: 0.0,
    backTwist: 0.0,
    neckPitch: 0.0,
    neckRoll: 0.0,
    neckTwist: 0.0
  };

  let lastPacketTime = performance.now();
  let isSignalStale = false;
  const GAP_STALE_MS = 2500;
  const MAX_STEP_DEG = 45.0;

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
    const controlsEl = $('modelDemoControls');
    if (controlsEl) {
      controlsEl.querySelectorAll('input,button').forEach(el => { el.disabled = live; });
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
        ? 'Live 3-axis tracking: Sculpted dual-zone spine curves smoothly with exact 1:1 sensor fidelity.'
        : 'Drag to orbit 360° or scroll to zoom while previewing spinal alignment and cervical rotation.';
    }
    showReadings();
  }

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

    const rawBP = sanitizeAngle(data.backPitch, target.backPitch, -65, 65);
    const rawBR = sanitizeAngle(data.backRoll, target.backRoll, -45, 45);

    const validBP = Math.abs(rawBP - current.backPitch) > MAX_STEP_DEG
      ? current.backPitch + Math.sign(rawBP - current.backPitch) * MAX_STEP_DEG
      : rawBP;
    const validBR = Math.abs(rawBR - current.backRoll) > MAX_STEP_DEG
      ? current.backRoll + Math.sign(rawBR - current.backRoll) * MAX_STEP_DEG
      : rawBR;

    let validBT;
    if (data.backTwist !== undefined && data.backTwist !== null && Number.isFinite(Number(data.backTwist))) {
      const rawBT = sanitizeAngle(data.backTwist, 0, -35, 35);
      validBT = Math.abs(rawBT - current.backTwist) > MAX_STEP_DEG
        ? current.backTwist + Math.sign(rawBT - current.backTwist) * MAX_STEP_DEG
        : rawBT;
    } else {
      validBT = clamp(-validBR * 0.35 * (1.0 + 0.3 * (Math.abs(validBP) / 30.0)), -35, 35);
    }

    let validNP, validNR, validNT;
    if (singleSensorMode) {
      validNP = -validBP * 0.30;
      validNR = -validBR * 0.25;
      validNT = -validBT * 0.40;
    } else {
      const rawNP = sanitizeAngle(data.neckPitch, target.neckPitch, -65, 65);
      const rawNR = sanitizeAngle(data.neckRoll, target.neckRoll, -45, 45);
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

      if (dtPkt >= 0.02 && dtPkt <= 0.35) {
        for (const k of AXES) {
          const rawV = clamp((nextTarget[k] - target[k]) / dtPkt, -60, 60);
          targetVelocity[k] = targetVelocity[k] * 0.72 + (rawV * 0.35) * 0.28;
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

  // =========================================================================
  // Pre-Allocated Scratch Objects (Zero GC Allocation in Render Loop)
  // =========================================================================
  const qIdentity = new THREE.Quaternion();
  const qBackWorld = new THREE.Quaternion();
  const qNeckWorld = new THREE.Quaternion();
  const qParentInv = new THREE.Quaternion();
  const boneWorldQuats = BONE_DEF.map(() => new THREE.Quaternion());
  const boneWorldPos = BONE_DEF.map(() => new THREE.Vector3());

  const tmpPosA = new THREE.Vector3();
  const tmpPosB = new THREE.Vector3();
  const tmpOffset = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpColorA = new THREE.Color();
  const tmpColorB = new THREE.Color();
  const tmpColorC = new THREE.Color();
  const tmpColorD = new THREE.Color();
  const tmpColorMix = new THREE.Color();

  const cordSamplePoints = Array.from({ length: VERTEBRA_COUNT }, () => new THREE.Vector3());
  const cordCurve = new THREE.CatmullRomCurve3(cordSamplePoints);

  // =========================================================================
  // Main 60 FPS Render Loop
  // =========================================================================
  let lastFrameTime = performance.now();
  let elapsed = 0;
  let breathPhase = 0;
  let alertBlend = 0;

  function animate(now) {
    requestAnimationFrame(animate);

    const dt = Math.min(Math.max((now - lastFrameTime) / 1000.0, 0.001), 0.08);
    lastFrameTime = now;
    elapsed += dt;

    // 1. Signal gap detection & soft decay
    if (live && (now - lastPacketTime > GAP_STALE_MS)) {
      if (!isSignalStale) {
        isSignalStale = true;
        showReadings();
      }
      if (now - lastPacketTime > 4000) {
        const drift = 0.35 * dt;
        for (const k of AXES) {
          target[k] += (0 - target[k]) * drift;
          targetVelocity[k] = 0;
        }
      }
    }

    // 2. Feed-forward velocity decay
    const timeSincePacket = (now - lastPacketTime) / 1000.0;
    if (timeSincePacket > 0.08) {
      const vDecay = Math.exp(-16.0 * dt);
      for (const k of AXES) {
        targetVelocity[k] *= vDecay;
      }
    }

    // 3. Exact Analytical 2nd-Order Critically Damped Oscillator (zeta = 1.0)
    const omega = 24.0;
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
    torso.rotation.x = current.backPitch * DEG;
    torso.rotation.z = -current.backRoll * DEG;
    torso.rotation.y = current.backTwist * DEG;

    head.rotation.x = (current.neckPitch - current.backPitch) * DEG;
    head.rotation.z = -(current.neckRoll - current.backRoll) * DEG;
    head.rotation.y = (current.neckTwist - current.backTwist) * DEG;

    // Extract exact world quaternions for Back (thoracic) & Neck (head)
    qBackWorld.setFromEuler(torso.rotation);
    tmpQuat.setFromEuler(head.rotation);
    qNeckWorld.copy(qBackWorld).multiply(tmpQuat);

    // 4. Distribute orientations smoothly along the 7-bone spinal chain via Quaternion Slerp
    // Guarantees smooth anatomical C/S-curve bending AND exact 1:1 angle at thoracic & head!
    for (let i = 0; i < BONE_DEF.length; i++) {
      const def = BONE_DEF[i];
      if (def.neckT > 0) {
        boneWorldQuats[i].copy(qBackWorld).slerp(qNeckWorld, def.neckT);
      } else {
        boneWorldQuats[i].copy(qIdentity).slerp(qBackWorld, def.backT);
      }

      if (i === 0) {
        bones[0].quaternion.copy(boneWorldQuats[0]);
      } else {
        qParentInv.copy(boneWorldQuats[i - 1]).invert();
        bones[i].quaternion.copy(qParentInv).multiply(boneWorldQuats[i]);
      }
    }

    // Update skeleton matrices so world bone positions are current
    root.updateMatrixWorld(true);
    for (let i = 0; i < bones.length; i++) {
      boneWorldPos[i].setFromMatrixPosition(bones[i].matrixWorld);
    }

    // 5. Update 16 Internal Articulated Vertebrae & Continuous Glowing Spinal Cord
    for (let i = 0; i < vertebrae.length; i++) {
      const v = vertebrae[i];
      const idxA = v.segIdx;
      const idxB = Math.min(idxA + 1, bones.length - 1);

      tmpPosA.copy(boneWorldPos[idxA]);
      tmpPosB.copy(boneWorldPos[idxB]);
      v.group.position.lerpVectors(tmpPosA, tmpPosB, v.localT);

      tmpQuat.copy(boneWorldQuats[idxA]).slerp(boneWorldQuats[idxB], v.localT);
      v.group.quaternion.copy(tmpQuat);

      // Offset slightly posteriorly along local spine frame so vertebrae nest in dorsal furrow
      tmpOffset.set(0, 0, v.dorsalZ).applyQuaternion(tmpQuat);
      v.group.position.add(tmpOffset);

      cordSamplePoints[i].copy(v.group.position);
    }

    // Smooth spinal cord spline + dual-color glowing gradient
    const colA = shellUniforms.uSpineGlow.value;
    const colB = cervicalSpineMat.color;
    const cordPosAttr = cordGeom.attributes.position;
    const cordColAttr = cordGeom.attributes.color;
    const pulseWave = (elapsed * (prefersReducedMotion ? 0.15 : 0.65)) % 1.0;

    for (let i = 0; i <= CORD_SEGMENTS; i++) {
      const t = i / CORD_SEGMENTS;
      cordCurve.getPoint(t, tmpPosA);
      cordPosAttr.setXYZ(i, tmpPosA.x, tmpPosA.y, tmpPosA.z);

      const zone = smoothstep(0.68, 0.80, t);
      tmpColorMix.copy(colA).lerp(colB, zone);
      const pulse = 1.0 + 0.55 * Math.exp(-Math.pow((t - pulseWave) * 10.0, 2.0));
      cordColAttr.setXYZ(i, tmpColorMix.r * pulse, tmpColorMix.g * pulse, tmpColorMix.b * pulse);
    }
    cordPosAttr.needsUpdate = true;
    cordColAttr.needsUpdate = true;

    // 6. Natural Thoracic Breathing & Flowing Micro-Particles
    breathPhase += dt * (prefersReducedMotion ? 0.45 : 1.45);
    const breathVal = Math.sin(breathPhase);
    shellUniforms.uTime.value = elapsed;
    shellUniforms.uBreath.value = breathVal;

    // Update flowing silhouette energy particles around the curving spine
    const fpPos = flowGeom.attributes.position;
    const fpCol = flowGeom.attributes.color;
    const motionRate = prefersReducedMotion ? 0.2 : 1.0;

    for (let i = 0; i < FLOW_PARTICLE_COUNT; i++) {
      const p = flowSeeds[i];
      const t = (p.phase + elapsed * p.speed * motionRate) % 1.0;
      const y = lerp(0.08, 1.78, t);

      // Anchor particle horizontally to the bent spinal curve at height t
      const curveT = clamp((y - 0.14) / (1.37 - 0.14), 0, 1);
      cordCurve.getPoint(curveT, tmpPosA);
      if (y > 1.37) {
        tmpOffset.set(0, y - 1.37, 0.02).applyQuaternion(qNeckWorld);
        tmpPosA.add(tmpOffset);
      }

      const ang = p.angle + elapsed * p.swirl * motionRate;
      const bodyRadius = sampleCurve(TORSO_RX_CTRL, clamp(y, 0.0, 1.42)) + p.radialPad;
      const px = tmpPosA.x + Math.sin(ang) * bodyRadius;
      const py = tmpPosA.y + (y > 1.37 ? 0 : 0);
      const pz = tmpPosA.z + Math.cos(ang) * (bodyRadius * 0.72);
      fpPos.setXYZ(i, px, py, pz);

      const zone = smoothstep(0.98, 1.18, y);
      const edgeFade = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.84, 1.0, t));
      tmpColorMix.copy(shellUniforms.uTorsoColor.value).lerp(shellUniforms.uHeadColor.value, zone);
      fpCol.setXYZ(i, tmpColorMix.r * edgeFade, tmpColorMix.g * edgeFade, tmpColorMix.b * edgeFade);
    }
    fpPos.needsUpdate = true;
    fpCol.needsUpdate = true;

    // 7. Sensor Beacon Subtle Heartbeat Pulse
    const beaconPulse = 1.0 + (live ? 0.16 : 0.07) * Math.sin(elapsed * (live ? 4.2 : 2.0));
    backSensorBeacon.outerRing.scale.setScalar(beaconPulse);
    neckSensorBeacon.outerRing.scale.setScalar(beaconPulse);

    // 8. Smooth Dual-Color & Alert Transition
    const colorLerp = 1.0 - Math.exp(-7.0 * dt);
    alertBlend += ((alertActive ? 1.0 : 0.0) - alertBlend) * colorLerp;
    shellUniforms.uAlertMix.value = alertBlend;

    const targetTorsoHex    = alertActive ? BASE_COLORS.alert : BASE_COLORS.torso;
    const targetSpineHex    = alertActive ? 0xf87171          : BASE_COLORS.spine;
    const targetCervicalHex = alertActive ? 0xfca5a5          : BASE_COLORS.cervical;
    const targetNeckHex     = alertActive ? 0xfb7185          : BASE_COLORS.neck;
    const targetHeadHex     = alertActive ? 0xfb7185          : BASE_COLORS.head;

    shellUniforms.uTorsoColor.value.lerp(tmpColorA.setHex(targetTorsoHex), colorLerp);
    shellUniforms.uSpineGlow.value.lerp(tmpColorB.setHex(targetSpineHex), colorLerp);
    shellUniforms.uNeckColor.value.lerp(tmpColorC.setHex(targetNeckHex), colorLerp);
    shellUniforms.uHeadColor.value.lerp(tmpColorD.setHex(targetHeadHex), colorLerp);

    lumbarSpineMat.color.lerp(tmpColorB.setHex(targetSpineHex), colorLerp);
    lumbarSpineMat.emissive.copy(lumbarSpineMat.color);

    cervicalSpineMat.color.lerp(tmpColorC.setHex(targetCervicalHex), colorLerp);
    cervicalSpineMat.emissive.copy(cervicalSpineMat.color);

    backSensorBeacon.coreMat.color.copy(lumbarSpineMat.color);
    backSensorBeacon.ringMat.color.copy(lumbarSpineMat.color);
    neckSensorBeacon.coreMat.color.copy(cervicalSpineMat.color);
    neckSensorBeacon.ringMat.color.copy(cervicalSpineMat.color);

    rimCyanLight.color.lerp(tmpColorA.setHex(alertActive ? BASE_COLORS.alert : 0x22d3ee), colorLerp);
    rimAmberLight.color.lerp(tmpColorD.setHex(alertActive ? 0xfb7185 : 0xfbbf24), colorLerp);

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
    setCameraPreset: (name) => controls.setPreset(name),
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
      DEG,
      BONE_COUNT: bones.length,
      VERTEBRA_COUNT
    })
  };
})();
