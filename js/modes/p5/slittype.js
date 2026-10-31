// Slit Type: the title set big, then cut into thin strips that are offset, stretched, mirrored
// and smeared like a slit-scan photo (refs: a stretched, stair-stepped 'NO REQUESTS' and a
// sliced, repeated 'S').
// The title is drawn once into an offscreen canvas. Each strip then copies a slice of it back:
// a smooth warp decides which slice (where the warp's slope is small, one thin line is pulled
// over the whole strip, which is the smear; where it turns negative the slice flips).
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { fontCss, bodyCss } from '../../shared/typeLayer.js';

const TAU = Math.PI * 2;
const MAX_STRIPS = 200;
const SRC_MAX = 4096; // longest edge of the source canvas (keeps 6K exports light)

const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);

// Integer hash -> 0..1.
function hash2(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Largest setting of `str` in a box: word wraps over 1..maxLines lines.
function layoutTitle(c, T, str, boxW, boxH, maxLines) {
  str = str.trim() || ' ';
  c.font = fontCss(T, 100);
  const wOf = (s) => c.measureText(s).width || 1;
  const LH = 0.9;
  let best = null;
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
    const mw = Math.max(...lines.map(wOf));
    const size = Math.min((boxW / mw) * 100, boxH / (lines.length * LH));
    if (!best || size > best.size) best = { lines, size, lh: LH };
  }
  return best;
}

export default {
  id: 'slittype',
  name: 'Slit Type',
  engine: 'p5',
  ownsText: true,
  hint: 'Hover to smear the strips · click to scramble them',
  params: {
    direction: { value: 'Horizontal', options: ['Horizontal', 'Vertical'], label: 'Slit direction' },
    strips:    { value: 18, min: 4, max: 160, step: 1, label: 'Strip count' },
    stretch:   { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Stretch amount' },
    offset:    { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Offset amount' },
    pattern:   { value: 'Wave', options: ['Wave', 'Stairs', 'Random'], label: 'Offset pattern' },
    mirror:    { value: 0, min: 0, max: 1, step: 0.01, label: 'Mirror amount' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    smear:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Smear strength' },
    repeat:    { value: false, label: 'Repeat' },
    tint:      { value: 'Ink', options: ['Ink', 'Accent', 'Alternate'], label: 'Letter colour' },
    inverted:  { value: false, label: 'Inverted' },
    textSize:  { value: 0.8, min: 0.5, max: 1.5, step: 0.01, label: 'Text size', unit: '×' },
    tall:      { value: 2.5, min: 1, max: 8, step: 0.01, label: 'Letter stretch', unit: '×' },
    details:   { value: true, label: 'Small text' },
  },
  controls: {
    essentials: ['direction', 'strips', 'stretch', 'offset'],
    form: ['pattern', 'mirror', 'repeat'],
    motion: ['speed'],
    interaction: ['smear'],
    colour: ['tint', 'inverted'],
    type: ['textSize', 'tall', 'details'],
  },
  presets: {
    'Stretched': { direction: 'Horizontal', strips: 60, stretch: 0.85, offset: 0.22, pattern: 'Stairs', mirror: 0 },
    'Sliced': { direction: 'Vertical', strips: 7, stretch: 0.15, offset: 0.55, pattern: 'Random', inverted: true, repeat: true },
    'Smear': { direction: 'Vertical', strips: 120, stretch: 1, offset: 0.08, pattern: 'Wave', mirror: 0.2 },
  },
  interactions: { hover: 'smears the strips near the cursor into long streaks and drags them along', click: 'scrambles the strips, which then spring back into place' },

  create(ctx) {
    const P = ctx.params;

    // ---- Source: the title in white on a transparent canvas, plus tinted copies ----
    const src = document.createElement('canvas');
    const sg = src.getContext('2d');
    const tints = new Map(); // colour -> canvas
    let srcScale = 1;
    let block = { x0: 0, x1: 1, y0: 0, y1: 1 }; // the title's extent in the source
    let built = '';
    let dirty = true;
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) dirty = true; });

    function buildSource(W, H, dpr) {
      const T = ctx.state.text;
      srcScale = Math.min(dpr, SRC_MAX / Math.max(W, H));
      src.width = Math.max(1, Math.round(W * srcScale));
      src.height = Math.max(1, Math.round(H * srcScale));
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, src.width, src.height);
      const str = applyCase(String(T.lines.title || ''), T.textCase);
      const lay = layoutTitle(sg, T, str, W * 0.9 * P.textSize, H * 0.66 * P.textSize, 3);
      // Letters are drawn tall (ref: the stretched 'NO'), up to the box height.
      const blockH = lay.lines.length * lay.lh * lay.size;
      const sy = Math.max(1, Math.min(P.tall, (H * 0.66 * P.textSize) / blockH));
      const cy = H * 0.47;
      sg.font = fontCss(T, lay.size);
      const maxW = Math.max(...lay.lines.map((ln) => sg.measureText(ln).width));
      sg.setTransform(srcScale, 0, 0, srcScale * sy, 0, (cy - cy * sy) * srcScale);
      sg.textAlign = 'center';
      sg.textBaseline = 'middle';
      sg.fillStyle = '#fff';
      lay.lines.forEach((ln, i) => {
        const y = cy + (i - (lay.lines.length - 1) / 2) * lay.lh * lay.size;
        sg.fillText(ln, W / 2, y + lay.size * 0.04);
      });
      const pad = lay.size * 0.08;
      block = {
        x0: Math.max(0, W / 2 - maxW / 2 - pad), x1: Math.min(W, W / 2 + maxW / 2 + pad),
        y0: Math.max(0, cy - (blockH * sy) / 2 - pad), y1: Math.min(H, cy + (blockH * sy) / 2 + pad),
      };
      tints.clear();
      dirty = false;
    }
    function tinted(col) {
      let cv = tints.get(col);
      if (cv) return cv;
      cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      const g = cv.getContext('2d');
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = col;
      g.fillRect(0, 0, cv.width, cv.height);
      tints.set(col, cv);
      return cv;
    }

    // ---- Strip state: click kick (spring) and hover smear ----
    const off = new Float32Array(MAX_STRIPS), vel = new Float32Array(MAX_STRIPS), sm = new Float32Array(MAX_STRIPS);
    const flipK = new Float32Array(MAX_STRIPS); // click mirror, decays
    let lastDir = '';

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const dpr = p.pixelDensity();
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const T = ctx.state.text;
        const step = Math.min(dt, 1 / 30);
        const sig = [W, H, dpr, P.textSize, P.tall].join('|');
        if (dirty || sig !== built) { buildSource(W, H, dpr); built = sig; }

        const horiz = P.direction === 'Horizontal';
        if (lastDir !== P.direction) { off.fill(0); vel.fill(0); sm.fill(0); lastDir = P.direction; }
        const n = Math.max(1, Math.min(MAX_STRIPS, Math.round(P.strips)));
        const L = horiz ? H : W;      // across the strips
        const A = horiz ? W : H;      // along the strips
        const h = L / n;
        const s = srcScale;

        // ---- Colours ----
        const ground = P.inverted ? pal.ink : pal.bg;
        const ink = P.inverted ? pal.bg : pal.ink;
        const accent = pal.c1;
        const colA = P.tint === 'Accent' ? accent : ink;
        const colB = P.tint === 'Alternate' ? accent : colA;
        const texA = tinted(colA), texB = tinted(colB);

        // ---- Click: scramble every strip, then let it spring home ----
        if (mouse.justPressed && mouse.inside) {
          const k = Math.max(0.4, Math.min(2, mPow));
          for (let i = 0; i < n; i++) {
            vel[i] += (Math.random() - 0.5) * A * 9 * k;
            if (Math.random() < 0.3) flipK[i] = 1;
          }
        }
        // ---- Hover: strips near the cursor smear; cursor motion drags them ----
        const hov = mouse.inside && mPow > 0;
        const mAcross = (horiz ? mouse.y : mouse.x) * L;
        const mAlong = (horiz ? mouse.x : mouse.y) * A;
        const drag = (horiz ? mouse.vx : mouse.vy) * A;
        const R = L * 0.09 * Math.max(0.3, P.smear);
        for (let i = 0; i < n; i++) {
          const d = Math.abs((i + 0.5) * h - mAcross);
          const target = hov ? Math.max(0, 1 - d / R) * Math.min(1, mPow * P.smear) : 0;
          sm[i] += (target - sm[i]) * (1 - Math.exp(-step * (target > sm[i] ? 10 : 2.5)));
          if (hov && target > 0) vel[i] += drag * target * 14 * mPow;
          vel[i] += (-42 * off[i] - 7.5 * vel[i]) * step;
          off[i] += vel[i] * step;
          flipK[i] *= Math.exp(-step * 1.2);
        }

        c.save();
        c.fillStyle = ground;
        c.fillRect(0, 0, W, H);
        c.imageSmoothingEnabled = true;

        // Warp of the across-axis: slope 1 is a clean copy, near 0 a smear, below 0 a flip.
        const st = P.stretch;
        const f = 1.25;
        const ph = t * P.speed * 0.35;
        const amp = (1.7 * L) / (TAU * f);
        const warp = (d) => d + st * amp * Math.sin((TAU * f * d) / L + ph) * 0.9 + st * amp * 0.25 * Math.sin((TAU * 2.7 * d) / L - ph * 1.3);
        const slope = (d) => (warp(d + 0.5) - warp(d - 0.5));
        const q = Math.floor(t * P.speed * 1.5); // glitch epochs for the Random pattern

        for (let i = 0; i < n; i++) {
          const d = (i + 0.5) * h;
          let u = warp(d);
          let k = slope(d);
          // A few strips become pure single-line smears.
          if (hash2(i, Math.floor(t * P.speed * 0.4 + i * 0.37)) < st * 0.12) k *= 0.04;
          // Hover: pull the slice to the line under the cursor and thin it to a streak.
          if (sm[i] > 0.001) {
            u += (mAcross - u) * sm[i] * 0.85;
            k *= 1 - sm[i] * 0.97;
          }
          let sh = Math.abs(k) * h;
          sh = Math.max(1 / s, sh);
          const flipAcross = k < 0;

          // Offset along the strip.
          let o;
          if (P.pattern === 'Wave') o = Math.sin(i * 0.33 + t * P.speed * 0.9) * 0.5 + Math.sin(i * 0.11 - t * P.speed * 0.4) * 0.35;
          else if (P.pattern === 'Stairs') {
            const saw = ((i / n) * 3 + t * P.speed * 0.08) % 1;
            o = (saw - 0.5) * 1.4;
          } else {
            const a = hash2(i, q), b = hash2(i, q + 1);
            const fr = t * P.speed * 1.5 - q;
            const e = fr < 0.85 ? 0 : (fr - 0.85) / 0.15;
            o = ((a + (b - a) * e) - 0.5) * 1.6 * (hash2(i * 3, q) < 0.6 ? 1 : 0.15);
          }
          o = o * P.offset * A * 0.45 + off[i];
          const flipAlong = hash2(i * 7 + 3, Math.floor(t * P.speed * 0.25)) < P.mirror * 0.5 || flipK[i] > 0.5;

          // Source rect (clamped inside the source) and destination strip.
          const u0 = Math.max(0, Math.min(L - sh, u - sh / 2));
          const tex = i % 2 ? texB : texA;
          // Only the title's own segment is copied; with Repeat it tiles along the strip.
          const g0 = horiz ? block.x0 : block.y0, g1 = horiz ? block.x1 : block.y1;
          const gl = g1 - g0;
          const period = gl * 1.08 + A * 0.02;
          let k0 = 0, k1 = 0;
          if (P.repeat) { k0 = Math.floor((-o - g1) / period); k1 = Math.ceil((A - o - g0) / period); }
          for (let k = k0; k <= k1; k++) {
            const mid = g0 + gl / 2 + o + k * period;
            if (mid - gl / 2 > A || mid + gl / 2 < 0) continue;
            c.save();
            if (horiz) {
              c.translate(mid, d);
              c.scale(flipAlong ? -1 : 1, flipAcross ? -1 : 1);
              c.drawImage(tex, g0 * s, u0 * s, gl * s, sh * s, -gl / 2, -h / 2 - 0.25, gl, h + 0.5);
            } else {
              c.translate(d, mid);
              c.scale(flipAcross ? -1 : 1, flipAlong ? -1 : 1);
              c.drawImage(tex, u0 * s, g0 * s, sh * s, gl * s, -h / 2 - 0.25, -gl / 2, h + 0.5, gl);
            }
            c.restore();
          }
        }

        // ---- Small text in the corners, and the title once more, plain ----
        if (P.details && T.show) {
          const Ls = T.lines;
          const fs = Math.max(9, Math.min(W, H) * 0.024);
          const m = Math.min(W, H) * 0.05;
          c.font = bodyCss(T, fs);
          c.fillStyle = ink;
          c.textBaseline = 'alphabetic';
          const put = (str, x, y, align) => { str = applyCase(String(str || ''), T.textCase); if (str) { c.textAlign = align; c.fillText(str, x, y); } };
          put(Ls.subtitle, m, m + fs, 'left');
          put(Ls.date, W - m, m + fs, 'right');
          put(Ls.venue, m, H - m, 'left');
          put(Ls.footer, W - m, H - m, 'right');
          // The title, spaced wide across the foot (ref: 'N O   R E Q U E S T S').
          const title = applyCase(String(Ls.title || ''), T.textCase);
          if (title) {
            const ts = fs * 1.6;
            c.font = fontCss(T, ts);
            const chars = [...title];
            const tw = chars.reduce((a, ch) => a + c.measureText(ch).width, 0);
            const gap = chars.length > 1 ? Math.max(0, (W - m * 2 - tw) / (chars.length - 1)) : 0;
            const g = Math.min(gap, ts * 1.2);
            let x = W / 2 - (tw + g * (chars.length - 1)) / 2;
            c.textAlign = 'left';
            for (const ch of chars) { c.fillText(ch, x, H - m - fs * 1.9); x += c.measureText(ch).width + g; }
          }
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize(w, h, dpr) { stage.resize(w, h, dpr); },
      frame: stage.frame,
      onParam(key) {
        if (key === 'text') dirty = true;
        if (key === 'palette' || key === 'tint' || key === 'inverted') tints.clear();
      },
      dispose() { alive = false; stage.dispose(); src.width = src.height = 0; tints.clear(); },
    };
  },
};
