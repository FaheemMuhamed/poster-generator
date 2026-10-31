// Aerial Fields: farmland seen from a satellite (refs 4, 5). Voronoi parcels with crop rows and
// hedgerows fill the flat land, forested hills rise in shaded canopy, a meandering river with
// sandbanks winds through, and wisps of cloud drift over with their shadows on the ground.
// Everything is tinted from the palette: the coolest accent becomes water, the rest are crops.
// Hover parts the clouds and leans in, hold to descend, click sends a gust through the clouds.
import { createFullscreenShader } from '../../shared/fullscreenShader.js';
import { shaderSketch } from '../../shared/codegen.js';
import { THREE } from '../../shared/threeStage.js';

const params = {
  density:  { value: 1, min: 0.3, max: 3, step: 0.01, label: 'Field density' },
  scale:    { value: 1, min: 0.4, max: 2.5, step: 0.01, label: 'Map scale' },
  river:    { value: 1, min: 0, max: 2.5, step: 0.01, label: 'River thickness' },
  meander:  { value: 1, min: 0, max: 2, step: 0.01, label: 'Meander amount' },
  forest:   { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Forest amount' },
  clouds:   { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Cloud amount' },
  detail:   { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Crop detail' },
  contrast: { value: 1, min: 0, max: 2, step: 0.01, label: 'Relief contrast' },
  hueShift: { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
  speed:    { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  push:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Gust strength' },
};

const fragment = /* glsl */ `
uniform vec4 uPulse; // click: xy point (poster space), z strength (decays), w seconds since the click
uniform vec2 uHold;  // x: eased press 0..1, y: 1 when the app drives it (otherwise uDown is used)

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float fbm4(vec2 p) {
  return snoise(p) * 0.5 + snoise(p * 2.03 + 1.7) * 0.25 + snoise(p * 4.1 + 4.3) * 0.125 + snoise(p * 8.3 + 9.1) * 0.0625;
}

// Water = the coolest accent; crops = the others (and their in-betweens).
vec3 waterColour() {
  vec3 best = uPal[2];
  float bs = -9.0;
  for (int i = 2; i < 6; i++) {
    vec3 c = uPal[i];
    float s = c.b - 0.5 * (c.r + c.g) - 0.3 * abs(lum(c) - 0.4);
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}

// Terrain height (hills where high), with ridge-like valleys.
float terrain(vec2 p) {
  float h = fbm4(p * 1.3);
  h += 0.35 * (1.0 - abs(snoise(p * 2.6 + 7.0)));
  return h;
}

// Meandering river: distance to a warped centreline running down the poster (+ a tributary).
float riverDist(vec2 p, out float along) {
  float y = p.y;
  float mx = 0.5 * uAspect + p_meander * (0.22 * sin(y * 3.1 + uSeed * 20.0) + 0.1 * sin(y * 7.3 + 1.3 + uSeed * 9.0));
  mx += 0.07 * p_meander * fbm4(vec2(y * 2.0, uSeed * 5.0));
  float slope = p_meander * (0.68 * cos(y * 3.1 + uSeed * 20.0) + 0.73 * cos(y * 7.3 + 1.3 + uSeed * 9.0));
  float d = abs(p.x - mx) / sqrt(1.0 + slope * slope);
  // Tributary joining from the side.
  float ty = 0.35 + 0.3 * hash11(uSeed * 31.0);
  float tx = p.x;
  float ty2 = ty + 0.18 * (tx - mx) + 0.05 * sin(tx * 9.0 + uSeed * 4.0) * p_meander;
  float side = hash11(uSeed * 7.0) > 0.5 ? 1.0 : -1.0;
  float dt = side * (p.x - mx) > 0.0 ? abs(p.y - ty2) : 9.0;
  along = y;
  return min(d, dt * 1.6);
}

void main() {
  vec2 uv0 = vec2(vUv.x * uAspect, vUv.y);
  vec2 m = vec2(uMouse.x * uAspect, uMouse.y);
  float hold = uHold.y > 0.5 ? uHold.x : uDown;
  float t = uTime * 0.02 * p_speed;
  float mp = uInside * uMousePow;

  // Lean in: a soft magnifier under the cursor, deeper while held.
  vec2 dm = uv0 - m;
  float lens = exp(-dot(dm, dm) / (0.04 + 0.06 * hold)) * mp * (0.12 + 0.3 * hold);
  vec2 P = uv0 - dm * lens;

  vec2 so = vec2(uSeed * 37.0, uSeed * 61.0);
  vec2 g = (P - vec2(0.5 * uAspect, 0.5)) / p_scale + vec2(0.5 * uAspect, 0.5);
  vec2 wp = g + 0.035 * vec2(fbm4(g * 3.0 + so), fbm4(g * 3.0 + so + 5.0)); // wobbly land

  // ---- Ground ----
  float h = terrain(wp * 1.4 + so);
  float e = 0.004;
  vec2 grad = vec2(terrain((wp + vec2(e, 0.0)) * 1.4 + so) - h, terrain((wp + vec2(0.0, e)) * 1.4 + so) - h) / e;
  float shade = clamp(0.5 + dot(normalize(vec3(-grad * 0.06 * p_contrast, 1.0)), normalize(vec3(-0.6, 0.6, 0.5))) - 0.65 + 0.5, 0.0, 1.4);

  vec3 dark = lum(uPal[0]) < lum(uPal[1]) ? uPal[0] : uPal[1];
  vec3 pale = lum(uPal[0]) < lum(uPal[1]) ? uPal[1] : uPal[0];
  vec3 water = waterColour();

  // Parcels: voronoi cells, stretched a little along a drifting angle so plots look surveyed.
  float ang = 0.6 * snoise(wp * 0.6 + so) + uSeed * 6.28;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = rot * wp * vec2(17.0, 11.0) * p_density;
  vec2 ci = floor(q), cf = fract(q);
  float d1 = 9.0, d2 = 9.0;
  vec2 cid = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + 0.15 + 0.7 * hash22(ci + o + so) - cf;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = ci + o; } else if (d < d2) d2 = d;
  }
  float border = sqrt(d2) - sqrt(d1);
  float hc = hash21(cid + so);
  float hc2 = hash21(cid * 1.7 + 3.1);
  // Crops: neighbouring plots share a colour family that drifts across the land.
  float region = snoise(wp * 0.9 + so + 2.0) * 0.5 + 0.5;
  float t0 = uSeed + p_hueShift + region * 0.35;
  vec3 crop = paletteRamp(t0 + (hc - 0.5) * 0.18);
  crop *= 0.78 + 0.4 * hc2;
  if (hc > 0.9) crop = paletteRamp(t0 + 0.5) * (0.85 + 0.2 * hc2);           // a different crop
  crop = mix(crop, mix(crop, pale, 0.5), step(0.86, hc2) * step(hc, 0.9));  // ripe / pale plots
  crop = mix(crop, mix(crop, dark, 0.5), step(hc2, 0.1));                   // freshly ploughed
  // Crop rows in each plot, at their own angle.
  float ra = hc * 3.14;
  float rows = sin(dot(wp, vec2(cos(ra), sin(ra))) * (320.0 + 240.0 * hc2) * p_density);
  crop *= 1.0 - p_detail * 0.14 * smoothstep(-0.2, 0.9, rows);
  crop *= 0.94 + 0.1 * fbm4(wp * 40.0);
  // Hedgerows (lines of trees) between plots.
  vec3 forestCol = mix(dark, paletteRamp(t0 + 0.08), 0.55);
  float edgeL = 1.0 - smoothstep(0.01, 0.04, border);
  float hedge = (1.0 - smoothstep(0.03, 0.09, border)) * step(0.7, hash21(cid * 3.1 + so));
  vec3 ground = mix(crop, mix(crop, pale, 0.35), edgeL * 0.5);           // field tracks
  ground = mix(ground, forestCol, hedge * 0.75);

  // ---- River ----
  float along;
  float rd = riverDist(wp + 0.02 * vec2(fbm4(wp * 6.0), 0.0), along);
  float rw = 0.028 * p_river * (0.75 + 0.5 * snoise(vec2(along * 2.0, uSeed * 3.0)));

  // Forest on the higher ground and along the river banks: lumpy canopy with hillshade.
  float fl = 0.72 - p_forest * 0.9;
  float fz = h + 0.1 * snoise(wp * 16.0) + 0.5 * (1.0 - smoothstep(rw * 1.2, rw * 3.5 + 0.03, rd)) * p_forest;
  float forest = smoothstep(fl - 0.04, fl + 0.04, fz) * step(0.001, p_forest);
  // Tree crowns: bumpy cells lit from the upper left.
  vec2 crownSum = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    vec2 tq = wp * (95.0 + 40.0 * float(l)) + float(l) * 0.5 + 0.08 * vec2(snoise(wp * 40.0), snoise(wp * 40.0 + 7.0));
    vec2 tc = floor(tq);
    vec2 hr = hash22(tc + so + float(l) * 13.0);
    vec2 tf = fract(tq) - 0.5 - 0.4 * (hr - 0.5);
    float rr = 0.3 + 0.25 * hr.x;
    crownSum = max(crownSum, vec2(1.0 - smoothstep(rr * 0.3, rr, length(tf)), 1.0 - smoothstep(0.0, rr * 0.75, length(tf + vec2(0.14, -0.14)))) * step(0.15, hr.y));
  }
  float clump = snoise(wp * 22.0 + so) * 0.5 + 0.5;
  vec3 woods = forestCol * (0.5 + 0.3 * crownSum.x + 0.35 * crownSum.y) * (0.8 + 0.35 * clump);
  ground = mix(ground, woods, forest);
  ground *= mix(1.0, shade, 0.4 + 0.6 * forest);

  float wet = (1.0 - smoothstep(rw - 0.003, rw + 0.002, rd)) * step(0.001, p_river);
  // Sandbanks: pale bars hugging the inside of bends and islands mid-stream.
  float bar = smoothstep(0.25, 0.6, snoise(vec2(along * 7.0, 1.0) + so)) * smoothstep(rw * 0.55, rw * 0.95, rd);
  float island = smoothstep(0.55, 0.65, snoise(vec2(along * 4.0 + 2.0, 0.5) + so)) * (1.0 - smoothstep(rw * 0.2, rw * 0.35, rd));
  vec3 sand = mix(pale, paletteRamp(t0 + 0.25), 0.25);
  vec3 river = mix(water * 0.62, mix(water, pale, 0.3), smoothstep(rw * 0.2, rw, rd));
  river += 0.07 * pale * snoise(vec2(along * 40.0 - uTime * 0.3 * p_speed, rd * 200.0)); // glints
  river = mix(river, sand, max(island, bar) * 0.85);
  vec3 col = mix(ground, river, wet);

  // ---- Clouds and their shadows ----
  vec2 wind = vec2(t * 1.6, -t * 0.7);
  // Click gust pushes the clouds outward from the click.
  vec2 dc = P - uPulse.xy;
  float gust = uPulse.z * exp(-pow((length(dc) - uPulse.w * 0.5) * 6.0, 2.0));
  vec2 cp = P + wind + normalize(dc + 1e-4) * gust * -0.08;
  float clear = exp(-dot(dm, dm) / 0.05) * mp * p_push * (0.6 + 0.4 * hold); // cursor parts the clouds
  float cov = p_clouds * 1.3 - 0.75 - clear * 0.9;
  float cn = fbm4(cp * 1.6 + so + 0.25 * vec2(fbm4(cp * 3.0 + t), fbm4(cp * 3.0 - t)));
  float cloud = smoothstep(0.0, 0.45, cn + cov) * step(0.001, p_clouds);
  float wisp = smoothstep(-0.1, 0.5, fbm4(cp * vec2(6.0, 2.5) + so) + cov) * 0.35 * step(0.001, p_clouds);
  vec2 sp = cp + vec2(0.05, -0.06);
  float sn = fbm4(sp * 1.6 + so + 0.25 * vec2(fbm4(sp * 3.0 + t), fbm4(sp * 3.0 - t)));
  float shadow = smoothstep(0.0, 0.5, sn + cov) * step(0.001, p_clouds);
  col *= 1.0 - 0.45 * shadow;
  col = mix(col, pale, clamp(cloud * 0.95 + wisp * (1.0 - cloud), 0.0, 1.0) * (0.85 + 0.15 * cn));

  // Atmospheric haze toward the water colour, a slight vignette.
  col = mix(col, mix(water, pale, 0.5), 0.08);
  vec2 vq = vUv - 0.5;
  col *= 1.0 - 0.35 * dot(vq, vq);
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.03;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export default {
  id: 'aerial',
  name: 'Aerial Fields',
  engine: 'three',
  hint: 'Hover to part the clouds, hold to descend, click for a gust',
  params,
  controls: {
    essentials: ['density', 'river', 'forest', 'clouds'],
    form: ['scale', 'meander', 'detail', 'contrast'],
    motion: ['speed'],
    interaction: ['push'],
    colour: ['hueShift'],
  },
  presets: {
    'Patchwork': { density: 1.6, forest: 0.3, clouds: 0.25, river: 0.8 },
    'Wild valley': { density: 0.7, forest: 0.85, meander: 1.6, river: 1.6, clouds: 0.4 },
    'Overcast': { density: 1.1, clouds: 0.85, contrast: 1.4, scale: 0.7 },
  },
  interactions: { hover: 'parts the clouds and leans in, deeper while held', click: 'sends a gust through the clouds' },
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
        if (p.justPressed && p.inside) pulse.set(p.x * (w / h), 1 - p.y, ctx.state.motion.mouse * ctx.params.push, 0);
        pulse.w += d;
        pulse.z *= Math.exp(-d * 0.9);
        hold.x += ((p.down && p.inside ? 1 : 0) - hold.x) * (1 - Math.exp(-d * 3));
        fs.frame(time);
      },
    };
  },
  code: (values, colors, seed) => shaderSketch({ id: 'aerial', name: 'Aerial Fields', params, values, colors, seed, fragment }),
};
