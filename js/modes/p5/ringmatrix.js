// Ring Matrix: a grid of concentric motifs that morphs across the poster, from filled nested
// squares to tidy rings, then breaks out of the grid into scattered outlines (ref 39).
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

// ---- small helpers (kept local so the mode is self-contained) ----
function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Smooth 3D value noise in 0..1.
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// Picks ground, line colour and the two tones of the gradient from the palette.
function pickColours(pal, dark) {
  const bg = rgb(pal.bg), ink = rgb(pal.ink);
  const ground = dark ? (lum(bg) < lum(ink) ? bg : ink) : bg;
  const fg = ground === bg ? ink : bg;
  const acc = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb);
  const ok = acc.filter((c) => Math.abs(lum(c) - lum(ground)) > 0.22);
  const A = ok[0] || fg;
  let B = fg, best = -1;
  for (const c of ok) {
    if (c === A) continue;
    const d = Math.hypot(c[0] - A[0], c[1] - A[1], c[2] - A[2]);
    if (d > best) { best = d; B = c; }
  }
  return { ground, fg, A, B };
}

const TONES = 48, SHADES = 4;

export default {
  id: 'ringmatrix',
  name: 'Ring Matrix',
  engine: 'p5',
  hint: 'Hover to pull cells back into order · click to send a morph wave',
  darkGround: (p) => p.darkGround, // the poster text switches to the light colour
  params: {
    cells:     { value: 15, min: 6, max: 34, step: 1, label: 'Cell count' },
    rings:     { value: 5, min: 2, max: 9, step: 1, label: 'Ring count' },
    order:     { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Order amount' },
    scatter:   { value: 1, min: 0, max: 2, step: 0.01, label: 'Scatter amount' },
    thickness: { value: 1, min: 0.4, max: 2.5, step: 0.01, label: 'Line thickness', unit: '×' },
    gap:       { value: 0.08, min: 0, max: 0.4, step: 0.01, label: 'Cell spacing' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    hover:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    hoverMode: { value: 'Order', options: ['Order', 'Disorder'], label: 'Hover effect' },
    darkGround:{ value: true, label: 'Dark ground' },
  },
  controls: {
    essentials: ['cells', 'order', 'scatter', 'rings'],
    form: ['thickness', 'gap'],
    motion: ['speed'],
    interaction: ['hover', 'hoverMode'],
    colour: ['darkGround'],
  },
  presets: {
    'Tidy': { order: 0.85, scatter: 0.5, rings: 6, speed: 0.5 },
    'Scattered': { order: 0.15, scatter: 1.7, cells: 18, thickness: 0.8 },
    'Bold': { cells: 9, rings: 4, thickness: 1.8, gap: 0.12 },
  },
  interactions: { hover: 'pulls nearby cells back into tidy rings (or scatters them)', click: 'sends a wave that morphs the motifs as it passes' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 1e6);
    const waves = [];
    let clock = 0;
    const cur = { x: 0.5, y: 0.5, k: 0 };

    // Colour lookup: TONES steps along the gradient × SHADES mixed toward the ground.
    let palKey = '', lut = [], fillLut = [], groundCss = '#000';
    function buildLut() {
      const pal = ctx.palette;
      const key = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.darkGround;
      if (key === palKey) return;
      palKey = key;
      const { ground, fg, A, B } = pickColours(pal, P.darkGround);
      const mid = mix(fg, mix(A, B, 0.5), 0.18);
      groundCss = css(ground);
      lut = []; fillLut = [];
      for (let i = 0; i < TONES; i++) {
        const t = i / (TONES - 1);
        const c = t < 0.45 ? mix(A, mid, smooth(0, 0.45, t)) : mix(mid, B, smooth(0.45, 0.85, t));
        for (let s = 0; s < SHADES; s++) lut.push(css(mix(c, ground, s * 0.17)));
        fillLut.push(css(mix(c, ground, 0.42)));
      }
    }

    // Outline of a rounded square: k = 0 is a square, k = 1 a circle.
    const shape = (c, x, y, r, k) => {
      if (k > 0.97) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
      else if (k < 0.03) c.rect(x - r, y - r, r * 2, r * 2);
      else c.roundRect(x - r, y - r, r * 2, r * 2, r * k);
    };

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        buildLut();
        clock += dt;
        const tt = clock * P.speed;
        c.fillStyle = groundCss;
        c.fillRect(0, 0, W, H);

        if (mouse.justPressed && mouse.inside) {
          waves.push({ x: mouse.x, y: mouse.y, t0: clock });
          if (waves.length > 6) waves.shift();
        }
        // Hover focus eases in and out so the effect doesn't snap.
        const target = mouse.inside && mPow > 0 ? 1 : 0;
        const ease = 1 - Math.pow(0.02, Math.max(dt, 0.016));
        cur.k += (target - cur.k) * ease;
        if (mouse.inside) { cur.x += (mouse.x - cur.x) * Math.min(1, ease * 2); cur.y += (mouse.y - cur.y) * Math.min(1, ease * 2); }

        // Grid geometry: square cells, centred, with a margin like a printed sheet.
        const cols = P.cells;
        const s = (W * 0.89) / cols;
        const rows = Math.max(1, Math.floor((H - W * 0.11) / s));
        const ox = (W - cols * s) / 2 + s / 2, oy = (H - rows * s) / 2 + s / 2;
        const asp = W / H;
        const half = s * 0.5 * (1 - P.gap);
        const hov = cur.k * mPow * P.hover;
        const lwBase = Math.max(0.6, s * 0.035) * P.thickness;
        const shift = (0.5 - P.order) * 0.9;

        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const h0 = hash(i, j, seed), h1 = hash(i, j, seed + 1), h2 = hash(i, j, seed + 2);
            const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
            const x0 = ox + i * s, y0 = oy + j * s;

            // Morph value: mostly left → right, a little top → bottom, broken up by drifting noise.
            let m = u * 0.9 + v * 0.25 - 0.08 + (noise3(u * 2.2 + seed % 97, v * 2.2, tt * 0.05) - 0.5) * 0.55 + shift;
            m += (h0 - 0.5) * 0.06;
            let dis = smooth(0.5, 0.82, m) * P.scatter;

            // Hover: tidy (or scatter) the cells around the cursor.
            if (hov > 0) {
              const dx = (x0 / W - cur.x) * asp, dy = y0 / H - cur.y;
              const f = Math.exp(-(dx * dx + dy * dy) / 0.02) * Math.min(1.5, hov);
              if (P.hoverMode === 'Order') { m += (0.38 - m) * Math.min(1, f); dis *= Math.max(0, 1 - f * 1.3); }
              else { m += (0.78 - m) * Math.min(1, f) * 0.8; dis += f * 1.2; }
            }
            // Click waves: a ring that pushes the morph forward as it passes.
            let pulse = 0;
            for (const wv of waves) {
              const age = clock - wv.t0;
              const R = age * 0.55;
              const dx = (x0 / W - wv.x) * asp, dy = y0 / H - wv.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              pulse += Math.exp(-((d - R) * (d - R)) / 0.004) * Math.max(0, 1 - age / 2.6);
            }
            m += pulse * 0.45;
            const mc = Math.min(1, Math.max(0, m));

            // Shape: squares at the start, circles in the middle, squares again at the far end.
            const sq = Math.max(1 - smooth(0.14, 0.26, m), smooth(0.84, 0.94, m));
            const k = 1 - sq;
            const filled = 1 - smooth(0.16, 0.3, m);
            const n = Math.max(1, Math.round((P.rings + (h1 < 0.3 ? -1 : 0)) * (1 - smooth(0.5, 0.8, m) * 0.85)));
            const tone = Math.min(TONES - 1, Math.max(0, Math.round(mc * (TONES - 1) + (h2 - 0.5) * 4)));

            // Disorder: the cell drifts out of the grid and shrinks or grows.
            const jx = (noise3(i * 0.7, j * 0.7, tt * 0.12 + seed % 31) - 0.5) * 2;
            const jy = (noise3(i * 0.7 + 40, j * 0.7, tt * 0.12 + seed % 31) - 0.5) * 2;
            const x = x0 + jx * dis * s * 0.42;
            const y = y0 + jy * dis * s * 0.42;
            const breathe = 1 + Math.sin(tt * 0.8 + h0 * 20) * 0.03 + pulse * 0.12;
            const R = half * breathe * (1 + (h1 - 0.5) * 0.5 * Math.min(1, dis));
            const lw = lwBase * (1 - Math.min(1, dis) * 0.55);

            if (filled > 0.02) {
              c.globalAlpha = filled;
              c.fillStyle = fillLut[tone];
              c.beginPath(); shape(c, x, y, R, k); c.fill();
              c.globalAlpha = 1;
            }
            // Concentric rings, each a slightly different shade.
            for (let q = 0; q < n; q++) {
              const f = n === 1 ? 1 : 1 - (q / n) * 0.86;
              const sh = Math.floor(hash(i * 13 + q, j, seed + 3) * SHADES * (1 - filled * 0.5));
              c.strokeStyle = lut[tone * SHADES + Math.min(SHADES - 1, sh)];
              c.lineWidth = Math.max(0.5, lw * (0.6 + hash(i, j * 7 + q, seed + 4) * 1.1) * (q === 0 ? 1.2 : 1));
              c.beginPath(); shape(c, x, y, Math.max(0.5, R * f - c.lineWidth * 0.5), k); c.stroke();
            }
            // Satellites: extra outlined shapes that only appear once the grid breaks up.
            const sat = Math.floor(Math.min(1, dis) * (1 + h2 * 3) + 0.15);
            for (let q = 0; q < sat; q++) {
              const a = hash(i, j, seed + 10 + q) * Math.PI * 2 + tt * 0.1 * (h0 - 0.5);
              const dd = s * (0.2 + hash(j, i, seed + 20 + q) * 0.45) * Math.min(1.4, dis);
              const rr = half * (0.15 + hash(i + q, j, seed + 30) * (sq > 0.5 ? 0.6 : 0.45));
              c.strokeStyle = lut[Math.min(TONES - 1, tone + q) * SHADES + (q % 2)];
              c.lineWidth = Math.max(0.5, lw * 0.75);
              c.beginPath(); shape(c, x + Math.cos(a) * dd, y + Math.sin(a) * dd, rr, k); c.stroke();
              if (k > 0.5 && hash(i, j, seed + 40 + q) < 0.35) { // tiny dot on some circles, like the reference
                c.beginPath(); c.arc(x + Math.cos(a) * dd + rr * 0.4, y + Math.sin(a) * dd, rr * 0.22, 0, Math.PI * 2); c.stroke();
              }
            }
          }
        }
        for (let q = waves.length - 1; q >= 0; q--) if (clock - waves[q].t0 > 3) waves.splice(q, 1);
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'ringmatrix', name: 'Ring Matrix', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Ring Matrix
// Every grid cell gets a "morph" value from its position plus noise.
// Low values: nested squares. Middle: concentric rings. High: the cell leaves the grid,
// loses rings and scatters into outlines, and the far end turns square again.
// One rounded rectangle does it all: corner radius 0 = square, radius = half size = circle.

const waves = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  noiseSeed(SEED);
  randomSeed(SEED);
}

function mousePressed() { waves.push({ x: mouseX, y: mouseY, t0: millis() / 1000 }); }

function draw() {
  const t = millis() / 1000 * params.speed;
  const ground = params.darkGround ? colors.ink : colors.bg;
  background(ground);
  noFill();

  const cols = params.cells, s = width * 0.89 / cols;
  const rows = floor((height - width * 0.11) / s);
  const ox = (width - cols * s) / 2 + s / 2, oy = (height - rows * s) / 2 + s / 2;
  const half = s * 0.5 * (1 - params.gap);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
      let x = ox + i * s, y = oy + j * s;
      // 1. Morph value: left → right plus drifting noise, shifted by "order".
      let m = u * 0.9 + v * 0.25 - 0.08 + (noise(u * 2.2, v * 2.2, t * 0.05) - 0.5) * 0.55 + (0.5 - params.order) * 0.9;
      // Hover tidies the cells under the cursor; click waves push the morph forward.
      m += (0.38 - m) * exp(-(sq(x - mouseX) + sq(y - mouseY)) / sq(width * 0.14)) * params.hover;
      for (const w of waves) {
        const age = millis() / 1000 - w.t0;
        m += exp(-sq(dist(x, y, w.x, w.y) - age * width * 0.55) / sq(width * 0.06)) * max(0, 1 - age / 2.6) * 0.45;
      }
      // 2. Shape and disorder from the morph value.
      const k = 1 - max(1 - smoothstep(0.14, 0.26, m), smoothstep(0.84, 0.94, m)); // roundness
      const dis = smoothstep(0.5, 0.82, m) * params.scatter;
      const n = max(1, round(params.rings * (1 - smoothstep(0.5, 0.8, m) * 0.85)));
      x += (noise(i * 0.7, j * 0.7, t * 0.12) - 0.5) * 2 * dis * s * 0.42;
      y += (noise(i * 0.7 + 40, j * 0.7, t * 0.12) - 0.5) * 2 * dis * s * 0.42;
      // 3. Colour: c1 → background tone → c3 along the morph.
      const tone = m < 0.45 ? lerpColor(color(colors.c1), color(colors.bg), smoothstep(0, 0.45, m))
                            : lerpColor(color(colors.bg), color(colors.c3), smoothstep(0.45, 0.85, m));
      stroke(tone);
      strokeWeight(max(0.6, s * 0.035) * params.thickness * (1 - min(1, dis) * 0.5));
      for (let q = 0; q < n; q++) {
        const r = half * (1 - q / n * 0.86);
        rect(x - r, y - r, r * 2, r * 2, r * k);
      }
      if (dis > 0.3) { // a satellite outline once the grid breaks up
        const a = noise(i, j) * TWO_PI * 2, r = half * 0.35;
        rect(x + cos(a) * s * 0.4 - r, y + sin(a) * s * 0.4 - r, r * 2, r * 2, r * k);
      }
    }
  }
}

const smoothstep = (a, b, x) => { const t = constrain((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
