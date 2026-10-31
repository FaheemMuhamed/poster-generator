// Warp Burst: a jump to light speed in flat poster colours (ref 72). Streaks of palette colour
// shoot out of a vanishing point in polar bins: fat painted bands, thinner trails and hairlines,
// each tapering toward the core and speckled with dots, with airbrush spray at their edges and
// a dark halo around a coloured core. The cursor drags the vanishing point; hold to go to
// hyperdrive (longer, faster streaks); click for a burst.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { shaderSketch } from '../../shared/codegen.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  count:     { value: 26, min: 6, max: 70, step: 1, label: 'Streak count' },
  thickness: { value: 0.8, min: 0.1, max: 1, step: 0.01, label: 'Streak thickness' },
  trail:     { value: 0.6, min: 0.1, max: 1, step: 0.01, label: 'Trail amount' },
  swirl:     { value: 0.35, min: -1.5, max: 1.5, step: 0.01, label: 'Swirl amount' },
  core:      { value: 0.06, min: 0, max: 0.16, step: 0.001, label: 'Core size' },
  dots:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Dot density' },
  specks:    { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Speck density' },
  softness:  { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Edge softness' },
  hueShift:  { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
  speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  pull:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Pull strength' },
};

const fragment = /* glsl */ `
uniform vec4 uPulse;  // click: xy point, z burst strength (decays), w seconds since the click
uniform vec2 uHold;   // x: eased press 0..1, y: 1 when the app drives it (otherwise uDown is used)
uniform vec3 uVP;     // xy: eased vanishing point (poster space), z: 1 when the app drives it
uniform vec2 uTravel; // x: distance travelled, y: 1 when the app drives it (otherwise uTime is used)

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Streak colour: mostly accents, sometimes the pale palette end (the cream bands in the ref).
vec3 streakColour(float h, vec3 pale) {
  if (h > 0.82) return pale;
  return paletteRamp(floor(h / 0.82 * 4.0) * 0.25 + floor(p_hueShift * 4.0 + 0.5) * 0.25 + floor(uSeed * 4.0) * 0.25);
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 m = vec2(uMouse.x * uAspect, uMouse.y);
  float hold = uHold.y > 0.5 ? uHold.x : uDown;
  vec2 home = vec2((0.38 + 0.24 * hash11(uSeed * 13.0 + 0.5)) * uAspect, 0.56 + 0.12 * hash11(uSeed * 7.0 + 0.2));
  vec2 vp = uVP.z > 0.5 ? uVP.xy : mix(home, m, uInside * min(uMousePow * p_pull, 1.0) * 0.85);
  float travel = uTravel.y > 0.5 ? uTravel.x : uTime * 0.12 * p_speed;
  float boost = clamp(hold * 0.8 + uPulse.z, 0.0, 2.0);

  vec3 dark = lum(uPal[0]) < lum(uPal[1]) ? uPal[0] : uPal[1];
  vec3 pale = lum(uPal[0]) < lum(uPal[1]) ? uPal[1] : uPal[0];

  vec2 d = p - vp;
  float r = length(d);
  float a = atan(d.y, d.x) + p_swirl * 0.7 * r * r; // curved, like the streaks in the ref
  float px = 1.5 / uRes.y;
  vec3 col = dark;
  float cover = 0.0;   // how much streak paint is here (for spray and dots)

  // Three layers: fat painted bands, medium trails, hairlines (drawn back to front).
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float N = max(3.0, floor(p_count * (fl == 0.0 ? 0.3 : fl == 1.0 ? 0.6 : 1.4)));
    float an = a / 6.2832 * N + fl * 0.37 + uSeed * 3.0;
    float cell = mod(floor(an), N); // ids stay stable across the -pi/pi seam
    float h1 = hash21(vec2(cell, fl * 7.0 + uSeed * 31.0));
    float h2 = hash21(vec2(cell + 3.3, fl * 5.0 + 1.7));
    float h3 = hash21(vec2(cell + 9.1, fl * 3.0 + 4.2));
    if (h3 > 0.93 - 0.25 * fl) continue; // gaps in the burst

    // The tail slides outward and accelerates; the streak reaches well past the poster edge.
    float z = fract(h2 + travel * (0.25 + 0.35 * h1) * (1.0 + 0.5 * fl));
    float tail = 0.015 + 0.9 * z * z;
    float len = (0.5 + 1.0 * h1 + 0.8 * boost) * p_trail * (0.35 + 2.0 * tail);
    float head = tail + len;
    float along = (r - tail) / max(len, 1e-4);
    if (along < -0.05 || along > 1.05) continue;

    // Width across the bin: a point at the tail, swelling toward the head, painterly wobble.
    float wf = p_thickness * (fl == 0.0 ? 0.75 + 0.25 * h3 : fl == 1.0 ? 0.35 + 0.3 * h3 : 0.07 + 0.1 * h3);
    float f = fract(an) - 0.5 + 0.05 * snoise(vec2(r * 7.0 - travel * 2.0, cell + fl * 10.0)) * (1.0 - 0.6 * fl);
    float w = wf * 0.5 * (0.12 + 0.88 * pow(clamp(along, 0.0, 1.0), 0.6));
    float across = abs(f) * 6.2832 / N * r;            // distance from the streak centre (poster units)
    // Wedges stop widening further out, so bands read as long strokes rather than pie slices.
    float cap = p_thickness * (fl == 0.0 ? 0.09 + 0.08 * h1 : fl == 1.0 ? 0.035 + 0.025 * h1 : 0.006);
    float half_ = min(w * 6.2832 / N * r, cap * (0.15 + 0.85 * pow(clamp(along, 0.0, 1.0), 0.6)));
    float hc = head - half_;
    float edge = r > hc ? length(vec2(across, r - hc)) - half_ : max(across - half_, tail - r); // round head
    float soft = px + p_softness * 0.01 * (0.2 + along);
    float m0 = 1.0 - smoothstep(-soft, soft, edge);

    vec3 c1 = streakColour(h1, pale);
    vec3 c2 = streakColour(fract(h1 + 0.37), pale);
    vec3 sc = mix(c1, c2, smoothstep(0.2, 0.9, along) * step(0.55, h2)); // some streaks change colour
    // Dots riding the band.
    if (fl < 1.5 && p_dots > 0.0) {
      vec2 dq = vec2(f * 6.2832 / N * r, r - travel * 0.05) * (28.0 + 10.0 * fl) / (0.4 + r);
      vec2 di = floor(dq);
      float dh = hash21(di + cell * 3.1 + fl);
      if (dh < p_dots * 0.35) {
        float dd = length(fract(dq) - 0.5) - (0.12 + 0.22 * hash21(di + 7.7));
        sc = mix(sc, streakColour(fract(dh * 13.1 + 0.5), pale), (1.0 - smoothstep(-0.05, 0.05, dd)) * step(0.15, along));
      }
    }
    col = mix(col, sc, m0);
    cover = max(cover, (1.0 - smoothstep(0.0, 0.05 + 0.04 * r, edge)) * step(0.0, along));
  }

  // Airbrush spray: fine specks around streak edges and drifting through the dark.
  vec2 sq = p * uRes.y / 2.0;
  float sh = hash21(floor(sq) + floor(travel * 30.0) * 0.0);
  float sprayZone = cover * (1.0 - smoothstep(0.0, 0.5, cover - 0.5)) * 0.8;
  if (sh < p_specks * (0.004 + 0.3 * sprayZone) * (0.5 + 0.8 * smoothstep(0.6, 0.0, r))) col = mix(col, pale, 0.9);
  // Larger stars streaming outward.
  vec2 st = vec2(a / 6.2832 * 90.0, log(r + 0.02) * 14.0 - travel * 6.0);
  vec2 si = floor(st);
  float sth = hash21(si + uSeed * 9.0);
  if (sth < p_specks * 0.06) {
    float sd = length((fract(st) - 0.5) * vec2(1.0, 0.6)) - 0.1 - 0.12 * hash21(si + 2.0);
    col = mix(col, streakColour(fract(sth * 17.0), pale), 1.0 - smoothstep(-0.04, 0.04, sd));
  }

  // Core: dark halo that swallows the streaks, then a coloured disc with a thin rim.
  float R = p_core * (1.0 + 0.4 * uPulse.z);
  if (R > 0.0) {
    float halo = 1.0 - smoothstep(R * 1.2, R * 2.6, r + 0.01 * snoise(vec2(a * 3.0, travel)));
    col = mix(col, dark, halo * 0.95);
    vec3 cc = streakColour(0.1, pale);
    vec3 rim = streakColour(0.6, pale);
    col = mix(col, rim, 1.0 - smoothstep(R * 1.08 - px, R * 1.08 + px, r));
    col = mix(col, cc, 1.0 - smoothstep(R - px, R + px, r));
  }

  // Click: a bright ring racing out of the core.
  float ring = uPulse.z * exp(-pow((r - uPulse.w * 1.1) * 18.0, 2.0));
  col = mix(col, pale, clamp(ring, 0.0, 1.0) * 0.6);

  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.03;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export default {
  id: 'warpburst',
  name: 'Warp Burst',
  engine: 'three',
  hint: 'Move to steer the vanishing point, hold for hyperdrive, click for a burst',
  darkGround: () => true, // the poster text switches to the light colour
  params,
  controls: {
    essentials: ['count', 'thickness', 'trail', 'core'],
    form: ['swirl', 'dots', 'specks', 'softness'],
    motion: ['speed'],
    interaction: ['pull'],
    colour: ['hueShift'],
  },
  presets: {
    'Light speed': { count: 40, thickness: 0.4, trail: 0.95, swirl: 0, core: 0.03, speed: 1.6 },
    'Paint burst': { count: 16, thickness: 0.9, trail: 0.7, swirl: 0.8, dots: 0.8, softness: 0.5 },
    'Comet': { count: 22, thickness: 0.6, trail: 0.5, swirl: -1.1, core: 0.1, specks: 0.9 },
  },
  interactions: { hover: 'steers the vanishing point; hold for hyperdrive', click: 'fires a burst from the core' },
  create(ctx) {
    const pulse = new THREE.Vector4(-10, -10, 0, 0);
    const hold = new THREE.Vector2(0, 1);
    const vp = new THREE.Vector3(0, 0, 0); // z stays 0 until the first frame sets a home
    const travel = new THREE.Vector2(0, 1);
    let lastTime = null;
    const fs = createFullscreenShader(ctx, params, fragment, {
      extraUniforms: { uPulse: { value: pulse }, uHold: { value: hold }, uVP: { value: vp }, uTravel: { value: travel } },
    });
    // Same home position as the shader's fallback, so the export and the live view agree.
    const fract = (x) => x - Math.floor(x);
    const hash11 = (q) => { q = fract(q * 0.1031); q *= q + 33.33; q *= q + q; return fract(q); };
    return {
      ...fs,
      frame(time, dt) {
        const p = ctx.pointer;
        const { w, h } = fs.stage.size;
        const aspect = w / h;
        const d = Math.min(Math.max(dt || 0, 0), 0.1);
        const seed = (ctx.state.seed % 1000) / 1000;
        const home = [(0.38 + 0.24 * hash11(seed * 13 + 0.5)) * aspect, 0.56 + 0.12 * hash11(seed * 7 + 0.2)];
        const pow = Math.min(ctx.state.motion.mouse * ctx.params.pull, 1) * 0.85;
        const target = p.inside ? [home[0] + (p.x * aspect - home[0]) * pow, home[1] + (1 - p.y - home[1]) * pow] : home;
        if (vp.z < 0.5) vp.set(target[0], target[1], 1);
        else {
          const k = 1 - Math.exp(-d * 3);
          vp.x += (target[0] - vp.x) * k;
          vp.y += (target[1] - vp.y) * k;
        }
        if (p.justPressed && p.inside) pulse.set(p.x * aspect, 1 - p.y, ctx.state.motion.mouse, 0);
        pulse.w += d;
        pulse.z *= Math.exp(-d * 1.6);
        hold.x += ((p.down && p.inside ? ctx.state.motion.mouse : 0) - hold.x) * (1 - Math.exp(-d * 3));
        // Travel integrates speed so hyperdrive and bursts never make the streaks jump.
        if (lastTime === null) travel.x = time * 0.12 * ctx.params.speed;
        else travel.x += d * 0.12 * ctx.params.speed * (1 + 2.5 * hold.x + 3 * pulse.z);
        lastTime = time;
        fs.frame(time);
      },
    };
  },
  code: (values, colors, seed) => shaderSketch({ id: 'warpburst', name: 'Warp Burst', params, values, colors, seed, fragment }),
};
