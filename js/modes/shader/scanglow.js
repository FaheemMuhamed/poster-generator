// Scan Glow: the picture redrawn as glowing scan lines made of dots (refs 10, 11, 13, 14).
// Brightness sets each dot's size and glow; the lines wobble in slow waves with a little
// per-dot jitter, star specks twinkle in the dark, and a soft bloom haloes the bright areas.
// Light backdrops are keyed out (the border colour is measured), so subjects glow on black.
// Hover bends the lines away from the cursor and lights them; hold to scan harder; click sends a pulse.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  spacing:    { value: 7, min: 3, max: 24, step: 0.5, label: 'Line spacing', unit: 'px' },
  dotSpacing: { value: 0.5, min: 0.25, max: 2, step: 0.01, label: 'Dot spacing', unit: '×' },
  size:       { value: 1, min: 0.3, max: 1.6, step: 0.01, label: 'Dot size' },
  shape:      { value: 'Round', options: ['Round', 'Square', 'Dash', 'Diamond'], label: 'Dot shape' },
  direction:  { value: 'Horizontal', options: ['Horizontal', 'Vertical'], label: 'Direction' },
  wave:       { value: 1.1, min: 0, max: 3, step: 0.01, label: 'Wave amount' },
  waveScale:  { value: 1.5, min: 0.3, max: 6, step: 0.01, label: 'Wave scale' },
  jitter:     { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Jitter amount' },
  glow:       { value: 0.9, min: 0, max: 2, step: 0.01, label: 'Glow amount' },
  stars:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Star density' },
  flow:       { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  read:       { value: 'Auto', options: ['Auto', 'Brightness', 'Inverted', 'Cut out backdrop'], label: 'Read picture as' },
  contrast:   { value: 1.3, min: 0.2, max: 3, step: 0.01, label: 'Contrast' },
  brightness: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Brightness' },
  tint:       { value: 'Colour 1', options: ['Colour 1', 'Colour 2', 'Colour 3', 'Colour 4', 'Ramp', 'Light'], label: 'Glow colour' },
  push:       { value: 1, min: 0, max: 2, step: 0.01, label: 'Push strength' },
};

const PULSES = 4;

const fragment = /* glsl */ `
uniform float uDpr;
uniform vec3 uDark, uLight, uBackdrop; // darker / lighter of bg + ink; the picture's border colour
uniform float uCut;                    // 1 when the backdrop is keyed out
uniform vec2 uHold;
uniform vec4 uPulse[${PULSES}];        // xy centre (aspect space), z start time, w strength

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Picture value 0..1 at a poster uv: brightness, inverted, or distance from the backdrop.
float picture(vec2 uv) {
  vec3 c = sourceAt(uv);
  float L = lum(c);
  if (p_read > 2.5 || (p_read < 0.5 && uCut > 0.5)) {
    float key = smoothstep(0.05, 0.22, distance(c, uBackdrop));
    L = key * (0.3 + 0.7 * smoothstep(0.0, 0.9, L));
  } else if (p_read > 1.5) L = 1.0 - L;
  return clamp((L - 0.5) * p_contrast + 0.5 + p_brightness, 0.0, 1.0);
}

vec3 tintCol(float L) {
  if (p_tint < 0.5) return uPal[2];
  if (p_tint < 1.5) return uPal[3];
  if (p_tint < 2.5) return uPal[4];
  if (p_tint < 3.5) return uPal[5];
  if (p_tint < 4.5) return paletteRamp(0.15 + L * 0.7 + uSeed);
  return uLight;
}

void main() {
  bool vert = p_direction > 0.5;
  vec2 fc = gl_FragCoord.xy;
  vec2 ab = vert ? fc.yx : fc;           // a: along the line, b: across lines (device px)
  vec2 res = vert ? uRes.yx : uRes;
  float sp = max(2.0, p_spacing * uDpr);
  float dsp = max(1.5, sp * p_dotSpacing);
  float t = uTime * p_flow;
  float hold = uHold.y > 0.5 ? uHold.x : uDown;
  float mp = clamp(uMousePow, 0.0, 3.0);

  // Cursor and pulses, measured in aspect space at this pixel.
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 mq = (uMouse - 0.5) * vec2(uAspect, 1.0);
  vec2 dm = q - mq;
  float gm = exp(-dot(dm, dm) / (0.018 + 0.02 * hold)) * uInside * mp * p_push;
  float across = vert ? dm.x : dm.y;     // signed distance across the lines
  float pulseB = 0.0, pulseL = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    vec4 P = uPulse[i];
    float age = uTime - P.z;
    if (P.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    float r = length(q - P.xy);
    float k = (r - age * 0.45) / (0.03 + age * 0.02);
    float band = exp(-k * k) * P.w * exp(-age * 0.8);
    pulseB += band * sin(r * 90.0 - age * 8.0);
    pulseL += band;
  }

  // Line displacement across (px): slow waves along the line + cursor bulge + pulse ripples.
  float A = p_wave * sp;
  float an = ab.x / res.y * p_waveScale;
  float bulge = across / (abs(across) + 0.04) * gm * sp * 3.5 * (1.0 + hold);
  float i0g = floor(ab.y / sp);
  float wave0 = A * (sin(an * 6.0 + t * 0.9 + i0g * 0.07) * 0.5 + snoise(vec2(an * 2.0, i0g * 0.09 + t * 0.15 + uSeed * 9.0)));
  float lineIdx = floor((ab.y - wave0 - bulge - pulseB * sp) / sp);

  float cov = 0.0, glow = 0.0, coreL = 0.0;
  float j0 = floor(ab.x / dsp);
  for (int di = -1; di <= 1; di++) {
    float i = lineIdx + float(di);
    float wv = A * (sin(an * 6.0 + t * 0.9 + i * 0.07) * 0.5 + snoise(vec2(an * 2.0, i * 0.09 + t * 0.15 + uSeed * 9.0)));
    float slide = p_wave * dsp * 0.6 * snoise(vec2(i * 0.05, t * 0.2 + 3.0));
    float cb = (i + 0.5) * sp + wv + bulge + pulseB * sp;
    for (int dj = -2; dj <= 2; dj++) {
      float j = j0 + float(dj);
      vec2 h = hash22(vec2(i, j) + uSeed * 31.0);
      float ca = (j + 0.5) * dsp + slide + (h.x - 0.5) * dsp * p_jitter;
      float cbj = cb + (h.y - 0.5) * sp * p_jitter * 0.8;
      // Brightness at the dot's resting place, so the picture travels with the wobble.
      vec2 rest = vec2((j + 0.5) * dsp, (i + 0.5) * sp);
      vec2 uvr = (vert ? rest.yx : rest) / uRes;
      float L = picture(uvr);
      L = clamp(L + gm * (0.25 + 0.4 * hold) * smoothstep(0.02, 0.2, L) + pulseL * 0.5 * L, 0.0, 1.0);
      if (L < 0.03) continue;
      vec2 v = vec2(ab.x - ca, ab.y - cbj);
      float r = min(0.62 * dsp, 0.36 * sp) * p_size * (0.3 + 0.8 * sqrt(L));
      float d;
      if (p_shape < 0.5) d = length(v) / r;
      else if (p_shape < 1.5) d = max(abs(v.x), abs(v.y)) / (r * 0.85);
      else if (p_shape < 2.5) d = length(v / vec2(max(r, dsp * 0.46), r * 0.55));
      else d = (abs(v.x) + abs(v.y)) / (r * 1.25);
      float aa = 1.3 / r;
      float c = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, d)) * smoothstep(0.03, 0.12, L);
      if (c > cov) { cov = c; coreL = L; }
      glow += L * L * exp(-d * r / (sp * (0.35 + 0.5 * p_glow)));
    }
  }

  // Soft bloom: the picture blurred over two rings of taps.
  vec2 bq = vec2(1.0 / uAspect, 1.0);
  float halo = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7854 + 0.39;
    vec2 o = vec2(cos(a), sin(a)) * bq;
    halo += picture(vUv + o * 0.022) + picture(vUv + o * 0.055) * 0.6;
  }
  halo /= 12.8;

  // Stars: sparse twinkling specks, mostly where the picture is dark.
  float cell = 26.0 * uDpr;
  vec2 sid = floor(fc / cell);
  vec3 sh = vec3(hash22(sid + uSeed * 17.0), hash21(sid * 1.7 + 3.0));
  float star = 0.0;
  if (sh.z < p_stars * 0.18) {
    vec2 sc = (sid + 0.15 + sh.xy * 0.7) * cell;
    float tw = 0.55 + 0.45 * sin(t * (1.0 + sh.x * 2.0) + sh.y * 40.0);
    float sd = length(fc - sc) / uDpr;
    star = tw * (exp(-sd * sd / (0.8 + 2.0 * sh.y)) + 0.25 * exp(-sd / 3.5)) * (1.0 - smoothstep(0.1, 0.5, halo));
  }

  vec3 tc = tintCol(coreL);
  vec3 col = uDark + tintCol(halo) * halo * halo * 0.4 * p_glow;
  col += tc * glow * 0.22 * p_glow;
  vec3 dotCol = mix(tc, uLight, smoothstep(0.75, 1.0, coreL) * 0.6);
  col = mix(col, dotCol * (0.75 + 0.35 * coreL) + tc * glow * 0.1 * p_glow, cov);
  col += mix(tintCol(sh.x), uLight, 0.6) * star;
  col += (hash21(fc) - 0.5) * 0.02;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

export default {
  id: 'scanglow',
  name: 'Scan Glow',
  engine: 'three',
  medium: 'image',
  hint: 'Hover to bend and light the scan lines, hold to scan harder, click for a pulse',
  darkGround: () => true, // the poster text switches to the light colour
  params,
  controls: {
    essentials: ['spacing', 'shape', 'wave', 'glow'],
    form: ['dotSpacing', 'size', 'direction', 'jitter', 'stars'],
    motion: ['flow', 'waveScale'],
    interaction: ['push'],
    image: ['read', 'contrast', 'brightness'],
    colour: ['tint'],
  },
  presets: {
    'Hologram': { spacing: 5, dotSpacing: 0.6, shape: 'Round', wave: 1.4, jitter: 0.6, glow: 1.3, direction: 'Vertical' },
    'CRT': { spacing: 4, dotSpacing: 1, shape: 'Square', wave: 0.2, jitter: 0.05, glow: 0.7, stars: 0.2 },
    'Wide scan': { spacing: 14, dotSpacing: 0.4, shape: 'Dash', wave: 0.8, glow: 1.6, tint: 'Ramp' },
  },
  interactions: { hover: 'bends the scan lines away from the cursor and lights them', click: 'sends a bright pulse rippling through the lines' },
  create(ctx) {
    const pulses = Array.from({ length: PULSES }, () => new THREE.Vector4(0, 0, -99, 0));
    const hold = new THREE.Vector2(0, 1);
    const extra = {
      uDpr: { value: 1 }, uHold: { value: hold }, uPulse: { value: pulses },
      uDark: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
      uBackdrop: { value: new THREE.Color(1, 1, 1) }, uCut: { value: 0 },
    };
    const fs = createFullscreenShader(ctx, params, fragment, { source: true, extraUniforms: extra });
    let next = 0, seen = -1;

    // The picture's border colour: if it is a light, even backdrop, key it out by default.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    const measureBackdrop = () => {
      const N = 16;
      pctx.drawImage(ctx.source.canvas, 0, 0, N, N);
      const d = pctx.getImageData(0, 0, N, N).data;
      let r = 0, g = 0, b = 0, n = 0, v = 0;
      const px = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (x > 0 && y > 0 && x < N - 1 && y < N - 1) continue;
        const k = (y * N + x) * 4;
        px.push([d[k], d[k + 1], d[k + 2]]);
        r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      for (const [pr, pg, pb] of px) v += Math.hypot(pr - r, pg - g, pb - b);
      v /= n;
      extra.uBackdrop.value.setRGB(r / 255, g / 255, b / 255);
      extra.uCut.value = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 && v < 40 ? 1 : 0;
    };

    return {
      ...fs,
      frame(time, dt) {
        const p = ctx.pointer;
        const { w, h, dpr } = fs.stage.size;
        const d = Math.min(Math.max(dt || 0, 0), 0.1);
        extra.uDpr.value = dpr;
        if (seen !== ctx.source.version) { seen = ctx.source.version; measureBackdrop(); }
        const c = ctx.state.colors;
        const darkFirst = lum(c.bg) <= lum(c.ink);
        extra.uDark.value.set(darkFirst ? c.bg : c.ink);
        extra.uLight.value.set(darkFirst ? c.ink : c.bg);
        const strength = Math.min(2, ctx.state.motion.mouse * ctx.params.push);
        if (p.justPressed && p.inside && strength > 0) {
          pulses[next].set((p.x - 0.5) * (w / h), 0.5 - p.y, time, strength);
          next = (next + 1) % PULSES;
        }
        hold.x += ((p.down && p.inside ? 1 : 0) - hold.x) * (1 - Math.exp(-d * 5));
        fs.frame(time);
      },
    };
  },
};
