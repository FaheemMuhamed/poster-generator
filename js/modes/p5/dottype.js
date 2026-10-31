// Dot Type: the title rebuilt from a regular grid of dots whose size follows the letters.
// "Perspective" adds a wave through the rows and an extruded trail of smaller dots running
// toward a drifting vanishing point (ref: white dot lettering on black). "Halftone" sets the
// letters in full, even dots over a noisy, many-coloured dot field (ref: PA/SSA/GE poster).
// The title is drawn once into a low-res mask; every frame each grid dot samples the mask at a
// displaced position (wave, cursor push, click ripples), so the dots stay on their rows.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { fontCss, bodyCss } from '../../shared/typeLayer.js';
import { p5Sketch } from '../../shared/codegen.js';

const TAU = Math.PI * 2;
const MS = 0.5; // mask px per CSS px
const ECHOES = 7;

const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Relative luminance of '#rrggbb', to choose the dark ground.
function lum(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16) || 0;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// 2D value noise (0..1) and a two-octave sum, for the halftone background.
function hashf(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hashf(xi, yi), b = hashf(xi + 1, yi), c = hashf(xi, yi + 1), d = hashf(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => noise(x, y) * 0.65 + noise(x * 2.1 + 17, y * 2.1 + 9) * 0.35;

// Largest setting of `str` in a box: word wraps over 1..maxLines lines; with `breakWords`,
// one long word may also be cut into chunks (PASSAGE -> PA / SSA / GE).
function layoutTitle(c, T, str, boxW, boxH, maxLines, breakWords) {
  str = str.trim() || ' ';
  c.font = fontCss(T, 100);
  const wOf = (s) => c.measureText(s).width || 1;
  const LH = 0.9;
  let best = null;
  const consider = (lines, penalty) => {
    const mw = Math.max(...lines.map(wOf));
    const size = Math.min((boxW / mw) * 100, boxH / (lines.length * LH));
    const score = size / penalty;
    if (!best || score > best.score) best = { lines, size, score, lh: LH };
  };
  const words = str.split(/\s+/);
  for (let L = 1; L <= Math.min(maxLines, words.length); L++) {
    const target = wOf(words.join(' ')) / L;
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const next = cur ? cur + ' ' + words[i] : words[i];
      if (cur && wOf(next) > target * 1.08 && lines.length < L - 1) { lines.push(cur); cur = words[i]; }
      else cur = next;
    }
    lines.push(cur);
    consider(lines, 1);
  }
  const flat = str.replace(/\s+/g, '');
  // Only a single long word is cut; titles with several words wrap at their spaces.
  for (let L = 2; breakWords && words.length === 1 && L <= maxLines; L++) {
    if (flat.length < L * 2) break;
    const n = Math.ceil(flat.length / L);
    const lines = [];
    for (let i = 0; i < flat.length; i += n) lines.push(flat.slice(i, i + n));
    consider(lines, 1.05);
  }
  return best;
}

export default {
  id: 'dottype',
  name: 'Dot Type',
  engine: 'p5',
  ownsText: true,
  hint: 'Hover to push the dots apart · click to send a ripple',
  params: {
    style:     { value: 'Perspective', options: ['Perspective', 'Halftone'], label: 'Style' },
    spacing:   { value: 9, min: 5, max: 22, step: 0.5, label: 'Dot spacing', unit: 'px' },
    dotSize:   { value: 1, min: 0.3, max: 1.5, step: 0.01, label: 'Dot size', unit: '×' },
    wave:      { value: 0.6, min: 0, max: 2, step: 0.01, label: 'Wave amount' },
    trail:     { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Trail amount' },
    noise:     { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Noise amount' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    push:      { value: 1, min: 0, max: 3, step: 0.01, label: 'Push strength' },
    dotColour: { value: 'Accents', options: ['Mono', 'Accents'], label: 'Dot colour' },
    inverted:  { value: false, label: 'Inverted' },
    textSize:  { value: 1, min: 0.5, max: 1.4, step: 0.01, label: 'Text size', unit: '×' },
    breakWords: { value: true, label: 'Break words' },
    details:   { value: true, label: 'Small text' },
  },
  controls: {
    essentials: ['style', 'spacing', 'dotSize', 'wave'],
    form: ['trail', 'noise'],
    motion: ['speed'],
    interaction: ['push'],
    colour: ['dotColour', 'inverted'],
    type: ['textSize', 'breakWords', 'details'],
  },
  presets: {
    'Extruded': { style: 'Perspective', spacing: 8, dotSize: 1.1, wave: 0.5, trail: 0.9, dotColour: 'Mono' },
    'Festival': { style: 'Halftone', spacing: 10, dotSize: 1, wave: 0.25, noise: 0.85, breakWords: true, dotColour: 'Accents' },
    'Liquid': { style: 'Perspective', spacing: 7, wave: 1.6, trail: 0.3, speed: 1.6 },
  },
  interactions: { hover: 'pushes the dots apart around the cursor', click: 'sends a ripple ring out from the click' },

  create(ctx) {
    const P = ctx.params;

    // ---- Title mask ----
    const mc = document.createElement('canvas');
    const mg = mc.getContext('2d', { willReadFrequently: true });
    let mw = 1, mh = 1, mask = new Float32Array(1);
    let built = '';
    let dirty = true;
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) dirty = true; });

    function buildMask(W, H) {
      const T = ctx.state.text;
      mw = Math.max(1, Math.ceil(W * MS)); mh = Math.max(1, Math.ceil(H * MS));
      mc.width = mw; mc.height = mh;
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.clearRect(0, 0, mw, mh);
      const str = applyCase(String(T.lines.title || ''), T.textCase);
      const half = P.style === 'Halftone';
      const lay = layoutTitle(mg, T, str, W * (half ? 0.8 : 0.86) * P.textSize, H * (half ? 0.8 : 0.7) * P.textSize, 3, P.breakWords);
      mg.setTransform(MS, 0, 0, MS, 0, 0);
      mg.font = fontCss(T, lay.size);
      mg.textBaseline = 'middle';
      mg.fillStyle = '#fff';
      const cy = H * (half ? 0.5 : 0.46);
      lay.lines.forEach((ln, i) => {
        const y = cy + (i - (lay.lines.length - 1) / 2) * lay.lh * lay.size + lay.size * 0.04;
        // Halftone sets the lines flush left (like the ref), Perspective centres them.
        if (half) { mg.textAlign = 'left'; mg.fillText(ln, W * 0.08, y); }
        else { mg.textAlign = 'center'; mg.fillText(ln, W / 2, y); }
      });
      const d = mg.getImageData(0, 0, mw, mh).data;
      mask = new Float32Array(mw * mh);
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] / 255;
      dirty = false;
    }
    // Bilinear mask lookup at CSS px.
    const maskAt = (x, y) => {
      const fx = x * MS - 0.5, fy = y * MS - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 >= mw - 1 || y0 >= mh - 1) return 0;
      const tx = fx - x0, ty = fy - y0, i = y0 * mw + x0;
      const a = mask[i] + (mask[i + 1] - mask[i]) * tx;
      const b = mask[i + mw] + (mask[i + mw + 1] - mask[i + mw]) * tx;
      return a + (b - a) * ty;
    };

    const ripples = []; // { x, y, t0 } (CSS px, seconds)
    const cur = { x: 0.5, y: 0.5, hov: 0 };

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const T = ctx.state.text;
        const step = Math.min(dt, 1 / 30);
        const sig = [W, H, P.textSize, P.style, P.breakWords].join('|');
        if (dirty || sig !== built) { buildMask(W, H); built = sig; }
        const half = P.style === 'Halftone';

        // ---- Colours: a dark ground by default ----
        const darkFirst = lum(pal.bg) < lum(pal.ink);
        let ground = darkFirst ? pal.bg : pal.ink, light = darkFirst ? pal.ink : pal.bg;
        if (P.inverted) [ground, light] = [light, ground];
        const acc = [pal.c1, pal.c2, pal.c3, pal.c4];
        const gl = lum(ground);
        const byContrast = acc.slice().sort((a, b) => Math.abs(lum(b) - gl) - Math.abs(lum(a) - gl));
        const mono = P.dotColour === 'Mono';
        // Letters: the light tone (Perspective) or the strongest accent (Halftone).
        const letterCol = half && !mono ? byContrast[0] : light;
        const fieldCols = mono ? [light] : acc.filter((a) => a !== letterCol);
        const echoCols = mono ? [light] : [byContrast[0], byContrast[1]];

        // ---- Interaction ----
        const now = performance.now() / 1000;
        if (mouse.justPressed && mouse.inside) {
          ripples.push({ x: mouse.x * W, y: mouse.y * H, t0: now });
          if (ripples.length > 5) ripples.shift();
        }
        for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > 3) ripples.splice(i, 1);
        cur.hov += ((mouse.inside ? 1 : 0) - cur.hov) * (1 - Math.exp(-step * 6));
        if (mouse.inside) { cur.x = mouse.x; cur.y = mouse.y; }
        const push = cur.hov * mPow * P.push;
        const mx = cur.x * W, my = cur.y * H;
        const RH = Math.min(W, H) * 0.16;
        const rippleV = Math.max(W, H) * 0.55, rippleW = Math.min(W, H) * 0.06;

        // ---- Grid ----
        const sp = P.spacing;
        const cols = Math.ceil(W / sp) + 1, rows = Math.ceil(H / sp) + 1;
        const ox = (W - (cols - 1) * sp) / 2, oy = (H - (rows - 1) * sp) / 2;
        const rMax = sp * 0.5 * P.dotSize;
        const ts = t * P.speed;
        const waveA = P.wave * sp * 2.2;
        // Vanishing point for the trail: drifts slowly around below the type.
        const vpx = W * (0.5 + 0.45 * Math.cos(ts * 0.17)), vpy = H * (0.5 + 0.55 * Math.sin(ts * 0.13 + 1));
        const nEcho = half ? 0 : Math.round(ECHOES * P.trail);
        const sStep = 0.045;

        const paths = new Map();
        const pathOf = (col) => { let pth = paths.get(col); if (!pth) { pth = new Path2D(); paths.set(col, pth); } return pth; };
        const letterPath = pathOf(letterCol);
        const nScale = 2.6 / Math.max(W, H);
        const minR = 0.35;

        for (let j = 0; j < rows; j++) {
          const gy = oy + j * sp;
          // Row wave: each row slides sideways on a travelling sine (letters ripple and lean).
          const wx = waveA * Math.sin((gy / H) * TAU * 1.4 - ts * 1.3);
          for (let i = 0; i < cols; i++) {
            const gx = ox + i * sp;
            let dx = 0, dy = 0, grow = 0;
            // Cursor push.
            if (push > 0.01) {
              const ex = gx - mx, ey = gy - my;
              const d2 = ex * ex + ey * ey;
              if (d2 < RH * RH) {
                const d = Math.sqrt(d2) || 1;
                const f = Math.pow(1 - d / RH, 2) * RH * 0.45 * push;
                dx += (ex / d) * f; dy += (ey / d) * f;
                grow -= f / RH;
              }
            }
            // Click ripples: a ring that pushes outward and swells the dots it passes.
            for (const rp of ripples) {
              const ex = gx - rp.x, ey = gy - rp.y;
              const d = Math.hypot(ex, ey) || 1;
              const age = now - rp.t0;
              const k = (d - age * rippleV) / rippleW;
              if (k > -3 && k < 3) {
                const g = Math.exp(-k * k) * Math.max(0, 1 - age / 3) * Math.max(0.3, Math.min(2, mPow));
                dx += (ex / d) * g * sp * 1.6; dy += (ey / d) * g * sp * 1.6;
                grow += g * 0.6;
              }
            }
            // Sample the letters where the wave says.
            const sx = gx - wx - dx * 0.4, sy = gy + waveA * 0.25 * Math.sin((gx / W) * TAU * 1.1 + ts) - dy * 0.4;
            const m = maskAt(sx, sy);
            const px = gx + dx, py = gy + dy;
            if (half) {
              if (m > 0.35) {
                const rr = rMax * (0.55 + 0.45 * smooth(0.35, 0.8, m)) * (1 + grow);
                if (rr > minR) { letterPath.moveTo(px + rr, py); letterPath.arc(px, py, rr, 0, TAU); }
                continue;
              }
              // Noisy colour field: blobs of large dots fading into fine ones.
              const nv = fbm(gx * nScale + ts * 0.05, gy * nScale - ts * 0.04);
              const amt = smooth(1 - P.noise * 0.55, 1.1 - P.noise * 0.25, nv);
              const rr = rMax * (0.1 + 0.95 * amt) * (1 + grow) * (P.noise > 0 ? 1 : 0);
              if (rr > minR) {
                const ci = Math.floor(noise(gx * nScale * 1.7 + 40, gy * nScale * 1.7 + ts * 0.03) * fieldCols.length * 1.6) % fieldCols.length;
                const pth = pathOf(fieldCols[ci]);
                pth.moveTo(px + rr, py); pth.arc(px, py, rr, 0, TAU);
              }
              continue;
            }
            // Perspective: a moving band of light changes dot size across the letters.
            const lightBand = 0.74 + 0.26 * Math.sin(((gx + gy) / Math.max(W, H)) * TAU * 0.9 - ts * 0.8);
            let rr = rMax * smooth(0.08, 0.75, m) * lightBand;
            let col = letterCol;
            if (rr < rMax * 0.25 && nEcho > 0) {
              // The trail: is this dot inside a copy of the letters shrunk toward the vanishing point?
              for (let e = 1; e <= nEcho; e++) {
                const f = 1 / (1 - e * sStep);
                const me = maskAt(vpx + (sx - vpx) * f, vpy + (sy - vpy) * f);
                if (me > 0.4) {
                  const fall = 1 - e / (nEcho + 1.5);
                  rr = Math.max(rr, rMax * 0.75 * fall * smooth(0.4, 0.9, me));
                  col = echoCols[e % echoCols.length];
                  break;
                }
              }
            }
            rr *= 1 + grow;
            if (rr > minR) { const pth = col === letterCol ? letterPath : pathOf(col); pth.moveTo(px + rr, py); pth.arc(px, py, rr, 0, TAU); }
          }
        }

        c.save();
        c.fillStyle = ground;
        c.fillRect(0, 0, W, H);
        // Field and trail first, letters on top.
        for (const [col, pth] of paths) if (col !== letterCol) { c.fillStyle = col; c.fill(pth); }
        c.fillStyle = letterCol;
        c.fill(letterPath);

        // ---- Small text ----
        if (P.details && T.show) {
          const L = T.lines;
          const fs = Math.max(9, Math.min(W, H) * 0.024);
          const m = Math.min(W, H) * 0.05;
          c.font = bodyCss(T, fs);
          c.fillStyle = light;
          c.textBaseline = 'alphabetic';
          const put = (s, x, y, align) => { s = applyCase(String(s || ''), T.textCase); if (s) { c.textAlign = align; c.fillText(s, x, y); } };
          if (half) {
            // A column of details top right, like a line-up.
            const lines = [L.date, L.subtitle, L.venue].filter(Boolean);
            lines.forEach((s, i) => put(s, W - m, m + fs * (1 + i * 1.25), 'right'));
            put(L.footer, W - m, H - m, 'right');
          } else {
            put(L.subtitle, m, m + fs, 'left');
            put(L.date, W - m, m + fs, 'right');
            put(L.venue, m, H - m, 'left');
            put(L.footer, W - m, H - m, 'right');
          }
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize(w, h, dpr) { stage.resize(w, h, dpr); },
      frame: stage.frame,
      onParam(key) { if (key === 'text') dirty = true; },
      dispose() { alive = false; stage.dispose(); mc.width = mc.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'dottype', name: 'Dot Type', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (Perspective style; no noise field or small text).
const SKETCH = String.raw`
// Dot Type
// The word is drawn once into an offscreen buffer (the mask). A regular grid of dots then
// reads the mask: the more ink under a dot, the bigger it is. Each row slides on a sine wave,
// a trail of smaller dots runs toward a vanishing point, the cursor pushes dots apart and a
// click sends a ripple ring out.

const WORD = 'DOT TYPE'; // change me
let mask, ripples = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  buildMask();
}

function buildMask() {
  mask = createGraphics(ceil(width / 2), ceil(height / 2)); // half resolution is plenty
  mask.pixelDensity(1);
  mask.background(0);
  mask.fill(255);
  mask.textStyle(BOLD);
  mask.textAlign(CENTER, CENTER);
  mask.textSize(10);
  const size = min((mask.width * 0.86) / mask.textWidth(WORD) * 10, mask.height * 0.5);
  mask.textSize(size);
  mask.text(WORD, mask.width / 2, mask.height * 0.46);
  mask.loadPixels();
}

// Brightness of the mask (0..1) at canvas position x, y.
function ink(x, y) {
  const mx = floor(x / 2), my = floor(y / 2);
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 0;
  return mask.pixels[(my * mask.width + mx) * 4] / 255;
}

function mousePressed() { ripples.push({ x: mouseX, y: mouseY, t: millis() / 1000 }); }

function draw() {
  const t = millis() / 1000 * params.speed, now = millis() / 1000;
  background(colors.ink);
  const sp = params.spacing, rMax = sp * 0.5 * params.dotSize, waveA = params.wave * sp * 2.2;
  const vpx = width * (0.5 + 0.45 * cos(t * 0.17)), vpy = height * (0.5 + 0.55 * sin(t * 0.13 + 1));
  const echoes = round(7 * params.trail), R = min(width, height) * 0.16;
  ripples = ripples.filter((r) => now - r.t < 3);

  for (let gy = 0; gy < height + sp; gy += sp) {
    const wx = waveA * sin(gy / height * TWO_PI * 1.4 - t * 1.3); // row wave
    for (let gx = 0; gx < width + sp; gx += sp) {
      let dx = 0, dy = 0;
      // Cursor push: dots near the mouse move away from it.
      const d = dist(gx, gy, mouseX, mouseY);
      if (d < R && d > 0) { const f = pow(1 - d / R, 2) * R * 0.45 * params.push; dx += (gx - mouseX) / d * f; dy += (gy - mouseY) / d * f; }
      // Ripples: a ring travelling outward from each click.
      for (const r of ripples) {
        const dr = dist(gx, gy, r.x, r.y) || 1, k = (dr - (now - r.t) * width * 0.55) / 40;
        const g = exp(-k * k) * (1 - (now - r.t) / 3);
        dx += (gx - r.x) / dr * g * sp * 1.6; dy += (gy - r.y) / dr * g * sp * 1.6;
      }
      const sx = gx - wx, sy = gy;
      let rr = rMax * constrain(ink(sx, sy) * 1.3, 0, 1);
      let c = colors.bg;
      // Trail: is this dot inside a copy of the word shrunk toward the vanishing point?
      for (let e = 1; rr < rMax * 0.25 && e <= echoes; e++) {
        const f = 1 / (1 - e * 0.045);
        if (ink(vpx + (sx - vpx) * f, vpy + (sy - vpy) * f) > 0.4) { rr = rMax * 0.75 * (1 - e / (echoes + 1.5)); c = e % 2 ? colors.c1 : colors.c2; }
      }
      if (rr > 0.4) { fill(c); circle(gx + dx, gy + dy, rr * 2); }
    }
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); buildMask(); }
`;
