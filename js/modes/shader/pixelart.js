// Pixel Art: the picture turned into crisp game-style pixel art (refs 20–28, 31, 33).
// Downsample to a pixel grid, boost saturation and contrast, quantise to the palette plus
// shades mixed between its colours (optionally through an ordered dither), then draw dark
// outlines on the shadow side of strong edges. Bright pixels sparkle now and then.
// The cursor carries a lens (magnified, or finer pixels); clicks send a ring of shifted colour.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  cell:       { value: 7, min: 2, max: 32, step: 1, label: 'Pixel size', unit: 'px' },
  shades:     { value: 'Mixes', options: ['Palette only', 'Mixes', 'Ramps'], label: 'Shades' },
  match:      { value: 'Nearest colour', options: ['Nearest colour', 'Brightness map'], label: 'Colour match' },
  dither:     { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Dither amount' },
  outline:    { value: 0.75, min: 0, max: 1, step: 0.01, label: 'Outline strength' },
  detail:     { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Outline detail' },
  saturation: { value: 1.35, min: 0, max: 2.5, step: 0.01, label: 'Saturation amount' },
  contrast:   { value: 1.15, min: 0.3, max: 2.5, step: 0.01, label: 'Contrast' },
  brightness: { value: 0, min: -0.4, max: 0.4, step: 0.01, label: 'Brightness' },
  sparkle:    { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Sparkle amount' },
  flow:       { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  lens:       { value: 'Magnify', options: ['Magnify', 'Finer pixels', 'Off'], label: 'Lens mode' },
  lensSize:   { value: 0.16, min: 0.05, max: 0.4, step: 0.01, label: 'Lens size' },
  ripple:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Ripple strength' },
};

const RIPPLES = 4;

const fragment = /* glsl */ `
uniform float uDpr;
uniform vec3 uDark, uLight;
uniform vec3 uRamp[6];         // palette sorted dark to light (brightness map)
uniform vec4 uRip[${RIPPLES}]; // xy centre (aspect space), z start time, w strength

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// Perceptual-ish distance ("redmean" weighted RGB).
float cdist(vec3 a, vec3 b) {
  vec3 d = a - b;
  float rm = (a.r + b.r) * 0.5;
  return dot(d * d, vec3(2.0 + rm, 4.0, 3.0 - rm));
}
void consider(vec3 c, vec3 col, inout vec3 best, inout float bd) {
  float d = cdist(col, c);
  if (d < bd) { bd = d; best = c; }
}
vec3 rampAt(float i) {
  return i < 0.5 ? uRamp[0] : i < 1.5 ? uRamp[1] : i < 2.5 ? uRamp[2] : i < 3.5 ? uRamp[3] : i < 4.5 ? uRamp[4] : uRamp[5];
}
// Nearest of: the six palette colours, plus mixes (or 1/3 + 2/3 ramps) between every pair.
// Brightness map instead walks the palette sorted dark to light, like a gradient map.
vec3 quantise(vec3 col) {
  if (p_match > 0.5) {
    float steps = p_shades < 0.5 ? 1.0 : p_shades < 1.5 ? 2.0 : 3.0;
    float k = floor(clamp(lum(col), 0.0, 1.0) * 5.0 * steps + 0.5) / steps;
    float i = min(floor(k), 4.0);
    return mix(rampAt(i), rampAt(i + 1.0), k - i);
  }
  vec3 best = uPal[0]; float bd = 1e9;
  for (int i = 0; i < 6; i++) {
    consider(uPal[i], col, best, bd);
    if (p_shades < 0.5) continue;
    for (int j = 0; j < 6; j++) {
      if (j <= i) continue;
      if (p_shades < 1.5) consider(mix(uPal[i], uPal[j], 0.5), col, best, bd);
      else { consider(mix(uPal[i], uPal[j], 0.3333), col, best, bd); consider(mix(uPal[i], uPal[j], 0.6667), col, best, bd); }
    }
  }
  return best;
}

// The picture prepared for pixel art: contrast, brightness and a saturation boost.
vec3 grade(vec3 c) {
  c = clamp((c - 0.5) * p_contrast + 0.5 + p_brightness, 0.0, 1.0);
  float L = lum(c);
  return clamp(mix(vec3(L), c, p_saturation), 0.0, 1.0);
}
// Box-filtered cell colour: four taps inside the cell. zc/zoom magnify around zc (uv).
vec3 cellColour(vec2 id, float c, vec2 zc, float zoom) {
  vec2 uv = (id + 0.5) * c / uRes;
  uv = zc + (uv - zc) / zoom;
  vec2 o = 0.25 * c / uRes / zoom;
  vec3 s = sourceAt(uv + vec2(-o.x, -o.y)) + sourceAt(uv + vec2(o.x, -o.y)) + sourceAt(uv + vec2(-o.x, o.y)) + sourceAt(uv + vec2(o.x, o.y));
  return grade(s * 0.25);
}

// One pixel-art layer at cell size c (device px): quantised colour with outlines and sparkles.
vec3 pixelLayer(float c, vec2 zc, float zoom, float shift, float t) {
  vec2 id = floor(gl_FragCoord.xy / c);
  vec3 col = cellColour(id, c, zc, zoom);
  float L = lum(col);
  // Outline: this cell is on the dark side of a strong edge.
  float edge = 0.0;
  edge = max(edge, lum(cellColour(id + vec2(1.0, 0.0), c, zc, zoom)) - L);
  edge = max(edge, lum(cellColour(id - vec2(1.0, 0.0), c, zc, zoom)) - L);
  edge = max(edge, lum(cellColour(id + vec2(0.0, 1.0), c, zc, zoom)) - L);
  edge = max(edge, lum(cellColour(id - vec2(0.0, 1.0), c, zc, zoom)) - L);
  float isEdge = step(0.34 - 0.27 * p_detail, edge) * step(0.01, p_outline);
  // Ripple ring: colours step along the palette ramp.
  if (shift > 0.001) col = mix(col, paletteRamp(L * 0.5 + shift + uSeed), clamp(shift * 1.5, 0.0, 0.85));
  // Ordered dither before the palette snap gives the in-between tones.
  col += (bayer4(id) - 0.47) * p_dither * 0.22;
  vec3 q = quantise(col);
  if (isEdge > 0.5) q = quantise(mix(col, uDark, 0.35 + 0.6 * p_outline));
  // Sparkles: bright cells briefly flash to a lighter shade.
  float tick = floor(t * 2.5 + hash21(id) * 7.0);
  float sp = step(1.0 - p_sparkle * 0.025, hash21(id + tick * 13.1 + uSeed * 7.0)) * smoothstep(0.55, 0.8, L);
  if (sp > 0.5 && isEdge < 0.5) q = quantise(mix(q, uLight, 0.6));
  return q;
}

float cellPx(float cell) { return max(1.0, floor(cell * uDpr + 0.5)); }

void main() {
  float t = uTime * p_flow;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 mq = (uMouse - 0.5) * vec2(uAspect, 1.0);
  float mp = clamp(uMousePow, 0.0, 3.0);
  float c = cellPx(p_cell);

  // Everything below is measured at the cell centre so whole pixels switch together.
  vec2 cc = (floor(gl_FragCoord.xy / c) + 0.5) * c / uRes;
  vec2 qc = (cc - 0.5) * vec2(uAspect, 1.0);
  float shift = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 3.5) continue;
    float d = length(qc - r.xy);
    float k = (d - age * 0.42) / (0.025 + age * 0.01);
    shift += exp(-k * k) * r.w * exp(-age * 1.2);
  }

  // Lens: a stepped circle around the cursor (also measured per coarse cell).
  float lr = p_lensSize * (0.6 + 0.4 * min(mp, 2.0));
  float lensOn = uInside * step(0.001, mp) * step(p_lens, 1.5);
  float inLens = lensOn * step(length(qc - mq), lr);

  vec3 col;
  if (inLens > 0.5) {
    bool mag = p_lens < 0.5;
    float ci = mag ? c : max(1.0, floor(c * 0.4 + 0.5));
    col = pixelLayer(ci, uMouse, mag ? 2.2 : 1.0, shift, t);
  } else {
    col = pixelLayer(c, uMouse, 1.0, shift, t);
  }

  // Lens frame: one light cell ring with a dark drop shadow, like a game UI.
  if (lensOn > 0.5) {
    float dl = length(qc - mq);
    float cw = c / uRes.y;
    float ring = step(lr, dl) * step(dl, lr + cw * 1.05);
    float inner = step(lr - cw * 1.05, dl) * step(dl, lr) * step(mq.y + lr * 0.2, qc.y);
    col = mix(col, uDark, ring);
    col = mix(col, uLight, inner);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

export default {
  id: 'pixelart',
  name: 'Pixel Art',
  engine: 'three',
  medium: 'image',
  hint: 'Hover for a pixel lens, click to send a ring of colour',
  params,
  controls: {
    essentials: ['cell', 'shades', 'dither', 'outline'],
    form: ['detail', 'sparkle'],
    motion: ['flow'],
    interaction: ['lens', 'lensSize', 'ripple'],
    image: ['match', 'saturation', 'contrast', 'brightness'],
    colour: [],
  },
  presets: {
    'Game Boy': { cell: 6, shades: 'Ramps', match: 'Brightness map', dither: 0.6, outline: 0.4, saturation: 1 },
    'Chunky': { cell: 14, shades: 'Mixes', dither: 0.15, outline: 1, detail: 0.7 },
    'Fine sprite': { cell: 4, shades: 'Ramps', dither: 0.25, outline: 0.5, detail: 0.35, saturation: 1.6 },
  },
  interactions: { hover: 'opens a pixel lens that magnifies the picture', click: 'sends a ring of shifted colour outward' },
  create(ctx) {
    const rips = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    const extra = {
      uDpr: { value: 1 }, uRip: { value: rips },
      uDark: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
      uRamp: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
    };
    const fs = createFullscreenShader(ctx, params, fragment, { source: true, extraUniforms: extra });
    let next = 0;
    return {
      ...fs,
      frame(time) {
        const p = ctx.pointer;
        const { w, h, dpr } = fs.stage.size;
        extra.uDpr.value = dpr;
        const c = ctx.state.colors;
        const darkFirst = lum(c.bg) <= lum(c.ink);
        extra.uDark.value.set(darkFirst ? c.bg : c.ink);
        extra.uLight.value.set(darkFirst ? c.ink : c.bg);
        ['bg', 'ink', 'c1', 'c2', 'c3', 'c4'].map((k) => c[k]).sort((a, b) => lum(a) - lum(b)).forEach((hex, i) => extra.uRamp.value[i].set(hex));
        const strength = ctx.params.ripple * Math.min(1.5, ctx.state.motion.mouse);
        if (p.justPressed && p.inside && strength > 0) {
          rips[next].set((p.x - 0.5) * (w / h), 0.5 - p.y, time, strength);
          next = (next + 1) % RIPPLES;
        }
        fs.frame(time);
      },
    };
  },
};
