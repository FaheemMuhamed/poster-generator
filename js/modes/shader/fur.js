// Fur: a soft rounded block of fur with a painted pattern (ref: the furry sun tile). Fibres are
// drawn with a short line-integral blur of fine noise along a direction field, so they stand up as
// speckle when untouched and lie down as long strands when brushed; the pattern colour is carried
// along the strands, which gives it a fuzzy edge. A small ping-pong buffer holds the paint (R),
// the brushed fibre direction (GB) and how parted the fur is (A); it springs back over time.
// Hover to brush and part the fur, click or hold to paint the accent colour into it.
import { createThreeStage, THREE } from '../../shared/threeStage.js';
import { shaderHeader, commonUniforms, updateCommonUniforms, FS_VERT } from '../../shared/fullscreenShader.js';

const SIM = 256; // long side of the paint/brush buffer (fixed, independent of dpr)

const params = {
  pattern:  { value: 'Sun', options: ['Sun', 'Stripes', 'Spots', 'Blank'], label: 'Pattern' },
  rays:     { value: 11, min: 3, max: 24, step: 1, label: 'Ray count' },
  size:     { value: 1, min: 0.5, max: 1.3, step: 0.01, label: 'Block size' },
  softness: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Fur softness' },
  density:  { value: 1, min: 0.5, max: 2, step: 0.01, label: 'Fibre density' },
  paint:    { value: 'Colour 1', options: ['Colour 1', 'Colour 2', 'Colour 3', 'Colour 4'], label: 'Paint colour' },
  contrast: { value: 1, min: 0, max: 2, step: 0.01, label: 'Light contrast' },
  brush:    { value: 0.07, min: 0.02, max: 0.2, step: 0.001, label: 'Brush size' },
  strength: { value: 1, min: 0, max: 2, step: 0.01, label: 'Brush strength' },
  spring:   { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Spring strength' },
  speed:    { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
};

// Shared block geometry (poster space: x 0..aspect, y 0..1).
const BLOCK = /* glsl */ `
float blockHalf(float aspect, float size) { return 0.4 * min(aspect, 1.0) * size; }
float sdBlock(vec2 p, float aspect, float size) {
  float hs = blockHalf(aspect, size);
  vec2 q = abs(p - vec2(0.5 * aspect, 0.5)) - vec2(hs) + hs * 0.36;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - hs * 0.36;
}
`;

// Fills the buffer: R = pattern, GB = no brushing yet, A = not parted.
const initFrag = /* glsl */ `
varying vec2 vUv;
uniform float uAspect, uSize, uRays, uPattern, uSeed;
${BLOCK}
float hash(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 c = vec2(0.5 * uAspect, 0.5);
  float hs = blockHalf(uAspect, uSize);
  vec2 q = (p - c) / hs;   // -1..1 across the block
  float paint = 0.0;
  if (uPattern < 0.5) {
    // Sun: a round body with tapered rays of slightly different lengths.
    float d = length(q) - 0.3;
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      if (fi >= uRays) break;
      float a = fi / uRays * 6.2832 + 0.3 + 0.12 * (hash(fi) - 0.5);
      float L = 0.62 + 0.2 * hash(fi + 7.0);
      vec2 dir = vec2(cos(a), sin(a));
      d = min(d, seg(q, dir * 0.15, dir * L) - 0.095 * (1.0 - 0.2 * smoothstep(0.2, L, dot(q, dir))));
    }
    paint = 1.0 - smoothstep(-0.02, 0.02, d);
  } else if (uPattern < 1.5) {
    // Stripes: soft diagonal bands.
    paint = step(0.5, fract((q.x + q.y) * uRays * 0.09));
  } else if (uPattern < 2.5) {
    // Spots: a loose scatter of round dabs.
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      if (fi >= uRays) break;
      vec2 o = vec2(hash(fi * 3.1), hash(fi * 5.7)) * 1.5 - 0.75;
      float r = 0.08 + 0.1 * hash(fi * 9.3);
      paint = max(paint, 1.0 - smoothstep(r - 0.02, r + 0.02, length(q - o)));
    }
  }
  gl_FragColor = vec4(paint, 0.0, 0.0, 0.0);
}
`;

// One step: spring back, brush along the cursor's motion, part the fur around it, paint while held.
const simFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uTexel, uPos, uVel;
uniform float uAspect, uRadius, uBrush, uPart, uPaint, uKeep;
void main() {
  vec4 s = texture2D(uPrev, vUv);
  vec4 avg = 0.25 * (texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)) + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0))
                   + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)) + texture2D(uPrev, vUv - vec2(0.0, uTexel.y)));
  s.gba = mix(s.gba, avg.gba, 0.15);   // brushed fur blends into its neighbours
  s.gb *= uKeep;
  s.a *= uKeep;
  vec2 d = (vUv - uPos) * vec2(uAspect, 1.0);
  float g = exp(-dot(d, d) / (uRadius * uRadius));
  s.gb += uVel * g * uBrush;                               // stroke direction
  s.gb += d / (length(d) + 1e-3) * g * uPart * 0.12;       // parting: fibres pushed away from the cursor
  float l = length(s.gb);
  if (l > 1.4) s.gb *= 1.4 / l;
  s.a = max(s.a, g * uPart);
  s.r = clamp(s.r + g * uPaint, 0.0, 1.0);
  gl_FragColor = s;
}
`;

const displayFrag = /* glsl */ `
uniform sampler2D uBuf;
${BLOCK}
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 P = vec2(vUv.x * uAspect, vUv.y);
  vec2 C = vec2(0.5 * uAspect, 0.5);
  float t = uTime * 0.15 * p_speed;
  float hs = blockHalf(uAspect, p_size);

  vec3 dark = lum(uPal[0]) < lum(uPal[1]) ? uPal[0] : uPal[1];
  vec3 pale = lum(uPal[0]) < lum(uPal[1]) ? uPal[1] : uPal[0];
  vec3 accent = p_paint < 0.5 ? uPal[2] : p_paint < 1.5 ? uPal[3] : p_paint < 2.5 ? uPal[4] : uPal[5];
  if (length(accent - pale) < 0.15) accent = dark; // keep the paint visible on pale fur

  // Fibre direction: at rest the fur leans gently outward and sways in a breeze; brushing lays it down.
  vec4 st = texture2D(uBuf, vUv);
  vec2 rest = (P - C) / hs * 0.16 + 0.16 * vec2(snoise(P * 3.0 + vec2(t, 0.0)), snoise(P * 3.0 + vec2(5.0, -t)));
  vec2 dir = rest + st.gb * 1.8;
  float lay = clamp(length(dir), 0.0, 1.5);
  vec2 dn = dir / max(length(dir), 1e-3);

  // Fibres: average fine noise along the direction (a tiny line-integral blur). Short when standing,
  // long streaks when laid down. Two layers: dense underfur and sparser bright guard hairs.
  float F = 360.0 * p_density;
  float stepL = (0.0008 + 0.005 * lay * lay) * (0.6 + 0.6 * p_softness);
  float fib = 0.0, guard = 0.0;
  for (int k = 0; k < 8; k++) {
    vec2 o = dn * (float(k) - 3.5) * stepL;
    fib += vnoise((P + o) * F);
    guard += vnoise((P + o * 1.6) * F * 0.45 + 17.0);
  }
  fib = clamp((fib / 8.0 - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  guard = smoothstep(0.66, 0.82, guard / 8.0);

  // Pattern colour, carried along the strands so its edge is fuzzy.
  vec2 off = dn * (fib - 0.5) * 0.03 * (0.5 + p_softness) * vec2(1.0 / uAspect, 1.0);
  float paint = 0.5 * (texture2D(uBuf, vUv + off).r + texture2D(uBuf, vUv - off * 0.6 + vec2(0.0, 0.004)).r);
  paint = smoothstep(0.3, 0.7, paint + (fib - 0.5) * 0.35);
  vec3 col = mix(pale, accent, paint);

  // Pillow shading: the block is a soft cushion lit from above; edges and parted roots go darker.
  float e = 0.004;
  float sd = sdBlock(P, uAspect, p_size);
  vec2 g = vec2(sdBlock(P + vec2(e, 0.0), uAspect, p_size) - sd, sdBlock(P + vec2(0.0, e), uAspect, p_size) - sd) / e;
  float depth = clamp(-sd / (hs * 0.45), 0.0, 1.0);
  vec3 n = normalize(vec3(g * (1.0 - depth) * 1.6, 0.6 + depth));
  float diff = clamp(dot(n, normalize(vec3(-0.25, 0.55, 0.8))), 0.0, 1.0);
  float light = mix(0.82, 0.45 + 0.65 * diff, min(p_contrast, 1.0)) * (0.85 + 0.15 * p_contrast);
  col *= light * (0.8 + 0.28 * fib) + guard * 0.06;
  col = mix(col, col * 0.45, st.a * (1.0 - fib) * 0.8);  // roots show where the fur is parted
  col = mix(col, mix(col, pale, 0.4), guard * 0.25 * (1.0 - paint));

  // Hairy silhouette: the outline is broken up by the same fibres.
  float fuzz = 0.003 + 0.011 * p_softness;
  float body = 1.0 - smoothstep(-0.002, 0.002, sd - fuzz * (fib * 1.3 - 0.35));
  vec3 bg = dark * (1.0 + 0.25 * smoothstep(0.9, 0.0, length((P - C) / vec2(uAspect, 1.0))));
  bg *= 1.0 - 0.35 * exp(-max(sdBlock(P + vec2(0.0, 0.025), uAspect, p_size), 0.0) * 30.0); // contact shadow
  col = mix(bg, col, body);

  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.02;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function makeTarget(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false,
  });
}

export default {
  id: 'fur',
  name: 'Fur',
  engine: 'three',
  hint: 'Hover to brush the fur, click or hold to paint',
  darkGround: () => true, // the poster text switches to the light colour
  params,
  controls: {
    essentials: ['pattern', 'rays', 'softness', 'paint'],
    form: ['size', 'density', 'contrast'],
    motion: ['speed', 'spring'],
    interaction: ['brush', 'strength'],
    colour: [],
  },
  presets: {
    'Sun tile': { pattern: 'Sun', rays: 11, softness: 0.5, size: 1, density: 1 },
    'Plush stripes': { pattern: 'Stripes', rays: 8, softness: 0.8, density: 0.8, contrast: 1.3 },
    'Blank canvas': { pattern: 'Blank', softness: 0.35, density: 1.4, brush: 0.1, spring: 0.2 },
  },
  interactions: { hover: 'brushes the fibres along your stroke and parts the fur', click: 'paints the accent colour into the fur (hold to keep painting)' },
  create(ctx) {
    const stage = createThreeStage(ctx, { ortho: true, background: false });
    const renderer = stage.renderer;
    const geo = new THREE.PlaneGeometry(2, 2);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Display pass (goes through the stage so post FX still apply).
    const uniforms = { ...commonUniforms(params), uBuf: { value: null } };
    const display = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: shaderHeader(params) + displayFrag, uniforms, depthTest: false,
    });
    stage.scene.add(new THREE.Mesh(geo, display));

    // Buffer passes share one off-screen quad.
    const simU = {
      uPrev: { value: null }, uTexel: { value: new THREE.Vector2() },
      uPos: { value: new THREE.Vector2(-9, -9) }, uVel: { value: new THREE.Vector2() },
      uAspect: { value: 1 }, uRadius: { value: 0.07 }, uBrush: { value: 0 }, uPart: { value: 0 }, uPaint: { value: 0 }, uKeep: { value: 1 },
    };
    const initU = { uAspect: { value: 1 }, uSize: { value: 1 }, uRays: { value: 11 }, uPattern: { value: 0 }, uSeed: { value: 0 } };
    const simMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: simFrag, uniforms: simU, depthTest: false });
    const initMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: initFrag, uniforms: initU, depthTest: false });
    const quad = new THREE.Mesh(geo, simMat);
    const simScene = new THREE.Scene();
    simScene.add(quad);

    let targets = null, simW = 0, simH = 0;
    const pass = (material, target) => {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(simScene, camera);
      renderer.setRenderTarget(null);
    };

    // Paints the pattern into a fresh buffer.
    const seed = () => {
      const P = ctx.params;
      initU.uAspect.value = simW / simH;
      initU.uSize.value = P.size;
      initU.uRays.value = P.rays;
      initU.uPattern.value = Math.max(0, params.pattern.options.indexOf(P.pattern));
      initU.uSeed.value = (ctx.state.seed % 1000) / 1000;
      pass(initMat, targets[0]);
      pass(initMat, targets[1]);
    };

    const ensureSim = (w, h) => {
      const a = w / h;
      const nw = Math.round(a >= 1 ? SIM : SIM * a), nh = Math.round(a >= 1 ? SIM / a : SIM);
      if (targets && nw === simW && nh === simH) return; // dpr-only changes (PNG export) keep the fur as brushed
      targets?.forEach((t) => t.dispose());
      simW = nw; simH = nh;
      targets = [makeTarget(simW, simH), makeTarget(simW, simH)];
      simU.uTexel.value.set(1 / simW, 1 / simH);
      simU.uAspect.value = a;
      seed();
    };

    return {
      stage,
      resize(w, h, dpr) {
        stage.resize(w, h, dpr);
        ensureSim(w, h);
      },
      frame(time, dt) {
        const p = ctx.pointer;
        const P = ctx.params;
        const d = Math.min(Math.max(dt || 0, 0), 0.1);
        if (d > 0) {
          const mp = ctx.state.motion.mouse;
          const on = p.inside ? 1 : 0;
          simU.uPos.value.set(p.x, 1 - p.y);
          // Pointer velocity is per frame; normalise to ~60 fps so the stroke feels the same everywhere.
          const k = 1 / Math.max(d * 60, 0.25);
          simU.uVel.value.set(p.vx * (stage.size.w / stage.size.h) * k, -p.vy * k);
          simU.uRadius.value = P.brush;
          simU.uBrush.value = 14 * P.strength * mp * on;
          simU.uPart.value = 0.6 * P.strength * mp * on * (p.down ? 0.4 : 1);
          simU.uPaint.value = (p.down && p.inside ? 1 : 0) * Math.min(1, d * 14) * (p.justPressed ? 4 : 1);
          simU.uKeep.value = Math.exp(-d * (0.15 + 2.5 * P.spring));
          simU.uPrev.value = targets[0].texture;
          pass(simMat, targets[1]);
          targets.reverse();
        }
        updateCommonUniforms(uniforms, ctx, params, time, stage.size);
        uniforms.uBuf.value = targets[0].texture;
        stage.render(time);
      },
      onParam(key) {
        if ((key === 'pattern' || key === 'rays' || key === 'size') && targets) seed();
      },
      dispose() {
        targets?.forEach((t) => t.dispose());
        simMat.dispose();
        initMat.dispose();
        stage.dispose();
      },
    };
  },
};
