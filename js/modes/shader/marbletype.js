// Marble Type: the title as huge letters filled with paper marbling (ref 57). Bands of palette
// colour are domain-warped into swirls, with dark veins between them and a faint print screen;
// the letters have frayed, dry-brush edges and sit on a dark felt ground.
// The marbling lives in a small persistent offset buffer: hover drags and swirls the paint
// (hold to swirl harder) and it slowly relaxes; click drops a new blob of paint that pushes rings outward.
import { createThreeStage, THREE } from '../../shared/threeStage.js';
import { shaderHeader, commonUniforms, updateCommonUniforms, FS_VERT } from '../../shared/fullscreenShader.js';
import { drawType, fontCss } from '../../shared/typeLayer.js';

const SIM = 256;      // long side of the marbling offset buffer (fixed, independent of dpr)
const MAX_TEX = 4096; // cap for the text texture's long side (huge PNG exports)

const params = {
  bands:      { value: 26, min: 4, max: 64, step: 1, label: 'Band count' },
  swirl:      { value: 1.1, min: 0, max: 2.5, step: 0.01, label: 'Swirl amount' },
  scale:      { value: 1.6, min: 0.5, max: 5, step: 0.01, label: 'Swirl scale' },
  detail:     { value: 0.6, min: 0, max: 1.5, step: 0.01, label: 'Detail' },
  veins:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Vein thickness' },
  fuzz:       { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Edge softness' },
  print:      { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Print amount' },
  layout:     { value: 'Stack', options: ['Stack', 'Words', 'Initial'], label: 'Layout' },
  size:       { value: 0.9, min: 0.4, max: 1.1, step: 0.01, label: 'Text size' },
  posterText: { value: true, label: 'Poster text' },
  flow:       { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
  smear:      { value: 1, min: 0, max: 3, step: 0.01, label: 'Smear strength' },
  background: { value: 'Dark felt', options: ['Dark felt', 'Paper'], label: 'Background' },
  felt:       { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Felt contrast' },
  hueShift:   { value: 0, min: 0, max: 1, step: 0.01, label: 'Hue shift' },
};

// Offset buffer: m(x) = x + offset(x) is where each pixel reads the marbling. Each step it is
// advected backwards by the cursor's drag + swirl (so paint really moves), and relaxes back slowly.
// A drop maps everything outside radius R outward (the classic marbling drop) and fills the inside
// with one colour (all inside pixels read the same point P).
const simFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uPos, uVel, uDropC, uDropP;
uniform float uAspect, uDrag, uSwirl, uRelax, uDropR;
void main() {
  vec2 A = vec2(uAspect, 1.0);
  vec2 d = (vUv - uPos) * A;
  float g = exp(-dot(d, d) / 0.012);
  vec2 u = (uVel * uDrag * 0.5 + vec2(-d.y, d.x) * uSwirl) * g / A; // uv units
  vec2 src = vUv - u;
  vec2 o = texture2D(uPrev, src).xy - u;
  if (uDropR > 0.0) {
    vec2 dc = (vUv - uDropC) * A;
    float r = length(dc);
    if (r < uDropR) o = uDropP - vUv;
    else {
      vec2 s = uDropC + dc * sqrt(1.0 - uDropR * uDropR / (r * r)) / A;
      o = texture2D(uPrev, s).xy + s - vUv;
    }
  }
  gl_FragColor = vec4(o * uRelax, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `
uniform sampler2D uText, uOff;   // text: R = title mask (soft), G = poster text
uniform vec3 uDark, uLight;      // darker / lighter of bg and ink

float fbm3(vec2 p) { return snoise(p) * 0.55 + snoise(p * 2.03 + 3.1) * 0.28 + snoise(p * 4.1 + 7.7) * 0.14; }

// Each band picks a palette accent; a few are ink or the light colour, like the white veins in marbling.
vec3 bandColor(float id) {
  float r = hash21(vec2(id * 0.731 + 1.3, uSeed * 13.0 + 0.7));
  float r2 = hash21(vec2(id * 1.913 + 7.1, uSeed * 3.0 + 4.2));
  vec3 c = paletteRamp(floor(r2 * 4.0) / 4.0 + p_hueShift);
  if (r < 0.07) c = uLight;
  else if (r < 0.12) c = mix(uDark, c, 0.35);
  else if (r < 0.22) c = paletteRamp(floor(r2 * 8.0) / 8.0 + 0.125 + p_hueShift); // in-between mixes
  return c;
}

vec3 marble(vec2 p, float t, out float vein) {
  vec2 q = p * p_scale + uSeed * vec2(41.0, 17.0);
  // A few steps along a turning flow stretch the bands into long curls, like a comb dragged through paint.
  for (int i = 0; i < 3; i++) {
    float a = snoise(q * 0.7 + vec2(t * 0.6, float(i) * 7.3 - t * 0.4)) * 3.1416 * (0.4 + 0.5 * p_swirl);
    q += 0.22 * p_swirl * vec2(cos(a), sin(a));
  }
  vec2 w1 = vec2(fbm3(q + vec2(0.0, t)), fbm3(q + vec2(5.2, 1.3 - t)));
  vec2 w2 = vec2(fbm3(q + 1.8 * w1 + vec2(1.7, 9.2 + t * 0.5)), fbm3(q + 1.8 * w1 + vec2(8.3, 2.8)));
  float s = q.y * 0.8 + q.x * 0.45 + p_swirl * (1.1 * w2.x + 0.45 * w1.y);
  s += p_detail * 0.1 * snoise(q * 5.0 + w2 * 3.0);
  float v = s * p_bands * 0.3;
  v += 0.7 * snoise(vec2(v * 0.35, 3.1 + uSeed * 9.0)); // uneven band widths
  float id = floor(v), f = fract(v);
  vec3 col = bandColor(id);
  col *= 0.88 + 0.16 * smoothstep(0.0, 1.0, f);      // slight shading across each band
  float vw = 0.03 + 0.2 * p_veins;
  vein = (1.0 - smoothstep(0.0, vw, f)) * step(0.35, hash11(id * 3.7 + uSeed));
  // Fine combed threads inside the wider bands.
  float th = fract(v * 3.0 + 0.3 * snoise(q * 9.0));
  vein = max(vein, (1.0 - smoothstep(0.0, 0.08, th)) * 0.35 * p_detail * step(0.6, hash11(id * 1.3 + 2.0)));
  return col;
}

void main() {
  vec2 P = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.04 * p_flow;
  bool paper = p_background > 0.5;
  vec3 ground = paper ? uPal[0] : uDark;
  vec3 fleck = paper ? uPal[1] : uLight;

  // Felt: mottled fibres and fine speckle.
  vec2 px = gl_FragCoord.xy;
  float mott = fbm3(P * 3.0 + uSeed * 7.0);
  float fib = snoise(vec2(P.x * 60.0 + snoise(P * 8.0) * 2.0, P.y * 200.0));
  float grain = hash21(floor(px / max(1.0, uRes.y / 900.0)));
  vec3 col = ground * (1.0 + p_felt * (0.12 * mott + 0.05 * fib));
  col = mix(col, fleck, p_felt * (0.03 + 0.03 * mott + 0.1 * grain * grain + 0.08 * step(0.985, grain) + 0.04 * smoothstep(0.3, 0.9, fib)));

  // Title mask with frayed dry-brush edges: the soft mask is thresholded against streaky noise.
  vec2 tuv = vUv;
  float m = texture2D(uText, tuv).r;
  if (m > 0.01) {
    float streak = snoise(vec2(P.x * 14.0, P.y * 110.0) + uSeed * 5.0) * 0.6 + snoise(P * 40.0) * 0.4;
    float rough = fbm3(P * 9.0 + 2.0);
    float th = 0.5 + p_fuzz * (0.36 * streak + 0.16 * rough);
    float a = smoothstep(th - 0.03, th + 0.03, m);
    if (a > 0.0) {
      vec2 off = texture2D(uOff, vUv).xy;
      vec2 mp = vec2((vUv.x + off.x) * uAspect, vUv.y + off.y);
      float vein;
      vec3 mc = marble(mp, t, vein);
      mc = mix(mc, uDark, vein * 0.85);
      // Print screen: a fine 45° dot screen and slight misregistration darken the paint like a riso.
      float cell = max(2.0, uRes.y / 340.0);
      vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px / cell;
      float dots = length(fract(g) - 0.5);
      float lum = dot(mc, vec3(0.299, 0.587, 0.114));
      float ink = smoothstep(0.3, 0.55, dots + lum * 0.25);
      mc = mix(mc, mc * 0.62, ink * p_print * 0.6);
      mc = mix(mc, uDark, p_print * 0.12 * step(0.94, hash21(floor(px / cell) + floor(t * 3.0))));
      // A frayed edge lets some felt show through the paint.
      col = mix(col, mc, a * (1.0 - 0.25 * p_fuzz * (1.0 - smoothstep(0.5, 0.85, m))));
    }
  }

  // Poster text (subtitle, date, …) in the light colour.
  float pt = texture2D(uText, vUv).g;
  col = mix(col, paper ? uPal[1] : uLight, pt);

  col += (hash21(px + 0.5) - 0.5) * 0.03;
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

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};
const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);
const maskPalette = (hex) => ({ bg: hex, ink: hex, c1: hex, c2: hex, c3: hex, c4: hex });

// Candidate line breaks for the title: whole words, letters stacked into rows, or just the initial.
function titleCandidates(title, layout) {
  if (layout === 'Initial') return [[[...title.replace(/\s+/g, '')][0] || 'M']];
  if (layout === 'Words') {
    const words = title.split(/\s+/).filter(Boolean);
    const out = [];
    for (let r = 1; r <= Math.min(words.length, 5); r++) {
      const per = Math.ceil(words.length / r), rows = [];
      for (let i = 0; i < words.length; i += per) rows.push(words.slice(i, i + per).join(' '));
      out.push(rows);
    }
    return out;
  }
  const chars = [...title.replace(/\s+/g, '')];
  const out = [];
  for (let r = 1; r <= Math.min(chars.length, 6); r++) {
    const per = Math.ceil(chars.length / r), rows = [];
    for (let i = 0; i < chars.length; i += per) rows.push(chars.slice(i, i + per).join(''));
    out.push(rows);
  }
  return out;
}

export default {
  id: 'marbletype',
  name: 'Marble Type',
  engine: 'three',
  ownsText: true,
  hint: 'Hover to swirl the marbling, hold to swirl harder, click to drop paint',
  params,
  controls: {
    essentials: ['bands', 'swirl', 'fuzz', 'layout'],
    form: ['scale', 'detail', 'veins', 'print'],
    motion: ['flow'],
    interaction: ['smear'],
    colour: ['background', 'felt', 'hueShift'],
    type: ['size', 'posterText'],
  },
  presets: {
    'Initial': { layout: 'Initial', bands: 22, swirl: 1.6, scale: 1.2, fuzz: 0.8 },
    'Fine combed': { bands: 40, swirl: 0.7, detail: 1.2, veins: 0.3, print: 0.7 },
    'Bold swirl': { bands: 8, swirl: 2.2, scale: 0.9, veins: 0.8, fuzz: 0.3 },
  },
  interactions: { hover: 'drags and swirls the marbling, harder while held', click: 'drops a blob of paint that pushes rings outward' },
  create(ctx) {
    const P = ctx.params;
    const stage = createThreeStage(ctx, { ortho: true, background: false });
    const renderer = stage.renderer;
    const geo = new THREE.PlaneGeometry(2, 2);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // ---- Text texture ----
    const canvas = document.createElement('canvas');
    const textTex = new THREE.CanvasTexture(canvas);
    textTex.minFilter = THREE.LinearFilter;
    textTex.generateMipmaps = false;

    const drawText = () => {
      const { w, h, dpr } = stage.size;
      const k = Math.min(dpr, MAX_TEX / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
      if (cw !== canvas.width || chh !== canvas.height) {
        canvas.width = cw; canvas.height = chh;
        textTex.dispose();
      }
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.filter = 'none';
      g.fillStyle = '#000';
      g.fillRect(0, 0, cw, chh);
      g.setTransform(k, 0, 0, k, 0, 0);
      g.globalCompositeOperation = 'lighter';
      const text = ctx.state.text;
      const raw = (text.lines.title || '').replace(/\\n/g, ' ').trim() || 'Marble';
      const title = applyCase(raw, text.textCase === 'As typed' ? 'UPPERCASE' : text.textCase);

      // Pick the line breaking that gives the biggest letters inside the box.
      const boxW = w * 0.86 * P.size, boxH = h * (P.posterText && text.show ? 0.56 : 0.8) * P.size;
      g.font = fontCss(text, 100, 900);
      const capH = Math.max(40, g.measureText('H').actualBoundingBoxAscent || 72);
      let best = null;
      for (const rows of titleCandidates(title, P.layout)) {
        const mw = Math.max(...rows.map((r) => g.measureText(r).width), 1);
        const lead = 1.22;
        const s = Math.min(boxW / mw, boxH / (capH * (rows.length * lead - (lead - 1)))) * 100;
        if (!best || s > best.s) best = { rows, s };
      }
      const s = best.s, ch = capH * s / 100, lead = ch * 1.22;
      const total = ch + lead * (best.rows.length - 1);
      g.font = fontCss(text, s, 900);
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#f00';
      g.filter = `blur(${(Math.min(w, h) * 0.011 * k).toFixed(2)}px)`;
      const cy = h * (P.posterText && text.show ? 0.445 : 0.5);
      best.rows.forEach((r, i) => g.fillText(r, w / 2, cy - total / 2 + ch + i * lead));
      g.filter = 'none';

      // The rest of the poster text in G (title removed: the marble letters are the title).
      if (P.posterText) drawType(g, w, h, { ...text, lines: { ...text.lines, title: '' }, color: 'ink' }, maskPalette('#0f0'));
      textTex.needsUpdate = true;
    };

    // ---- Marbling offset buffer ----
    const simU = {
      uPrev: { value: null }, uPos: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector2() },
      uDropC: { value: new THREE.Vector2() }, uDropP: { value: new THREE.Vector2() },
      uAspect: { value: 1 }, uDrag: { value: 0 }, uSwirl: { value: 0 }, uRelax: { value: 1 }, uDropR: { value: 0 },
    };
    const simMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: simFrag, uniforms: simU, depthTest: false });
    const simScene = new THREE.Scene();
    simScene.add(new THREE.Mesh(geo, simMat));
    let targets = null, simW = 0, simH = 0;
    const ensureSim = (w, h) => {
      const a = w / h;
      const nw = Math.round(a >= 1 ? SIM : SIM * a), nh = Math.round(a >= 1 ? SIM / a : SIM);
      if (targets && nw === simW && nh === simH) return; // dpr-only change: keep the paint
      targets?.forEach((t) => t.dispose());
      simW = nw; simH = nh;
      targets = [makeTarget(simW, simH), makeTarget(simW, simH)];
      renderer.setClearColor(0x000000, 0);
      for (const t of targets) { renderer.setRenderTarget(t); renderer.clear(); }
      renderer.setRenderTarget(null);
      simU.uAspect.value = a;
    };

    // ---- Display ----
    const uniforms = {
      ...commonUniforms(params),
      uText: { value: textTex }, uOff: { value: null },
      uDark: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: shaderHeader(params) + fragment, uniforms, depthTest: false,
    });
    stage.scene.add(new THREE.Mesh(geo, material));

    let alive = true, hold = 0, drop = null;
    document.fonts?.ready.then(() => alive && drawText());

    return {
      stage,
      resize(w, h, dpr) {
        stage.resize(w, h, dpr);
        ensureSim(w, h);
        drawText();
      },
      onParam(key) {
        if (['text', 'palette', 'layout', 'size', 'posterText'].includes(key)) drawText();
      },
      frame(time, dt) {
        const p = ctx.pointer;
        const d = Math.min(Math.max(dt || 0, 0), 0.1);
        const pow = ctx.state.motion.mouse * P.smear;
        if (p.justPressed && p.inside && pow > 0) {
          drop = { x: p.x, y: 1 - p.y, age: 0, R: 0.07 * Math.min(1.6, 0.5 + 0.5 * pow), px: p.x + 0.2 + Math.random() * 0.5, py: 1 - p.y + Math.random() * 0.4 };
        }
        if (d > 0) {
          hold += ((p.down && p.inside ? 1 : 0) - hold) * (1 - Math.exp(-d * 5));
          const on = p.inside ? pow : 0;
          simU.uPrev.value = targets[0].texture;
          simU.uPos.value.set(p.x, 1 - p.y);
          simU.uVel.value.set(p.vx, -p.vy);
          simU.uDrag.value = on * 0.5;
          simU.uSwirl.value = on * d * (0.6 + 4 * hold);
          simU.uRelax.value = Math.exp(-d * 0.05);
          simU.uDropR.value = 0;
          // The drop grows over a third of a second; radii of successive drops add in area.
          if (drop) {
            const a0 = Math.min(1, drop.age / 0.35);
            drop.age += d;
            const a1 = Math.min(1, drop.age / 0.35);
            simU.uDropR.value = drop.R * Math.sqrt(Math.max(0, a1 * a1 * (3 - 2 * a1) - a0 * a0 * (3 - 2 * a0)));
            simU.uDropC.value.set(drop.x, drop.y);
            simU.uDropP.value.set(drop.px, drop.py);
            if (a1 >= 1) drop = null;
          }
          renderer.setRenderTarget(targets[1]);
          renderer.render(simScene, camera);
          renderer.setRenderTarget(null);
          targets.reverse();
        }
        updateCommonUniforms(uniforms, ctx, params, time, stage.size);
        const c = ctx.state.colors;
        const darkFirst = lum(c.bg) <= lum(c.ink);
        uniforms.uDark.value.set(darkFirst ? c.bg : c.ink);
        uniforms.uLight.value.set(darkFirst ? c.ink : c.bg);
        uniforms.uOff.value = targets[0].texture;
        stage.render(time);
      },
      dispose() {
        alive = false;
        targets?.forEach((t) => t.dispose());
        textTex.dispose();
        simMat.dispose();
        stage.dispose();
      },
    };
  },
};
