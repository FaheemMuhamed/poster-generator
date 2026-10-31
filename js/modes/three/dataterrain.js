// Data Terrain: an isometric data landscape (refs 17, 18). A wireframe height mesh with sharp
// peaks, a floating platform of square "data cells" that flicker in and out, clusters of thin
// coloured data poles with flat flags, ground markers, a wire scaffold tower, floating spheres and rings.
// Everything moves in the vertex shaders (one shared terrain function), under an orthographic orbit.
// Hover raises a rippling bump in the terrain and lifts nearby poles; click plants a new pole and sends a pulse.
import { createThreeStage, paletteUniform, pointerNDC, THREE } from '../../shared/threeStage.js';
import { NOISE, PALETTE_GLSL } from '../../shaders/noise.glsl.js';

const PULSES = 4;
const USER_POLES = 24;  // ring buffer of poles planted by clicks
const S = 20;           // terrain size (world units)

const params = {
  detail:   { value: 34, min: 12, max: 70, step: 1, label: 'Mesh detail', rebuild: true },
  relief:   { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Relief amount' },
  spikes:   { value: 0.7, min: 0, max: 2, step: 0.01, label: 'Spike amount', rebuild: true },
  poles:    { value: 46, min: 0, max: 140, step: 1, label: 'Pole count', rebuild: true },
  platform: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Platform density' },
  spheres:  { value: 5, min: 0, max: 16, step: 1, label: 'Sphere count', rebuild: true },
  wave:     { value: 0.6, min: 0, max: 2, step: 0.01, label: 'Wave amount' },
  spin:     { value: 0.04, min: -0.4, max: 0.4, step: 0.01, label: 'Speed' },
  tilt:     { value: 30, min: 12, max: 60, step: 1, label: 'Camera tilt', unit: '°' },
  zoom:     { value: 1, min: 0.5, max: 2, step: 0.01, label: 'Zoom', unit: '×' },
  colour:   { value: 0.85, min: 0, max: 1, step: 0.01, label: 'Colour amount' },
  background: { value: 'Dark', options: ['Dark', 'Paper'], label: 'Background' },
  lift:     { value: 1, min: 0, max: 3, step: 0.01, label: 'Lift strength' },
};

// Shared GLSL: palette helpers and the animated terrain offset (waves, cursor bump, pulses).
const COMMON = /* glsl */ `
${PALETTE_GLSL}
uniform float uTime, uRelief, uWave, uColour;
uniform vec3 uMouse;              // x, z, amount
uniform vec4 uPulse[${PULSES}];   // x, z, start time, strength
uniform vec3 uInk, uGround;       // line colour, background colour
vec3 accent(float i) {
  i = mod(floor(i + 0.5), 4.0);
  return i < 0.5 ? uPal[2] : i < 1.5 ? uPal[3] : i < 2.5 ? uPal[4] : uPal[5];
}
// Colour index: 0..3 accents, 4 = line colour; uColour fades accents back to the line colour.
vec3 idxColour(float i, float h) {
  if (i > 3.5) return uInk;
  return h < uColour ? accent(i) : uInk;
}
float dynH(vec2 p) {
  float w = uWave * 0.35 * (sin(p.x * 0.45 + uTime * 0.8) * cos(p.y * 0.38 - uTime * 0.6) + 0.5 * sin((p.x + p.y) * 0.7 - uTime * 1.1));
  float d = distance(p, uMouse.xy);
  float bump = uMouse.z * (2.4 * exp(-d * d / 5.0) + 0.35 * sin(d * 2.4 - uTime * 5.0) * exp(-d * d / 24.0));
  float ring = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    vec4 P = uPulse[i];
    float age = uTime - P.z;
    if (P.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    float r = distance(p, P.xy);
    float k = (r - age * 7.0) / 1.3;
    ring += P.w * exp(-k * k) * exp(-age * 0.7) * 1.6;
  }
  return w + bump + ring;
}
`;

// ---- Terrain wireframe ----
const terrainVert = /* glsl */ `
attribute float aH;
varying float vBump, vH;
${COMMON}
void main() {
  float dy = dynH(position.xz);
  vec3 p = vec3(position.x, aH * uRelief + dy, position.z);
  vBump = clamp(dy - uWave * 0.5, 0.0, 2.0) * 0.6;
  vH = aH;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const terrainFrag = /* glsl */ `
varying float vBump, vH;
${COMMON}
void main() {
  vec3 col = mix(uInk, uGround, 0.18);
  col = mix(col, accent(1.0), clamp(vBump, 0.0, 1.0) * uColour);
  col = mix(col, uInk, smoothstep(2.0, 4.0, vH));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Floating platform of data cells ----
const platVert = /* glsl */ `
attribute vec2 aCell;
uniform float uDensity, uPlatY, uSeed;
varying float vAcc, vIdx;
${COMMON}
${NOISE}
void main() {
  float n = snoise(vec3(aCell * 0.16 + uSeed * 10.0, uTime * 0.05)) * 0.7 + snoise(vec3(aCell * 0.5, uTime * 0.12 + 4.0)) * 0.3;
  float on = step(1.0 - uDensity, n * 0.5 + 0.5);
  float d = distance(aCell, uMouse.xy);
  float lift = uMouse.z * exp(-d * d / 6.0);
  float h1 = fract(sin(dot(aCell, vec2(12.9898, 78.233))) * 43758.5453);
  vAcc = step(0.965, h1);
  vIdx = floor(h1 * 97.0);
  vec3 p = position * on * (1.0 + 0.4 * lift);
  p += vec3(aCell.x, uPlatY + lift * 1.2, aCell.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const platFrag = /* glsl */ `
varying float vAcc, vIdx;
${COMMON}
void main() {
  gl_FragColor = vec4(vAcc > 0.5 && uColour > 0.05 ? accent(vIdx) : uInk, 1.0);
}
`;

// ---- Poles (lines) and their flags (flat instanced quads) ----
// aPole: x, z, terrain height (unscaled; <-50 means "stands on the ground"), pole height
// aInfo: colour index, colour roll, birth time, flag shape (0 none, 1 diamond, 2 disc, 3 marker)
const POLE_Y = /* glsl */ `
float poleBase(vec4 P) { return P.z < -50.0 ? 0.0 : P.z * uRelief + dynH(P.xy); }
float poleTop(vec4 P, vec4 I) {
  float age = uTime - I.z;
  float grow = I.z < -50.0 ? 1.0 : clamp(age / 0.9, 0.0, 1.0);
  grow = 1.0 - pow(1.0 - grow, 3.0) + 0.12 * sin(clamp(age, 0.0, 3.0) * 9.0) * exp(-age * 2.0);
  float d = distance(P.xy, uMouse.xy);
  float lift = 1.0 + 0.5 * uMouse.z * exp(-d * d / 10.0);
  float breathe = 1.0 + 0.05 * sin(uTime * (0.6 + I.y) + I.y * 30.0);
  return poleBase(P) + P.w * grow * lift * breathe;
}
`;
const poleVert = /* glsl */ `
attribute vec4 aPole, aInfo;
attribute float aEnd;
varying vec3 vCol;
${COMMON}
${POLE_Y}
void main() {
  float y = mix(poleBase(aPole), poleTop(aPole, aInfo), aEnd);
  vCol = idxColour(aInfo.x, aInfo.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(aPole.x, y, aPole.y, 1.0);
}
`;
const poleFrag = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }
`;
const flagVert = /* glsl */ `
attribute vec4 aPole, aInfo;
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
${COMMON}
${POLE_Y}
void main() {
  vUv = uv;
  vShape = aInfo.w;
  vCol = aInfo.w > 2.5 ? (uColour > 0.05 ? accent(3.0 + floor(aInfo.y * 2.0)) : uInk) : idxColour(aInfo.x + 1.0, aInfo.y * 0.8);
  float s = aInfo.w > 2.5 ? 0.55 : aInfo.w > 1.5 ? 0.42 : 0.38;
  float on = step(0.5, aInfo.w);
  vec3 p = position * s * on;
  if (aInfo.w < 1.5 || aInfo.w > 2.5) p.xz = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p.xz; // diamonds
  p += vec3(aPole.x, poleTop(aPole, aInfo) + 0.02, aPole.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const flagFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
${COMMON}
void main() {
  vec2 c = vUv - 0.5;
  if (vShape > 1.5 && vShape < 2.5 && length(c) > 0.5) discard;
  vec3 col = vCol;
  // Markers and diamonds are hollow frames with a small centre dot.
  if (vShape < 1.5 || vShape > 2.5) {
    float m = max(abs(c.x), abs(c.y));
    if (m < 0.3 && m > 0.12) discard;
    if (m <= 0.12) col = uInk;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Static coloured lines (scaffold tower) ----
const linesVert = /* glsl */ `
attribute float aIdx;
varying vec3 vCol;
${COMMON}
void main() {
  vCol = idxColour(aIdx, fract(aIdx * 7.31 + position.x * 3.1));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

// ---- Spheres and rings ----
const ballVert = /* glsl */ `
attribute vec4 aBall;   // x, y, z, size
attribute vec2 aBInfo;  // colour index, phase
uniform float uRing;
varying vec3 vN;
varying vec3 vCol;
${COMMON}
void main() {
  float bob = sin(uTime * 0.9 + aBInfo.y * 6.28) * 0.35;
  float d = distance(aBall.xz, uMouse.xy);
  bob += uMouse.z * 1.2 * exp(-d * d / 8.0);
  vec3 p = position * aBall.w;
  if (uRing > 0.5) {
    float a = uTime * 0.7 + aBInfo.y * 6.28;
    p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  }
  vN = normalize(normal);
  if (uRing > 0.5) { float a = uTime * 0.7 + aBInfo.y * 6.28; vN.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * vN.xz; }
  vCol = uColour > 0.05 ? accent(aBInfo.x) : uInk;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + aBall.xyz + vec3(0.0, bob, 0.0), 1.0);
}
`;
const ballFrag = /* glsl */ `
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vCol;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  float diff = clamp(dot(n, uLight), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-uLight, n), vec3(0.0, 0.6, 0.8)), 0.0, 1.0), 18.0);
  vec3 col = vCol * (0.45 + 0.75 * diff);
  col = mix(col, mix(vCol, uInk, 0.7), spec * 0.8);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Small seeded value noise.
function makeNoise(rand) {
  const seed = Math.floor(rand() * 1e9);
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = sm(x - xi), v = sm(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => vn(x, y) * 0.6 + vn(x * 2.1 + 17, y * 2.1 - 9) * 0.3 + vn(x * 4.3 - 3, y * 4.3 + 31) * 0.1;
}

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

export default {
  id: 'dataterrain',
  name: 'Data Terrain',
  engine: 'three',
  hint: 'Hover to raise the terrain, click to plant a data pole',
  darkGround: (p) => p.background === 'Dark', // the poster text switches to the light colour
  params,
  controls: {
    essentials: ['relief', 'poles', 'platform', 'spin'],
    form: ['detail', 'spikes', 'spheres', 'tilt', 'zoom'],
    motion: ['wave'],
    interaction: ['lift'],
    colour: ['background', 'colour'],
  },
  presets: {
    'Survey': { detail: 56, relief: 0.8, spikes: 0.3, poles: 16, platform: 0.3, spheres: 2 },
    'Data city': { poles: 130, platform: 0.8, spheres: 10, colour: 1, tilt: 38 },
    'Peaks': { relief: 2, spikes: 1.8, poles: 30, platform: 0.15, wave: 1.2, tilt: 22 },
  },
  interactions: { hover: 'raises a rippling bump in the terrain and lifts nearby poles', click: 'plants a new data pole and sends a pulse across the terrain' },
  create(ctx) {
    const P = ctx.params;
    const stage = createThreeStage(ctx, { ortho: true, background: false });
    const cam = stage.camera;
    cam.near = 1; cam.far = 800;
    const rand = ctx.rand;
    const noise = makeNoise(rand);
    const half = S / 2;

    const pal = { value: paletteUniform(ctx.state.colors) };
    const shared = {
      uTime: { value: 0 }, uRelief: { value: 1 }, uWave: { value: 0.6 }, uColour: { value: 0.8 },
      uMouse: { value: new THREE.Vector3() },
      uPulse: { value: Array.from({ length: PULSES }, () => new THREE.Vector4(0, 0, -100, 0)) },
      uInk: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uPal: pal,
    };
    const mat = (vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...shared, ...extra } });

    // ---- Terrain heights: rolling noise plus a few sharp peaks ----
    const N = P.detail;
    const peaks = Array.from({ length: 3 + Math.floor(rand() * 4) }, () => ({
      x: rand.range(-0.35, 0.35) * S, z: rand.range(-0.35, 0.35) * S, a: rand.range(1.2, 3.4) * P.spikes, r: rand.range(0.6, 1.6),
    }));
    const heightAt = (x, z) => {
      let h = (noise(x * 0.12 + 5, z * 0.12 - 3) - 0.45) * 3.2;
      for (const k of peaks) h += k.a * Math.exp(-Math.hypot(x - k.x, z - k.z) / k.r);
      // Little random spikes, like noisy survey data.
      h += P.spikes * 1.4 * Math.max(0, noise(x * 0.9 + 40, z * 0.9) - 0.72) * 4;
      const edge = Math.min(1, (half - Math.max(Math.abs(x), Math.abs(z))) / (S * 0.18));
      return h * (0.25 + 0.75 * Math.max(0, edge));
    };
    const H = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i * N + j] = heightAt(-half + (i / (N - 1)) * S, -half + (j / (N - 1)) * S);
    const hBilinear = (x, z) => {
      const fx = Math.min(N - 1.001, Math.max(0, ((x + half) / S) * (N - 1))), fz = Math.min(N - 1.001, Math.max(0, ((z + half) / S) * (N - 1)));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = H[i * N + j], b = H[(i + 1) * N + j], c = H[i * N + j + 1], d = H[(i + 1) * N + j + 1];
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
    {
      const pos = [], ah = [];
      const vtx = (i, j) => { pos.push(-half + (i / (N - 1)) * S, 0, -half + (j / (N - 1)) * S); ah.push(H[i * N + j]); };
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        if (i < N - 1) { vtx(i, j); vtx(i + 1, j); }
        if (j < N - 1) { vtx(i, j); vtx(i, j + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aH', new THREE.Float32BufferAttribute(ah, 1));
      const terrain = new THREE.LineSegments(g, mat(terrainVert, terrainFrag));
      terrain.frustumCulled = false;
      stage.scene.add(terrain);
    }

    // ---- Floating platform ----
    const platY = 7.5;
    const platU = { uDensity: { value: 0.5 }, uPlatY: { value: platY }, uSeed: { value: (ctx.state.seed % 1000) / 1000 } };
    {
      const M = 30, pitch = 0.42, ox = rand.range(-2.5, 0.5), oz = rand.range(-2.5, 0.5);
      const quad = new THREE.PlaneGeometry(0.3, 0.3);
      quad.rotateX(-Math.PI / 2);
      const g = new THREE.InstancedBufferGeometry().copy(quad);
      quad.dispose();
      const cells = new Float32Array(M * M * 2);
      for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) cells.set([ox + (i - M / 2) * pitch, oz + (j - M / 2) * pitch], (i * M + j) * 2);
      g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      g.instanceCount = M * M;
      const m = mat(platVert, platFrag, platU);
      m.side = THREE.DoubleSide;
      const plat = new THREE.Mesh(g, m);
      plat.frustumCulled = false;
      stage.scene.add(plat);
    }

    // ---- Poles: clusters around the terrain, a few on it, and ground markers ----
    const poles = [];
    const clusters = [];
    const nC = 3;
    const a0 = rand() * Math.PI * 2;
    for (let c = 0; c < nC; c++) {
      const a = a0 + (c / nC) * Math.PI * 2 + rand.range(-0.4, 0.4);
      const r = S * rand.range(0.58, 0.7);
      clusters.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, col: Math.floor(rand() * 4), flag: 1 + Math.floor(rand() * 2), tall: rand.range(0.6, 1.3) });
    }
    const nOn = Math.round(P.poles * 0.22);
    for (let k = 0; k < P.poles; k++) {
      const onTerrain = k < nOn;
      let x, z, base, hgt, flag, col;
      if (onTerrain) {
        x = rand.range(-0.42, 0.42) * S; z = rand.range(-0.42, 0.42) * S;
        base = hBilinear(x, z); hgt = rand.range(1.5, 5); flag = 1;
        col = Math.floor(rand() * 4);
      } else {
        const C = clusters[k % nC];
        x = C.x + rand.range(-2.6, 2.6); z = C.z + rand.range(-2.6, 2.6);
        base = -100; hgt = rand.range(5, 19) * C.tall; flag = rand() < 0.75 ? C.flag : 0;
        col = rand() < 0.65 ? Math.floor(rand() * 4) : 4;
      }
      poles.push({ x, z, base, hgt, col, roll: rand(), birth: -100, flag });
      // Every few poles gets a marker on the ground next to it.
      if (!onTerrain && rand() < 0.35) poles.push({ x: x + rand.range(-1.2, 1.2), z: z + rand.range(-1.2, 1.2), base: -100, hgt: 0.001, col: 4, roll: rand(), birth: -100, flag: 3 });
    }
    // Annotation markers floating above the highest peaks.
    peaks.forEach((k) => poles.push({ x: k.x, z: k.z, base: hBilinear(k.x, k.z), hgt: 1.6, col: 4, roll: rand(), birth: -100, flag: 3 }));
    const baseCount = poles.length;
    const cap = baseCount + USER_POLES;
    for (let k = 0; k < USER_POLES; k++) poles.push({ x: 0, z: 0, base: 0, hgt: 0, col: 4, roll: 0, birth: -100, flag: 0 });

    const lineGeo = new THREE.BufferGeometry();
    const lPole = new Float32Array(cap * 2 * 4), lInfo = new Float32Array(cap * 2 * 4), lEnd = new Float32Array(cap * 2);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 2 * 3), 3));
    lineGeo.setAttribute('aPole', new THREE.BufferAttribute(lPole, 4));
    lineGeo.setAttribute('aInfo', new THREE.BufferAttribute(lInfo, 4));
    lineGeo.setAttribute('aEnd', new THREE.BufferAttribute(lEnd, 1));
    const flagQuad = new THREE.PlaneGeometry(1, 1);
    flagQuad.rotateX(-Math.PI / 2);
    const flagGeo = new THREE.InstancedBufferGeometry().copy(flagQuad);
    flagQuad.dispose();
    const fPole = new Float32Array(cap * 4), fInfo = new Float32Array(cap * 4);
    flagGeo.setAttribute('aPole', new THREE.InstancedBufferAttribute(fPole, 4));
    flagGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(fInfo, 4));
    flagGeo.instanceCount = cap;
    const writePole = (k) => {
      const p = poles[k];
      const pv = [p.x, p.z, p.base, p.hgt], iv = [p.col, p.roll, p.birth, p.flag];
      for (let e = 0; e < 2; e++) { lPole.set(pv, (k * 2 + e) * 4); lInfo.set(iv, (k * 2 + e) * 4); lEnd[k * 2 + e] = e; }
      fPole.set(pv, k * 4); fInfo.set(iv, k * 4);
    };
    for (let k = 0; k < cap; k++) writePole(k);
    const poleLines = new THREE.LineSegments(lineGeo, mat(poleVert, poleFrag));
    poleLines.frustumCulled = false;
    stage.scene.add(poleLines);
    const flagMat = mat(flagVert, flagFrag);
    flagMat.side = THREE.DoubleSide;
    const flags = new THREE.Mesh(flagGeo, flagMat);
    flags.frustumCulled = false;
    stage.scene.add(flags);

    // ---- Scaffold tower: stacked wire boxes in several colours, by the first cluster ----
    {
      const C = clusters[0];
      const tx = C.x * 0.62 + rand.range(-1, 1), tz = C.z * 0.62 + rand.range(-1, 1) + (Math.abs(C.x) < 3 ? 3 : 0);
      const pos = [], idx = [];
      const seg = (a, b, i) => { pos.push(...a, ...b); idx.push(i, i); };
      const levels = 5 + Math.floor(rand() * 4), lh = 0.9;
      for (let b = 0; b < 4; b++) {
        const w = 0.9 + b * 0.18, ci = b, ox = tx + b * 0.12, oz = tz - b * 0.1;
        const corners = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([a, c]) => [ox + a * 0.5, oz + c * 0.5]);
        const top = levels * lh * (0.7 + 0.1 * b);
        corners.forEach(([x, z]) => seg([x, 0, z], [x, top, z], ci));
        for (let l = 0; l <= levels; l++) {
          const y = Math.min(top, l * lh * (0.7 + 0.1 * b));
          for (let c = 0; c < 4; c++) { const A = corners[c], B = corners[(c + 1) % 4]; seg([A[0], y, A[1]], [B[0], y, B[1]], ci); }
        }
      }
      // Base square in the line colour.
      const bw = 1.6;
      [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]].forEach(([a, b, c, d]) => seg([tx + a * bw, 0, tz + b * bw], [tx + c * bw, 0, tz + d * bw], 4));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aIdx', new THREE.Float32BufferAttribute(idx, 1));
      const tower = new THREE.LineSegments(g, mat(linesVert, poleFrag));
      tower.frustumCulled = false;
      stage.scene.add(tower);
    }

    // ---- Spheres (by a cluster) and small rings ----
    const uLight = { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() };
    const addBalls = (geo, count, ring, place) => {
      const g = new THREE.InstancedBufferGeometry().copy(geo);
      geo.dispose();
      const b = new Float32Array(Math.max(1, count) * 4), inf = new Float32Array(Math.max(1, count) * 2);
      for (let k = 0; k < count; k++) { const [x, y, z, s, c] = place(k); b.set([x, y, z, s], k * 4); inf.set([c, rand()], k * 2); }
      g.setAttribute('aBall', new THREE.InstancedBufferAttribute(b, 4));
      g.setAttribute('aBInfo', new THREE.InstancedBufferAttribute(inf, 2));
      g.instanceCount = count;
      const m = new THREE.Mesh(g, mat(ballVert, ballFrag, { uLight, uRing: { value: ring ? 1 : 0 } }));
      m.frustumCulled = false;
      m.visible = count > 0;
      stage.scene.add(m);
    };
    const C1 = clusters[1 % nC], C2 = clusters[2 % nC];
    const ballCol = Math.floor(rand() * 4);
    addBalls(new THREE.SphereGeometry(0.5, 28, 18), P.spheres, false, () => [
      C1.x + rand.range(-2.4, 2.4), rand.range(3, 7.5), C1.z + rand.range(-2.4, 2.4), rand.range(0.6, 0.95), rand() < 0.75 ? ballCol : Math.floor(rand() * 4),
    ]);
    const rings = Math.round(P.spheres * 0.8);
    addBalls(new THREE.TorusGeometry(0.32, 0.08, 10, 28), rings, true, () => [
      C2.x + rand.range(-2.8, 2.8), rand.range(0.4, 2.2), C2.z + rand.range(-2.8, 2.8), 1, Math.floor(rand() * 4),
    ]);

    // ---- Interaction ----
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const mouse = { x: 0, z: 0, amt: 0 };
    let az = Math.PI / 4 + rand.range(-0.25, 0.25), pulseIdx = 0, userIdx = 0;

    function fitCamera() {
      const { w, h } = stage.size;
      const aspect = w / h;
      // Fit the whole scene's width; tall posters get the extra height for the poles.
      const viewW = (S * 1.6) / P.zoom;
      const viewH = Math.max(viewW / aspect, (S * 1.1) / P.zoom);
      cam.left = -viewH * aspect / 2; cam.right = viewH * aspect / 2;
      cam.top = viewH / 2; cam.bottom = -viewH / 2;
      cam.updateProjectionMatrix();
    }

    return {
      resize(w, h, dpr) { stage.resize(w, h, dpr); fitCamera(); },
      frame(time, dt) {
        const u = shared;
        const c = ctx.state.colors;
        const darkFirst = lum(c.bg) <= lum(c.ink);
        const paper = P.background === 'Paper';
        const ground = paper ? c.bg : (darkFirst ? c.bg : c.ink);
        const ink = paper ? c.ink : (darkFirst ? c.ink : c.bg);
        stage.scene.background = (stage.scene.background || new THREE.Color()).set(ground);
        u.uInk.value.set(ink); u.uGround.value.set(ground);
        u.uTime.value = time;
        u.uRelief.value = P.relief; u.uWave.value = P.wave; u.uColour.value = P.colour;
        platU.uDensity.value = P.platform;
        pal.value = paletteUniform(c);

        az += (dt || 0) * P.spin;
        const el = (P.tilt * Math.PI) / 180;
        const R = 300, ty = 5.5;
        cam.position.set(Math.sin(az) * Math.cos(el) * R, ty + Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
        cam.lookAt(0, ty, 0);
        if (cam.userData.zoom !== P.zoom) { cam.userData.zoom = P.zoom; fitCamera(); }

        // Cursor on the ground plane.
        const pow = ctx.state.motion.mouse * P.lift;
        let target = 0;
        if (ctx.pointer.inside && pow > 0) {
          ray.setFromCamera(pointerNDC(ctx), cam);
          if (ray.ray.intersectPlane(plane, hit)) {
            const k = mouse.amt < 0.02 ? 1 : Math.min(1, (dt || 0) * 12);
            mouse.x += (hit.x - mouse.x) * k;
            mouse.z += (hit.z - mouse.z) * k;
            target = Math.min(pow, 2.5);
            if (ctx.pointer.justPressed) {
              u.uPulse.value[pulseIdx].set(hit.x, hit.z, time, Math.min(pow, 2));
              pulseIdx = (pulseIdx + 1) % PULSES;
              const on = Math.abs(hit.x) < half && Math.abs(hit.z) < half;
              const k2 = baseCount + userIdx;
              poles[k2] = {
                x: hit.x, z: hit.z, base: on ? hBilinear(hit.x, hit.z) : -100, hgt: rand.range(4, 11),
                col: Math.floor(rand() * 4), roll: rand() * 0.5, birth: time, flag: 1 + Math.floor(rand() * 2),
              };
              writePole(k2);
              userIdx = (userIdx + 1) % USER_POLES;
              for (const a of ['aPole', 'aInfo']) { lineGeo.attributes[a].needsUpdate = true; flagGeo.attributes[a].needsUpdate = true; }
            }
          }
        }
        mouse.amt += (target - mouse.amt) * Math.min(1, (dt || 0) * 5);
        u.uMouse.value.set(mouse.x, mouse.z, mouse.amt);
        stage.render(time);
      },
      dispose: stage.dispose,
    };
  },
};
