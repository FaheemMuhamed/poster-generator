// Fold Lines: fine parallel lines draped over folded silk (refs 1, 2). A domain-warped height
// field bends the lines sideways and lights them: ridges catch bright, saturated light, valleys sink
// into shadow. "Spectrum" gives each line a palette colour in drifting clusters (ref 1);
// "Fragments" draws light lines on a deep accent ground, broken by accent dashes (ref 2).
// Hover presses a dent into the cloth, hold to gather it into a twist, click sends a ripple.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { shaderSketch } from '../../shared/codegen.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  count:     { value: 140, min: 40, max: 520, step: 1, label: 'Line count' },
  fold:      { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Fold amount' },
  direction: { value: 'Vertical', options: ['Vertical', 'Horizontal'], label: 'Direction' },
  colour:    { value: 'Spectrum', options: ['Spectrum', 'Fragments', 'Mono'], label: 'Colour mode' },
  scale:     { value: 1, min: 0.4, max: 3, step: 0.01, label: 'Fold scale' },
  detail:    { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Wrinkle detail' },
  thickness: { value: 0.45, min: 0.1, max: 0.9, step: 0.01, label: 'Line thickness' },
  contrast:  { value: 1, min: 0, max: 2, step: 0.01, label: 'Light contrast' },
  hueShift:  { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
  speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  push:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Push strength' },
};

const fragment = /* glsl */ `
uniform vec4 uPulse; // click: xy point (poster space), z strength (decays), w seconds since the click
uniform vec2 uHold;  // x: eased press 0..1, y: 1 when the app drives it (otherwise uDown is used)

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Cloth height in "line space": a = along the lines, b = across them.
// Long soft folds run across the lines, warped so they bunch, overturn and fade out in places.
float cloth(vec2 ab, float t, vec2 m, float k, float hold) {
  vec2 q = ab * p_scale;
  vec2 w = q + 0.45 * vec2(snoise(q * 0.7 + vec2(t, 3.1)), snoise(q * 0.7 + vec2(7.4, -t)));
  float env = smoothstep(-0.7, 0.5, snoise(vec2(q.x * 0.5 + 9.0, q.y * 0.6 - t * 0.5))); // calm vs folded areas
  // Waves running across the lines, bent and phase-shifted so each fold curls its own way.
  float h = sin(w.y * 6.5 + 2.2 * snoise(vec2(w.x * 1.1, w.y * 0.6 + t)) - t * 3.0) * (0.3 + 0.7 * env);
  h += 0.7 * snoise(vec2(w.x * 1.6 + 4.0, w.y * 2.6 + t)) * env;
  h += p_detail * 0.22 * snoise(vec2(w.x * 4.5, w.y * 8.0 - t * 2.0));
  h = sign(h) * pow(abs(h), 0.75); // rounder crests
  // Cursor: a dent with a ring of folds around it; holding twists the cloth into it.
  vec2 d = ab - m;
  float r2 = dot(d, d);
  float g = exp(-r2 / (0.035 + 0.03 * hold));
  h -= k * g * (0.45 + 0.6 * hold);
  h += k * 0.25 * sin(sqrt(r2) * 38.0 - 1.5) * exp(-r2 / 0.06);
  h += k * hold * 0.35 * sin(atan(d.y, d.x) * 3.0 + sqrt(r2) * 20.0) * g;
  return h;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 m = vec2(uMouse.x * uAspect, uMouse.y);
  float hold = uHold.y > 0.5 ? uHold.x : uDown;
  float t = uTime * 0.05 * p_speed;
  bool vert = p_direction < 0.5;
  vec2 so = vec2(uSeed * 41.0, uSeed * 23.0);

  // Line space: b runs across the lines, a along them.
  vec2 ab = vert ? vec2(p.x, p.y) : vec2(p.y, p.x);
  vec2 mab = vert ? m : m.yx;
  float k = uInside * uMousePow * p_push;

  // Click ripple travels through the cloth.
  float dcl = length(p - uPulse.xy);
  float ring = uPulse.z * exp(-pow((dcl - uPulse.w * 0.55) * 9.0, 2.0)) * sin(dcl * 45.0 - uPulse.w * 8.0);

  // Height and its gradient (finite differences) for lighting.
  float e = 0.004;
  vec2 c = ab + so;
  vec2 mc = mab + so;
  float h  = cloth(c, t, mc, k, hold) + 0.25 * ring;
  float hx = cloth(c + vec2(e, 0.0), t, mc, k, hold) + 0.25 * ring;
  float hy = cloth(c + vec2(0.0, e), t, mc, k, hold) + 0.25 * ring;
  vec2 grad = vec2(hx - h, hy - h) / e;

  // Lines are iso-lines of (across + fold * height): they slide sideways over every crest.
  float amp = 0.11 * p_fold;
  float sk = vert ? p_count / uAspect : p_count;
  float s = (c.x + amp * h) * sk;
  float id = floor(s);
  float f = fract(s);

  // Lighting: a raking light from the upper left, soft spec on the crests, deep valleys.
  vec3 n = normalize(vec3(-grad * amp * 4.0, 1.0));
  vec3 L = normalize(vert ? vec3(-0.45, 0.75, 0.5) : vec3(0.75, -0.45, 0.5));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 8.0);
  float lit0 = 0.2 + pow(diff, 1.4) * 1.45 + 0.15 * h;
  float light = clamp(mix(0.6, lit0, min(p_contrast, 1.0)) * (0.7 + 0.3 * p_contrast) + spec * 0.7 * p_contrast, 0.05, 1.7);
  float valley = smoothstep(0.0, -0.9, h);

  // Darker / lighter palette ends, whichever way round the palette is.
  vec3 dark = lum(uPal[0]) < lum(uPal[1]) ? uPal[0] : uPal[1];
  vec3 pale = lum(uPal[0]) < lum(uPal[1]) ? uPal[1] : uPal[0];

  // Line colour.
  float cl = snoise(vec2(c.x * 1.6 + h * 0.4, c.y * 0.5 - t * 0.6)) * 0.5 + 0.5;
  float r = hash11(id * 0.731 + uSeed * 13.0);
  vec3 lineCol;
  vec3 ground = dark;
  if (p_colour < 0.5) {
    // Spectrum: clusters of related colours, a few bright pale threads that flare on the crests.
    lineCol = paletteRamp(cl * 0.75 + (r - 0.5) * 0.28 + p_hueShift + uSeed);
    if (r > 0.9) lineCol = mix(lineCol, pale, 0.75);
  } else if (p_colour < 1.5) {
    // Fragments: pale lines on a deep accent ground, interrupted by accent dashes.
    vec3 acc = paletteRamp(p_hueShift + floor(uSeed * 4.0) * 0.25);
    ground = mix(dark, acc, 0.12 + 0.55 * pow(diff, 2.0) * min(p_contrast, 1.5) * (1.0 - valley));
    float along = ab.y * (7.0 + 6.0 * hash11(id * 1.9)) + hash11(id * 3.7) * 40.0;
    float dash = step(0.8 - 0.2 * smoothstep(0.3, 0.9, cl), hash21(vec2(id, floor(along))));
    lineCol = mix(pale, acc, dash);
    light = mix(0.75, light, 0.6);
  } else {
    // Mono: one accent, all the depth comes from the light.
    lineCol = paletteRamp(p_hueShift + floor(uSeed * 4.0) * 0.25);
    lineCol = mix(lineCol, pale, 0.15 * step(0.85, r));
  }

  // Line profile: lit lines swell, shadowed ones thin out. Anti-aliased with fwidth.
  float aa = length(vec2(1.0 + amp * grad.x, amp * grad.y)) * sk / uRes.y; // s per pixel (no derivatives needed)
  float wdt = clamp(p_thickness * (0.55 + 0.6 * light), 0.06, 0.95);
  float edge = abs(f - 0.5) * 2.0;
  float line = 1.0 - smoothstep(wdt - aa * 1.5, wdt + aa * 1.5, edge);
  line = mix(line, wdt, smoothstep(0.35, 0.9, aa)); // lines finer than a pixel blend to their average

  vec3 lit = lineCol * light;
  lit = mix(lit, pale, spec * 0.35 * p_contrast * step(p_colour, 1.5));
  vec3 col = mix(ground * (1.0 - 0.4 * valley), lit, line);
  col *= 1.0 - 0.3 * valley * min(p_contrast, 1.5);

  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.03;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export default {
  id: 'foldlines',
  name: 'Fold Lines',
  engine: 'three',
  hint: 'Hover to press the cloth, hold to twist it, click for a ripple',
  darkGround: () => true, // the poster text switches to the light colour
  params,
  controls: {
    essentials: ['count', 'fold', 'direction', 'colour'],
    form: ['scale', 'detail', 'thickness', 'contrast'],
    motion: ['speed'],
    interaction: ['push'],
    colour: ['hueShift'],
  },
  presets: {
    'Silk': { count: 260, fold: 1.2, direction: 'Vertical', colour: 'Spectrum', thickness: 0.4, contrast: 1.2 },
    'Blue satin': { count: 150, fold: 1.6, direction: 'Horizontal', colour: 'Fragments', scale: 1.3, thickness: 0.5 },
    'Fine drape': { count: 480, fold: 0.7, colour: 'Mono', detail: 0.1, contrast: 1.6 },
  },
  interactions: { hover: 'presses a dent into the cloth, twisting it while held', click: 'sends a ripple through the folds' },
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
        if (p.justPressed && p.inside) pulse.set(p.x * (w / h), 1 - p.y, ctx.state.motion.mouse, 0);
        pulse.w += d;
        pulse.z *= Math.exp(-d * 1.2);
        hold.x += ((p.down && p.inside ? 1 : 0) - hold.x) * (1 - Math.exp(-d * 4));
        fs.frame(time);
      },
    };
  },
  code: (values, colors, seed) => shaderSketch({ id: 'foldlines', name: 'Fold Lines', params, values, colors, seed, fragment }),
};
