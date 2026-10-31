// Thread Burst: a closed, blobby ring packed with coloured beads, with hundreds of thin threads
// streaming out of it through a flow field to the frame, where more beads line the border (ref 56).
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
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function mulberry(a) {
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  return f;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const NCOL = 5;

// Beads packed along a closed blobby curve, in "shape units" (radius ≈ 1 around 0,0).
function makeShape(rng, beadSize, band) {
  const k = [2, 3, 5].map(() => [rng.range(0.04, 0.2), rng.range(0, 6.28)]);
  const sx = rng.range(0.85, 1.15), sy = rng.range(0.95, 1.25);
  const N = 900;
  const pts = [];
  let L = 0;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = 1;
    for (let q = 0; q < 3; q++) r += k[q][0] * Math.sin([2, 3, 5][q] * a + k[q][1]);
    const x = Math.cos(a) * r * sx, y = Math.sin(a) * r * sy;
    if (i) L += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
    pts.push({ x, y, l: L });
  }
  const br = 0.038 * beadSize;          // bead radius
  const d = br * 2 * 0.97;              // spacing along the curve
  const off = rng.range(0, 100);
  const beads = [];
  let j = 0;
  for (let s = 0; s < L; s += d) {
    while (j < N - 1 && pts[j + 1].l < s) j++;
    const p0 = pts[j], p1 = pts[j + 1];
    const tx = p1.x - p0.x, ty = p1.y - p0.y, tl = Math.hypot(tx, ty) || 1;
    let nx = ty / tl, ny = -tx / tl;
    if (nx * p0.x + ny * p0.y < 0) { nx = -nx; ny = -ny; }
    // Band width wanders along the ring; a few stretches drop out entirely.
    const u = s / L;
    const wn = noise3(u * 7 + off, 0.5, 0.5);
    if (wn < 0.16) continue;
    const w = 0.36 * band * (0.3 + 1.2 * (wn - 0.16));
    const rows = Math.max(1, Math.round(w / (d * 0.87)));
    // Colour patches: a slow regional colour with random beads mixed in.
    const region = Math.floor(noise3(u * 9 + off, 3.3, 1.7) * NCOL * 1.6) % NCOL;
    for (let r = 0; r < rows; r++) {
      const o = (r - (rows - 1) / 2) * d * 0.87;
      const shift = r % 2 ? d * 0.5 : 0;
      const sx2 = p0.x + (tx / tl) * shift + nx * o, sy2 = p0.y + (ty / tl) * shift + ny * o;
      beads.push({
        x: sx2, y: sy2, r: br * rng.range(0.8, 1.08),
        col: rng() < 0.6 ? region : Math.floor(rng() * NCOL),
        nx, ny, edge: rows === 1 ? (rng() < 0.5 ? 1 : -1) : r === rows - 1 ? 1 : r === 0 ? -1 : 0,
      });
    }
  }
  return { beads, br };
}

export default {
  id: 'threadburst',
  name: 'Thread Burst',
  engine: 'p5',
  hint: 'Hover to bend the threads · click to re-form the ring',
  darkGround: (p) => p.darkGround, // the poster text switches to the light colour
  params: {
    threads:   { value: 700, min: 50, max: 1400, step: 10, label: 'Thread count', rebuild: true },
    beadSize:  { value: 1, min: 0.5, max: 2, step: 0.01, label: 'Bead size', rebuild: true },
    band:      { value: 1, min: 0.3, max: 2, step: 0.01, label: 'Ring thickness', rebuild: true },
    curl:      { value: 0.65, min: 0, max: 2.5, step: 0.01, label: 'Curl amount' },
    thickness: { value: 1, min: 0.3, max: 3, step: 0.01, label: 'Thread thickness', unit: '×' },
    scale:     { value: 1, min: 0.5, max: 1.4, step: 0.01, label: 'Ring scale', unit: '×' },
    border:    { value: true, label: 'Border beads' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    hover:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Bend strength' },
    darkGround:{ value: true, label: 'Dark ground' },
  },
  controls: {
    essentials: ['threads', 'curl', 'beadSize', 'band'],
    form: ['thickness', 'scale', 'border'],
    motion: ['speed'],
    interaction: ['hover'],
    colour: ['darkGround'],
  },
  presets: {
    'Calm': { curl: 0.35, threads: 300, speed: 0.5 },
    'Wild': { curl: 1.8, threads: 900, thickness: 0.8 },
    'Chunky': { beadSize: 1.6, band: 1.4, threads: 320, thickness: 1.8 },
  },
  interactions: { hover: 'bends the threads around the cursor', click: 're-forms the ring into a new shape' },

  create(ctx) {
    const P = ctx.params;
    const r = ctx.rand;
    const seed = r.int(1, 1e6);

    let shape = makeShape(mulberry(seed), P.beadSize, P.band);
    let from = null; // positions to animate from after a click
    let morph = 1;
    let clock = 0;
    let lastPos = null; // bead positions drawn last frame (in px)

    // Each thread starts at an edge bead: outer edge beads stream outward, a few inner ones cross the hole.
    let threads = [];
    function pickThreads() {
      const outer = [], inner = [];
      shape.beads.forEach((b, i) => { if (b.edge > 0) outer.push(i); else if (b.edge < 0) inner.push(i); });
      const rr = mulberry(seed + 77);
      threads = Array.from({ length: P.threads }, () => {
        const inward = inner.length && rr() < 0.08;
        const list = inward ? inner : outer.length ? outer : inner;
        return { b: list[Math.floor(rr() * list.length)], inward, stop: rr() < 0.05 ? rr.range(12, 70) : 0, wob: rr.range(0.7, 1.3) };
      });
    }
    pickThreads();

    // Colours: four accents plus the light tone, pushed away from the ground if too close to it.
    let palKey = '', cols = [], groundCss = '#000', borderKey = '', borderBeads = [];
    function buildColours() {
      const pal = ctx.palette;
      const key = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.darkGround;
      if (key === palKey) return;
      palKey = key;
      const bg = rgb(pal.bg), ink = rgb(pal.ink);
      const ground = P.darkGround ? (lum(bg) < lum(ink) ? bg : ink) : bg;
      const fg = ground === bg ? ink : bg;
      groundCss = css(ground);
      cols = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb).map((c) => (Math.abs(lum(c) - lum(ground)) < 0.18 ? mix(c, fg, 0.45) : c));
      cols.push(mix(fg, cols[0], 0.15));
      cols = cols.map(css);
    }

    // Flow field: one angle per coarse grid cell, sampled bilinearly by the threads.
    const GW = 36;
    let GH = 50, field = new Float32Array(0);

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        buildColours();
        clock += dt;
        const tt = clock * P.speed;
        c.fillStyle = groundCss;
        c.fillRect(0, 0, W, H);

        // Click: a new shape; beads glide from where they were.
        if (mouse.justPressed && mouse.inside) {
          from = lastPos;
          shape = makeShape(mulberry(Math.floor(Math.random() * 1e9)), P.beadSize, P.band);
          pickThreads();
          morph = 0;
        }
        if (morph < 1) morph = Math.min(1, morph + dt / 1.4);
        if (morph >= 1 || (from && !from.length)) from = null;

        const S = Math.min(W, H * 0.78) * 0.32 * P.scale;
        const cx = W / 2, cy = H / 2;
        const unit = Math.min(W, H);
        const brPx = shape.br * S;

        // Bead positions in pixels (eased from the previous shape after a click).
        const beads = shape.beads;
        const bx = new Float32Array(beads.length), by = new Float32Array(beads.length), bs = new Float32Array(beads.length);
        for (let i = 0; i < beads.length; i++) {
          const b = beads[i];
          // A slow breathing wobble so the ring feels alive.
          const wob = 1 + Math.sin(tt * 0.6 + Math.atan2(b.y, b.x) * 3) * 0.012;
          let x = cx + b.x * S * wob, y = cy + b.y * S * wob, s = 1;
          if (from) {
            const k = easeInOut(Math.min(1, Math.max(0, morph * 1.6 - (i / beads.length) * 0.6)));
            const fi = i % (from.length || 1);
            const f = from.length ? [from.x[fi], from.y[fi]] : [cx, cy];
            x = f[0] + (x - f[0]) * k; y = f[1] + (y - f[1]) * k;
            if (i >= from.length) s = k;
          }
          bx[i] = x; by[i] = y; bs[i] = s;
        }
        lastPos = { x: bx, y: by, length: bx.length };

        // Flow field for this frame (in poster units, so it doesn't depend on resolution).
        GH = Math.max(8, Math.round(GW * H / W));
        if (field.length !== GW * GH * 2) field = new Float32Array(GW * GH * 2);
        const zt = tt * 0.05 + (seed % 100);
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const a = (noise3(i * 0.11, j * 0.11, zt) - 0.5) * Math.PI * 4;
            const o = (j * GW + i) * 2;
            field[o] = Math.cos(a); field[o + 1] = Math.sin(a);
          }
        }
        const sample = (x, y, out) => {
          const fx = Math.min(GW - 1.001, Math.max(0, (x / W) * (GW - 1)));
          const fy = Math.min(GH - 1.001, Math.max(0, (y / H) * (GH - 1)));
          const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
          const o00 = (j * GW + i) * 2, o10 = o00 + 2, o01 = o00 + GW * 2, o11 = o01 + 2;
          out[0] = (field[o00] * (1 - u) + field[o10] * u) * (1 - v) + (field[o01] * (1 - u) + field[o11] * u) * v;
          out[1] = (field[o00 + 1] * (1 - u) + field[o10 + 1] * u) * (1 - v) + (field[o01 + 1] * (1 - u) + field[o11 + 1] * u) * v;
        };

        // Border beads, recomputed only when the size changes.
        const inset = P.border ? brPx * 2.3 : 0;
        const bKey = `${W}|${H}|${brPx.toFixed(3)}|${P.border}`;
        if (bKey !== borderKey) { borderKey = bKey; borderBeads = P.border ? makeBorder(W, H, brPx) : []; }

        // ---- Threads, traced through the field and grouped by colour (one path each) ----
        const step = unit * 0.0085;
        const hov = mouse.inside ? mPow * P.hover : 0;
        const mx = mouse.x * W, my = mouse.y * H, sig = unit * 0.16;
        const v = [0, 0];
        const looseBeads = [];
        c.lineWidth = Math.max(0.5, unit * 0.0014 * P.thickness);
        c.lineJoin = 'round';
        c.globalAlpha = 0.85;
        for (let q = 0; q < NCOL; q++) {
          c.strokeStyle = cols[q];
          c.beginPath();
          for (let n = 0; n < threads.length; n++) {
            const th = threads[n];
            const b = beads[th.b];
            if (!b || b.col !== q) continue;
            let x = bx[th.b], y = by[th.b];
            // Heading: away from the centre (or across the hole for inner beads).
            let hx, hy;
            if (th.inward) { hx = -b.nx; hy = -b.ny; }
            else { hx = (x - cx) / S + b.nx; hy = (y - cy) / S + b.ny; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l; }
            let dx = hx, dy = hy;
            c.moveTo(x, y);
            const maxSteps = th.stop || 400;
            const curl = P.curl * th.wob;
            for (let s = 0; s < maxSteps; s++) {
              sample(x, y, v);
              let nx = hx + v[0] * curl, ny = hy + v[1] * curl;
              if (hov > 0) {
                // Swirl around the cursor and push a little outward.
                const ex = x - mx, ey = y - my;
                const d2 = ex * ex + ey * ey;
                const f = Math.exp(-d2 / (sig * sig)) * hov * 2.2;
                const d = Math.sqrt(d2) || 1;
                nx += (-ey / d + ex / d * 0.6) * f; ny += (ex / d + ey / d * 0.6) * f;
              }
              dx = dx * 0.8 + nx * 0.2; dy = dy * 0.8 + ny * 0.2;
              const l = Math.hypot(dx, dy) || 1;
              x += (dx / l) * step; y += (dy / l) * step;
              c.lineTo(x, y);
              if (x < inset || y < inset || x > W - inset || y > H - inset) break;
            }
            if (th.stop) looseBeads.push(x, y, q);
          }
          c.stroke();
        }
        c.globalAlpha = 1;

        // ---- Beads: ring, loose ends and border, one fill per colour ----
        for (let q = 0; q < NCOL; q++) {
          c.fillStyle = cols[q];
          c.beginPath();
          for (let i = 0; i < beads.length; i++) {
            if (beads[i].col !== q) continue;
            const rr = beads[i].r * S * bs[i];
            if (rr < 0.3) continue;
            c.moveTo(bx[i] + rr, by[i]); c.arc(bx[i], by[i], rr, 0, Math.PI * 2);
          }
          for (let i = 0; i < looseBeads.length; i += 3) {
            if (looseBeads[i + 2] !== q) continue;
            c.moveTo(looseBeads[i] + brPx, looseBeads[i + 1]); c.arc(looseBeads[i], looseBeads[i + 1], brPx, 0, Math.PI * 2);
          }
          for (const bb of borderBeads) {
            if (bb[3] !== q) continue;
            c.moveTo(bb[0] + bb[2], bb[1]); c.arc(bb[0], bb[1], bb[2], 0, Math.PI * 2);
          }
          c.fill();
        }
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    // Beads around the frame: one row all round, thicker clumps near the corners.
    function makeBorder(W, H, br) {
      const out = [];
      const d = br * 2 * 0.98;
      const rows = 4;
      for (let row = 0; row < rows; row++) {
        const m = br * 1.15 + row * d * 0.87;
        const per = 2 * (W + H - 4 * m);
        const n = Math.floor(per / d);
        for (let i = 0; i < n; i++) {
          let s = (i + (row % 2) * 0.5) * (per / n);
          let x, y;
          const w = W - 2 * m, h = H - 2 * m;
          if (s < w) { x = m + s; y = m; }
          else if ((s -= w) < h) { x = W - m; y = m + s; }
          else if ((s -= h) < w) { x = W - m - s; y = H - m; }
          else { s -= w; x = m; y = H - m - s; }
          // Extra rows only near corners (and a few random bumps along the sides).
          if (row > 0) {
            const cd = Math.min(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y)) / Math.min(W, H);
            const keep = Math.exp(-cd / 0.13) * 1.25 - row * 0.22 + (noise3(i * 0.09, row * 0.5, seed % 50) - 0.55) * 1.1;
            if (hash(i, row, seed) > keep) continue;
          }
          const u = s / per;
          const region = Math.floor(noise3(i * 0.05 + row * 0.2, 7.1, seed % 77) * NCOL * 1.6) % NCOL;
          const col = hash(i, row, seed + 5) < 0.55 ? region : Math.floor(hash(i, row, seed + 6) * NCOL);
          out.push([x, y, br * (0.85 + hash(i, row, seed + 7) * 0.2), col, u]);
        }
      }
      return out;
    }

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'threadburst', name: 'Thread Burst', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Thread Burst
// 1. A closed blobby curve (a circle with a few sine wobbles) is packed with beads.
// 2. From the outer beads, threads are traced step by step: each step heads away from the
//    centre, nudged by a Perlin-noise flow field, until it reaches the frame.
// 3. More beads line the border. Move the mouse to bend the threads; click for a new ring.

let beads = [], threads = [];
const palette = () => [colors.c1, colors.c2, colors.c3, colors.c4, colors.bg];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  makeRing();
}

function mousePressed() { randomSeed(millis()); makeRing(); }

function makeRing() {
  beads = []; threads = [];
  const k = [random(0.04, 0.2), random(TWO_PI), random(0.04, 0.2), random(TWO_PI)];
  const br = 0.038 * params.beadSize;
  for (let a = 0; a < TWO_PI; a += br * 1.9) {
    const r = 1 + k[0] * sin(2 * a + k[1]) + k[2] * sin(3 * a + k[3]);
    const w = noise(a) * 0.3 * params.band;          // band width varies around the ring
    const rows = max(1, round(w / (br * 1.7)));
    for (let row = 0; row < rows; row++) {
      const rr = r + (row - (rows - 1) / 2) * br * 1.7;
      beads.push({ x: cos(a) * rr, y: sin(a) * rr, col: floor(random(5)), outer: row === rows - 1 });
    }
  }
  const outer = beads.filter((b) => b.outer);
  for (let i = 0; i < params.threads; i++) threads.push(random(outer));
}

function draw() {
  background(params.darkGround ? colors.ink : colors.bg);
  const S = min(width, height * 0.78) * 0.3 * params.scale, cx = width / 2, cy = height / 2;
  const step = min(width, height) * 0.0085, t = millis() / 1000 * params.speed;

  // Threads
  noFill(); strokeWeight(max(0.5, min(width, height) * 0.0014 * params.thickness));
  for (const b of threads) {
    let x = cx + b.x * S, y = cy + b.y * S;
    const h = createVector(b.x, b.y).normalize();
    let d = h.copy();
    stroke(palette()[b.col]);
    beginShape();
    vertex(x, y);
    for (let s = 0; s < 300 && x > 0 && y > 0 && x < width && y < height; s++) {
      const a = (noise(x / width * 4, y / height * 4, t * 0.05) - 0.5) * TWO_PI * 2;
      const n = p5.Vector.add(h, createVector(cos(a), sin(a)).mult(params.curl));
      const m = createVector(x - mouseX, y - mouseY);                 // swirl around the mouse
      const f = exp(-m.magSq() / sq(width * 0.16)) * params.hover * 2;
      n.add(createVector(-m.y, m.x).normalize().mult(f));
      d.lerp(n, 0.2);
      x += d.copy().normalize().x * step; y += d.copy().normalize().y * step;
      vertex(x, y);
    }
    endShape();
  }

  // Beads on the ring
  noStroke();
  const br = 0.038 * params.beadSize * S;
  for (const b of beads) { fill(palette()[b.col]); circle(cx + b.x * S, cy + b.y * S, br * 2); }

  // Beads along the border
  if (params.border) {
    for (let x = br; x < width; x += br * 2) { fill(palette()[floor(noise(x) * 5)]); circle(x, br * 1.2, br * 2); circle(x, height - br * 1.2, br * 2); }
    for (let y = br; y < height; y += br * 2) { fill(palette()[floor(noise(y, 9) * 5)]); circle(br * 1.2, y, br * 2); circle(width - br * 1.2, y, br * 2); }
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
