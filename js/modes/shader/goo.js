// Goo: glossy metaball blobs in flat palette colours (refs 70, 71, 63). Circles drift and merge
// through a smooth-min, each keeps its own flat colour with an ink seam where colours meet, drips
// stretch off the bottom of the bigger blobs and pinch away, satellite dots and confetti float
// around. "Outline" turns the blobs into a glowing bubble network over a dotted colour ground
// (ref 63). Hover pulls the goo toward the cursor, hold to grab a bigger blob, click to splash.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { shaderSketch } from '../../shared/codegen.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  count:     { value: 14, min: 2, max: 16, step: 1, label: 'Blob count' },
  size:      { value: 1, min: 0.4, max: 2, step: 0.01, label: 'Blob size' },
  style:     { value: 'Filled', options: ['Filled', 'Outline'], label: 'Style' },
  softness:  { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Merge softness' },
  drips:     { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Drip amount' },
  dots:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Dot density' },
  thickness: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Outline thickness' },
  mirror:    { value: false, label: 'Mirror' },
  gloss:     { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Gloss amount' },
  hueShift:  { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
  speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  pull:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Pull strength' },
};

const fragment = /* glsl */ `
uniform vec4 uPulse; // click: xy point (poster space), z strength (decays), w seconds since the click
uniform vec2 uHold;  // x: eased press 0..1, y: 1 when the app drives it (otherwise uDown is used)

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// Flat colour for blob i: one of the four accents (shifted), now and then the pale palette end.
vec3 blobColour(float i) {
  float r = hash11(i * 7.13 + uSeed * 11.0);
  vec3 pale = lum(uPal[0]) > lum(uPal[1]) ? uPal[0] : uPal[1];
  if (r > 0.86) return mix(pale, vec3(lum(pale)), 0.0) * 1.04;
  return paletteRamp(floor(r * 4.0 / 0.86) * 0.25 + floor(p_hueShift * 4.0 + 0.5) * 0.25);
}

// Blob centre and radius at time t. Blobs gather around three slowly wandering clusters so they
// pile into masses, while each one orbits and wobbles on its own.
vec3 blob(float i, float t) {
  float cl = mod(i, 3.0);
  float ca = cl * 2.094 + uSeed * 6.283 + 0.4 * hash11(cl * 4.1 + uSeed * 7.0);
  vec2 cc = vec2(0.5 * uAspect, 0.5) + vec2(cos(ca) * 0.27 * uAspect, sin(ca) * 0.3) * (0.85 + 0.3 * hash11(cl * 6.7 + uSeed * 3.0));
  cc += vec2(0.06 * sin(t * 0.37 + cl * 2.0), 0.05 * cos(t * 0.29 + cl * 3.0));
  vec2 h = vec2(hash11(i * 3.17 + uSeed * 5.0), hash11(i * 5.31 + uSeed * 9.0));
  float sp = 0.5 + 0.7 * hash11(i * 1.9);
  float a = h.x * 6.283 + t * sp * (h.y > 0.5 ? 1.0 : -1.0) * 0.6;
  float rad = (0.03 + 0.11 * h.y) * (0.8 + 0.25 * sin(t * 0.7 * sp + i));
  vec2 c = cc + vec2(cos(a), sin(a)) * rad * vec2(1.2, 1.0);
  float r = (0.03 + 0.1 * pow(hash11(i * 0.618 + 0.37 + uSeed * 3.0), 1.5)) * p_size;
  r *= 1.0 + 0.08 * sin(t * 1.3 + i * 3.0);
  return vec3(c, r);
}

float colourKey(float id) { return id >= 20.0 ? floor(uPulse.y * 7.0) : id; }

// Scene: x = smooth union distance, y = id of the nearest blob, z = seam (gap to the nearest blob
// of another colour), w unused.
vec4 scene(vec2 p, float t, vec2 m, float grab) {
  float k = 0.015 + 0.09 * p_softness;
  float d = 9.0, n1 = 9.0, n2 = 9.0, id = 0.0, id2 = -1.0;
  // A slow wobble makes the edges organic instead of perfect circles.
  float wob = 0.012 * snoise(p * 7.0 + vec2(t * 0.4, -t * 0.3) + uSeed * 20.0);
  for (int j = 0; j < 16; j++) {
    float i = float(j);
    if (i >= p_count) break;
    vec3 b = blob(i, t);
    float di = length(p - b.xy) - b.z + wob * b.z * 6.0;
    // Drip: a neck grows off the bottom of the blob, swells into a drop, pinches off and falls.
    if (hash11(i * 2.7 + uSeed) < p_drips && b.z > 0.05 * p_size) {
      float ph = fract(t * 0.14 * (0.6 + hash11(i * 4.3)) + hash11(i * 8.1));
      float sx = b.xy.x + 0.35 * b.z * (hash11(i * 6.1) - 0.5);
      float u = min(ph / 0.7, 1.0), v = max(ph - 0.7, 0.0) / 0.3;
      vec2 top = vec2(sx, b.xy.y - b.z * 0.6);
      vec2 tip = vec2(sx, b.xy.y - b.z * (0.9 + 1.1 * u * u) - v * v * 0.6);
      vec2 neckEnd = vec2(sx, b.xy.y - b.z * (0.9 + 1.1 * u * u) * (1.0 - v));
      float nr = b.z * 0.22 * (1.0 - 0.5 * u) * (1.0 - smoothstep(0.0, 0.35, v));
      vec2 pa = p - top, ba = neckEnd - top;
      float neck = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0)) - nr + step(nr, 0.0005);
      float dr = b.z * (0.16 + 0.2 * u) * (1.0 - smoothstep(0.75, 1.0, v));
      float drop = length(p - tip) - dr + step(dr, 0.0005);
      di = smin(di, smin(neck, drop, 0.06 * b.z), 0.12 * b.z);
    }
    if (di < n1) { n2 = n1; id2 = id; n1 = di; id = i; }
    else if (di < n2) { n2 = di; id2 = i; }
    d = smin(d, di, k);
  }
  // The cursor is a blob too: goo reaches for it and holding grabs a bigger one.
  float mr = (0.012 + 0.07 * grab) * uInside * uMousePow * p_pull;
  float dm = length(p - m) - mr + step(mr, 0.002);
  d = smin(d, dm, 0.07 * uInside * uMousePow * p_pull + 0.001);
  // Click splash: droplets flung outward from the click point.
  if (uPulse.z > 0.01) {
    for (int j = 0; j < 7; j++) {
      float a = float(j) * 0.8976 + uPulse.x * 13.0;
      float sp = 0.18 + 0.2 * hash11(float(j) * 3.3 + uPulse.y);
      vec2 dp = uPulse.xy + vec2(cos(a), sin(a)) * sp * (1.0 - exp(-uPulse.w * 3.0)) - vec2(0.0, 0.12 * uPulse.w * uPulse.w);
      float dr = (0.028 - 0.007 * mod(float(j), 3.0)) * uPulse.z;
      float dd = length(p - dp) - dr + step(dr, 0.001);
      if (dd < n1) { n2 = n1; id2 = id; n1 = dd; id = 20.0 + float(j); }
      else if (dd < n2) { n2 = dd; id2 = 20.0 + float(j); }
      d = smin(d, dd, 0.04 * uPulse.z + 0.001);
    }
  }
  // Seams only between differently coloured blobs.
  float sameCol = step(length(blobColour(colourKey(id)) - blobColour(colourKey(id2))), 0.01);
  float seam = mix(n2 - n1, 9.0, sameCol);
  return vec4(d, id, seam, 0.0);
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 m = vec2(uMouse.x * uAspect, uMouse.y);
  if (p_mirror > 0.5) { p.x = 0.5 * uAspect - abs(p.x - 0.5 * uAspect); m.x = 0.5 * uAspect - abs(m.x - 0.5 * uAspect); }
  float hold = uHold.y > 0.5 ? uHold.x : uDown;
  float t = uTime * 0.25 * p_speed;
  float px = 1.5 / uRes.y;

  vec3 dark = lum(uPal[0]) < lum(uPal[1]) ? uPal[0] : uPal[1];
  vec3 pale = lum(uPal[0]) < lum(uPal[1]) ? uPal[1] : uPal[0];
  vec3 col = uPal[0];

  vec4 s = scene(p, t, m, hold);
  float d = s.x;

  if (p_style < 0.5) {
    // ---- Filled ----
    // Soft drop shadow under the goo.
    float sh = scene(p + vec2(-0.012, 0.016), t, m, hold).x;
    col = mix(col, col * 0.86, (1.0 - smoothstep(-0.002, 0.008, sh)) * 0.6);

    vec3 c = s.y >= 20.0 ? blobColour(floor(uPulse.y * 7.0)) : blobColour(s.y);
    // Light rim inside the edge and a glossy highlight toward the upper left.
    float hi = scene(p + vec2(0.016, -0.02), t, m, hold).x;
    float rim = smoothstep(-0.03, 0.0, d);
    c = mix(c, c * 0.8, rim * 0.5);
    float gl = (1.0 - smoothstep(-0.006, 0.006, d + 0.012)) * smoothstep(-0.004, 0.012, hi + 0.03) * (1.0 - smoothstep(-0.05, -0.02, d));
    c = mix(c, mix(c, pale, 0.65), gl * p_gloss);
    if (s.y < 20.0) {
      // A small glossy bean on the upper left of the nearest blob.
      vec3 b = blob(s.y, t);
      vec2 o = (p - b.xy - vec2(-0.42, 0.42) * b.z) / b.z;
      o = mat2(0.707, 0.707, -0.707, 0.707) * o;
      float spot = 1.0 - smoothstep(0.16, 0.2, length(o * vec2(1.0, 2.2)));
      c = mix(c, mix(c, pale, 0.8), spot * p_gloss * step(d, -0.004));
    }
    // Ink seams where different colours meet, outline around the whole shape.
    float seam = (1.0 - smoothstep(0.0, 0.004 + 0.006 * p_thickness, s.z)) * step(d, -0.002);
    float lineW = 0.0015 + 0.0045 * p_thickness;
    c = mix(c, dark, seam * 0.95);
    col = mix(col, c, 1.0 - smoothstep(-px, px, d));
    col = mix(col, dark, 1.0 - smoothstep(lineW - px, lineW + px, abs(d)));
  } else {
    // ---- Outline (bubble network) ----
    // Ground: a halftone of two accents in soft panels.
    float gn = snoise(p * 2.2 + uSeed * 30.0) * 0.5 + 0.5;
    vec3 g1 = paletteRamp(floor(p_hueShift * 4.0 + 0.5) * 0.25);
    vec3 g2 = paletteRamp(floor(p_hueShift * 4.0 + 0.5) * 0.25 + 0.25);
    vec2 hp = mat2(0.707, -0.707, 0.707, 0.707) * gl_FragCoord.xy / max(uRes.y / 900.0, 0.5);
    float dotR = 0.55 * gn;
    float hd = length(fract(hp / 6.0) - 0.5);
    vec3 ground = mix(mix(uPal[0], g1, 0.35), g1, smoothstep(dotR, dotR - 0.08, hd));
    ground = mix(ground, mix(ground, g2, 0.5), smoothstep(0.55, 0.75, snoise(p * 5.0 + 3.0)));
    col = ground;
    // Rings: every blob's own outline, merged where rings touch so webs form at the junctions.
    float k = 0.004 + 0.018 * p_softness;
    float w = 0.0015 + 0.005 * p_thickness;
    float rn = abs(d) - w;
    for (int j = 0; j < 16; j++) {
      float i = float(j);
      if (i >= p_count) break;
      vec3 b = blob(i, t);
      rn = smin(rn, abs(length(p - b.xy) - b.z) - w, k);
    }
    vec3 lc = paletteRamp(floor(p_hueShift * 4.0 + 0.5) * 0.25 + 0.5);
    if (abs(lum(lc) - lum(g1)) < 0.15) lc = dark;
    col = mix(col, mix(col, lc, 0.6), exp(-max(rn, 0.0) * 160.0) * 0.7);   // glow
    col = mix(col, lc, 1.0 - smoothstep(-px, px, rn));
    col = mix(col, mix(lc, dark, 0.35), (1.0 - smoothstep(-px, px, rn + w * 0.6)) * 0.6);
  }

  // Satellite dots and confetti.
  vec2 gp = p * 14.0 + vec2(0.0, t * 0.3);
  vec2 gi = floor(gp), gf = fract(gp);
  float hr = hash21(gi + uSeed * 17.0);
  if (hr < p_dots * 0.35) {
    vec2 o = 0.25 + 0.5 * hash22(gi + 7.0);
    float rr = 0.06 + 0.16 * hash21(gi + 3.0);
    float dd = length(gf - o) - rr;
    vec3 dc = blobColour(floor(hr * 97.0));
    float inDot = 1.0 - smoothstep(-0.02, 0.02, dd);
    float far = smoothstep(0.0, 0.02, d);
    col = mix(col, dc, inDot * far);
    col = mix(col, dark, (1.0 - smoothstep(0.0, 0.04, abs(dd))) * far * step(0.5, hash21(gi + 9.0)) * (1.0 - p_style));
  } else if (hr > 1.0 - p_dots * 0.12) {
    // Tiny confetti dashes.
    vec2 o = gf - 0.5;
    float a = hash21(gi + 5.0) * 3.14;
    o = mat2(cos(a), -sin(a), sin(a), cos(a)) * o;
    float dash = (1.0 - smoothstep(0.12, 0.16, abs(o.x))) * (1.0 - smoothstep(0.018, 0.035, abs(o.y)));
    col = mix(col, blobColour(floor(hr * 53.0)), dash * smoothstep(0.0, 0.02, d));
  }

  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.025;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export default {
  id: 'goo',
  name: 'Goo',
  engine: 'three',
  hint: 'Hover to pull the goo, hold to grab more, click to splash',
  params,
  controls: {
    essentials: ['count', 'size', 'style', 'drips'],
    form: ['softness', 'dots', 'thickness', 'mirror', 'gloss'],
    motion: ['speed'],
    interaction: ['pull'],
    colour: ['hueShift'],
  },
  presets: {
    'Candy pour': { count: 12, size: 1.1, style: 'Filled', drips: 0.8, dots: 0.7, gloss: 0.9 },
    'Bubble net': { count: 8, size: 0.9, style: 'Outline', mirror: true, softness: 0.8, thickness: 0.6, dots: 0.2 },
    'Big drops': { count: 5, size: 1.8, style: 'Filled', softness: 0.9, drips: 1, dots: 0.3 },
  },
  interactions: { hover: 'pulls the goo toward the cursor, grabbing a bigger blob while held', click: 'splashes droplets out of the cursor' },
  create(ctx) {
    const pulse = new THREE.Vector4(-10, -10, 0, 0);
    const hold = new THREE.Vector2(0, 1);
    const fs = createFullscreenShader(ctx, params, fragment, {
      extraUniforms: { uPulse: { value: pulse }, uHold: { value: hold } },
    });
    return {
      ...fs,
      frame(time, dt) {
        const p = ctx.pointer;
        const { w, h } = fs.stage.size;
        const d = Math.min(Math.max(dt || 0, 0), 0.1);
        if (p.justPressed && p.inside) {
          let x = p.x * (w / h);
          if (ctx.params.mirror) x = 0.5 * (w / h) - Math.abs(x - 0.5 * (w / h));
          pulse.set(x, 1 - p.y, ctx.state.motion.mouse, 0);
        }
        pulse.w += d;
        pulse.z *= Math.exp(-d * 0.8);
        hold.x += ((p.down && p.inside ? 1 : 0) - hold.x) * (1 - Math.exp(-d * 4));
        fs.frame(time);
      },
    };
  },
  code: (values, colors, seed) => shaderSketch({ id: 'goo', name: 'Goo', params, values, colors, seed, fragment }),
};
