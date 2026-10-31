// Cursor Crowd: the picture rebuilt from a crowd of mouse-pointer arrows (ref 15).
// A low-res sample gives a presence field (how far each spot is from the backdrop colour, or
// its darkness / lightness). On a jittered grid, arrows appear where presence is high, grow
// with it and overlap into a dense crowd; a few loose "flyers" drift around the edges, and an
// ordered (Bayer) dot dither fills the mid-tones. Arrows lean along the presence gradient.
// Each arrow is a little spring: the cursor makes nearby arrows turn to face it and back off,
// a click blasts them outward and they fly home, pointing the way they travel. Everything is
// drawn into a low-res buffer and scaled up without smoothing, for crisp screen pixels.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';

function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const lumHex = (hex) => lumOf(...rgbOf(hex));
const distHex = (a, b) => { const A = rgbOf(a), B = rgbOf(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const mixHex = (a, b, k) => {
  const A = rgbOf(a), B = rgbOf(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * k)},${Math.round(A[1] + (B[1] - A[1]) * k)},${Math.round(A[2] + (B[2] - A[2]) * k)})`;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function coverRect(sw, sh, W, H) {
  const sa = sw / sh, da = W / H;
  if (sa > da) { const w = sh * da; return [(sw - w) / 2, 0, w, sh]; }
  const h = sw / da;
  return [0, (sh - h) / 2, sw, h];
}

// The classic arrow pointer (12 × 19 screen pixels, tip at the origin, pointing up-left).
const ARROW = [[0, 0], [0, 16], [4, 12.3], [7, 18.6], [9.4, 17.6], [6.5, 11.3], [11.5, 11.3]];
const ACX = 4.6, ACY = 9.6;                       // roughly its centroid
const ARROW_DIR = Math.atan2(-ACY, -ACX);        // centroid → tip
// 4×4 Bayer matrix for the dot dither.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const GC = 120; // analysis grid columns

export default {
  id: 'cursors',
  name: 'Cursor Crowd',
  engine: 'p5',
  medium: 'image',
  hint: 'Hover to make the pointers turn and back off · click to scatter them',
  darkGround: (p) => p.ground === 'Ink', // the poster text switches to the light colour
  params: {
    size:     { value: 20, min: 8, max: 48, step: 1, label: 'Arrow size', unit: 'px' },
    density:  { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Density' },
    flow:     { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Flow amount' },
    pixel:    { value: 2, min: 1, max: 6, step: 1, label: 'Pixel size', unit: 'px' },
    angle:    { value: -40, min: -180, max: 180, step: 1, label: 'Angle', unit: '°' },
    outline:  { value: 1, min: 0, max: 2.5, step: 0.05, label: 'Outline thickness' },
    dots:     { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Dot amount' },
    texture:  { value: true, label: 'Ground texture' },
    speed:    { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
    flee:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    read:     { value: 'Subject', options: ['Subject', 'Dark', 'Light'], label: 'Map from' },
    contrast: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Contrast' },
    ground:   { value: 'Ink', options: ['Paper', 'Ink', 'Accent'], label: 'Ground' },
    swap:     { value: false, label: 'Swap colours' },
  },
  controls: {
    essentials: ['size', 'density', 'flow', 'pixel'],
    form: ['angle', 'outline', 'dots', 'texture'],
    motion: ['speed'],
    interaction: ['flee'],
    image: ['read', 'contrast'],
    colour: ['ground', 'swap'],
    type: [],
  },
  presets: {
    'Night swarm': { size: 13, density: 0.95, flow: 0.6, pixel: 2, dots: 0.8, ground: 'Ink' },
    'Big pointers': { size: 34, density: 0.5, pixel: 3, outline: 1.5, dots: 0.35, flow: 0.15 },
    'Clean vector': { pixel: 1, texture: false, dots: 0.25, outline: 0.8, swap: true },
  },
  interactions: { hover: 'pointers turn to face the cursor and back away from it', click: 'scatters the pointers, which fly back home' },

  create(ctx) {
    const P = ctx.params;
    const src = ctx.source;
    const seed = ctx.rand.int(1, 1e6);

    // ---------- Analysis: presence field + its gradient ----------
    const an = document.createElement('canvas');
    const anx = an.getContext('2d', { willReadFrequently: true });
    let GR = 0;
    let pres = null, tmp = null, gxA = null, gyA = null, halo = null;
    let anVer = -1, anW = 0, anH = 0, anAt = 0, anKey = '';

    function analyse(W, H) {
      const rows = Math.max(8, Math.round(GC * H / W));
      if (an.width !== GC || an.height !== rows) { an.width = GC; an.height = rows; }
      const [sx, sy, sw, sh] = coverRect(src.width, src.height, W, H);
      anx.imageSmoothingEnabled = true;
      anx.drawImage(src.canvas, sx, sy, sw, sh, 0, 0, GC, rows);
      const d = anx.getImageData(0, 0, GC, rows).data;
      const n = GC * rows;
      if (!pres || pres.length !== n) {
        pres = new Float32Array(n); tmp = new Float32Array(n); halo = new Float32Array(n);
        gxA = new Float32Array(n); gyA = new Float32Array(n);
      }
      GR = rows;
      const C = P.contrast;
      if (P.read === 'Subject') {
        // Backdrop colour = median of the border cells; presence = distance from it.
        const R = [], G = [], B = [];
        const push = (i) => { R.push(d[i * 4]); G.push(d[i * 4 + 1]); B.push(d[i * 4 + 2]); };
        for (let x = 0; x < GC; x++) { push(x); push((rows - 1) * GC + x); }
        for (let y = 1; y < rows - 1; y++) { push(y * GC); push(y * GC + GC - 1); }
        const med = (a) => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
        const mr = med(R), mg = med(G), mb = med(B);
        const hi = 0.05 + 0.42 * (1 - 0.85 * C);
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const dd = Math.hypot(d[o] - mr, d[o + 1] - mg, d[o + 2] - mb) / 255;
          tmp[i] = smooth(0.035, hi, dd);
        }
      } else {
        // Tone: contrast-stretched brightness (2nd–98th percentile).
        const hist = new Uint32Array(64);
        for (let i = 0; i < n; i++) {
          const L = lumOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
          tmp[i] = L;
          hist[Math.min(63, (L * 64) | 0)]++;
        }
        let acc = 0, lo = 0, hi = 1;
        for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc > n * 0.02) { lo = b / 64; break; } }
        acc = 0;
        for (let b = 63; b >= 0; b--) { acc += hist[b]; if (acc > n * 0.02) { hi = (b + 1) / 64; break; } }
        const span = Math.max(0.1, hi - lo), w = 0.5 - 0.4 * C;
        for (let i = 0; i < n; i++) {
          let v = (tmp[i] - lo) / span;
          if (P.read === 'Dark') v = 1 - v;
          tmp[i] = smooth(0.5 - w, 0.5 + w, v);
        }
      }
      // 3×3 blur, then a central-difference gradient (it steers the arrows).
      const at = (a, x, y) => a[(y < 0 ? 0 : y >= rows ? rows - 1 : y) * GC + (x < 0 ? 0 : x >= GC ? GC - 1 : x)];
      for (let y = 0; y < rows; y++) for (let x = 0; x < GC; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(tmp, x + dx, y + dy);
        pres[y * GC + x] = s / 9;
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < GC; x++) {
        const i = y * GC + x;
        gxA[i] = at(pres, x + 2, y) - at(pres, x - 2, y);
        gyA[i] = at(pres, x, y + 2) - at(pres, x, y - 2);
      }
      // A wide blur of presence (two box passes): the glow of dots around the figure.
      const r = 6;
      for (let y = 0; y < rows; y++) {
        let a = 0;
        for (let x = -r; x <= r; x++) a += at(pres, x, y);
        for (let x = 0; x < GC; x++) { tmp[y * GC + x] = a / (2 * r + 1); a += at(pres, x + r + 1, y) - at(pres, x - r, y); }
      }
      for (let x = 0; x < GC; x++) {
        let a = 0;
        for (let y = -r; y <= r; y++) a += at(tmp, x, y);
        for (let y = 0; y < rows; y++) { halo[y * GC + x] = a / (2 * r + 1); a += at(tmp, x, y + r + 1) - at(tmp, x, y - r); }
      }
    }
    const cellOf = (x, y, W, H) => {
      let cx = (x / W * GC) | 0, cy = (y / H * GR) | 0;
      cx = cx < 0 ? 0 : cx >= GC ? GC - 1 : cx;
      cy = cy < 0 ? 0 : cy >= GR ? GR - 1 : cy;
      return cy * GC + cx;
    };

    // ---------- Agents: one per jittered grid cell ----------
    let cols = 0, rows = 0, cs = 18, gridKey = '';
    let hx = new Float32Array(0), hy = new Float32Array(0);
    let ox = new Float32Array(0), oy = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0);
    let ang = new Float32Array(0), angSet = new Uint8Array(0);

    function layout(W, H) {
      cs = P.size;
      const nc = Math.ceil(W / cs) + 1, nr = Math.ceil(H / cs) + 1;
      const k = `${nc}x${nr}:${cs}:${W}x${H}`;
      if (k === gridKey) return;
      gridKey = k; cols = nc; rows = nr;
      const N = cols * rows;
      hx = new Float32Array(N); hy = new Float32Array(N);
      ox = new Float32Array(N); oy = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
      ang = new Float32Array(N); angSet = new Uint8Array(N);
      const x0 = (W - (cols - 1) * cs) / 2, y0 = (H - (rows - 1) * cs) / 2;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        hx[i] = x0 + (x + (hash(i, 1, seed) - 0.5) * 0.7) * cs;
        hy[i] = y0 + (y + (hash(i, 2, seed) - 0.5) * 0.7) * cs;
      }
    }

    // ---------- Pixel buffer ----------
    const buf = document.createElement('canvas');
    const bx = buf.getContext('2d');

    // One arrow: a thick outline pass, then the fill on top, so the outline sits outside.
    function arrow(c, x, y, a, size, fill, line, lw) {
      const k = size / 18.6;
      const r = a - ARROW_DIR;
      const co = Math.cos(r) * k, si = Math.sin(r) * k;
      c.beginPath();
      for (let j = 0; j < ARROW.length; j++) {
        const px = ARROW[j][0] - ACX, py = ARROW[j][1] - ACY;
        const X = x + px * co - py * si, Y = y + px * si + py * co;
        if (j) c.lineTo(X, Y); else c.moveTo(X, Y);
      }
      c.closePath();
      if (lw > 0) { c.strokeStyle = line; c.lineWidth = lw * 2; c.stroke(); }
      c.fillStyle = fill;
      c.fill();
    }

    const cur = { x: 0.5, y: 0.5, hov: 0 };

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        dt = Math.min(0.05, dt || 0);
        const spd = P.speed;

        // Picture changes (throttled for the webcam).
        const now = performance.now();
        const key = `${P.read}:${P.contrast}`;
        if (src.version !== anVer || W !== anW || H !== anH || key !== anKey) {
          if (src.kind !== 'webcam' || now - anAt > 40 || W !== anW || H !== anH || key !== anKey) {
            analyse(W, H);
            anVer = src.version; anW = W; anH = H; anAt = now; anKey = key;
          }
        }
        layout(W, H);
        const N = cols * rows;

        // Colours: flat ground, accent fill, contrasting outline, two dot colours.
        const bgDark = lumHex(pal.bg) < lumHex(pal.ink);
        const darkC = bgDark ? pal.bg : pal.ink, lightC = bgDark ? pal.ink : pal.bg;
        const ground = P.ground === 'Ink' ? pal.ink : P.ground === 'Accent' ? pal.c3 : pal.bg;
        const acc = [pal.c1, pal.c2, pal.c3, pal.c4].filter((h) => distHex(h, ground) > 70);
        if (acc.length < 2) acc.push(lumHex(ground) < 0.5 ? lightC : darkC, pal.c1);
        let fill = acc[0], line = acc[acc.length - 1];
        // Outline: the remaining accent that stands out against both the fill and the ground.
        let best = -1;
        for (const h of acc) {
          if (h === fill) continue;
          const dd = Math.min(distHex(h, fill), distHex(h, ground) * 1.2)
            + Math.abs(lumHex(h) - lumHex(ground)) * 120 + Math.abs(lumHex(h) - lumHex(fill)) * 150;
          if (dd > best) { best = dd; line = h; }
        }
        if (P.swap) [fill, line] = [line, fill];
        const dotA = acc.find((h) => h !== fill && h !== line) || line;
        const dotB = line;

        // Cursor (eased) and hover strength.
        cur.hov += ((ptr.inside ? 1 : 0) - cur.hov) * (dt > 0 ? Math.min(1, dt * 5) : 0);
        if (ptr.inside) { const k = dt > 0 ? Math.min(1, dt * 12) : 1; cur.x += (ptr.x - cur.x) * k; cur.y += (ptr.y - cur.y) * k; }
        const mx = cur.x * W, my = cur.y * H;
        const hover = cur.hov * mPow * P.flee;
        const R = Math.min(W, H) * 0.2;

        // Click: an outward blast; arrows fly and spring home.
        if (ptr.justPressed && ptr.inside && mPow > 0) {
          const cx = ptr.x * W, cy = ptr.y * H, reach = Math.min(W, H) * 0.55;
          const kick = Math.min(W, H) * 3.2 * Math.min(1.5, mPow);
          for (let i = 0; i < N; i++) {
            const dx = hx[i] + ox[i] - cx, dy = hy[i] + oy[i] - cy;
            const dd = Math.hypot(dx, dy) || 1;
            if (dd > reach) continue;
            const f = Math.pow(1 - dd / reach, 1.5) * kick * (0.6 + 0.8 * hash(i, 77, seed));
            const tw = (hash(i, 78, seed) - 0.5) * 0.8;
            vx[i] += (dx / dd + tw * -dy / dd) * f;
            vy[i] += (dy / dd + tw * dx / dd) * f;
          }
        }

        // Pixel buffer (or the canvas itself at pixel size 1).
        const px = Math.round(P.pixel);
        let g = c;
        if (px > 1) {
          const bw = Math.ceil(W / px), bh = Math.ceil(H / px);
          if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
          g = bx;
          g.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
        }
        g.save();
        g.fillStyle = ground;
        g.fillRect(0, 0, W, H);
        const unit = Math.max(1, px);

        // Ground texture: a fine diagonal weave.
        if (P.texture) {
          const st = unit * 3;
          g.strokeStyle = mixHex(ground, fill, 0.16);
          g.lineWidth = unit;
          g.beginPath();
          for (let k = -H; k < W; k += st) { g.moveTo(k, 0); g.lineTo(k + H, H); }
          g.stroke();
        }

        // Ordered dot dither in the mid-tones (the fringes of the figure, soft shadows).
        if (P.dots > 0) {
          const st = unit * 3;
          const ds = unit;
          const pathA = new Path2D(), pathB = new Path2D();
          let ix = 0;
          for (let y = st / 2, yi = 0; y < H; y += st, yi++) {
            ix = 0;
            for (let x = st / 2; x < W; x += st, ix++) {
              const ci = cellOf(x, y, W, H), v = pres[ci];
              const band = Math.max(smooth(0.04, 0.22, v), halo[ci] * 1.2) * (1 - smooth(0.3, 0.6, v));
              const th = BAYER[(yi & 3) * 4 + (ix & 3)];
              if (band * P.dots * 1.7 < th) continue;
              ((ix + yi) % 3 === 0 ? pathB : pathA).rect(x - ds / 2, y - ds / 2, ds, ds);
            }
          }
          g.fillStyle = dotA; g.fill(pathA);
          g.fillStyle = dotB; g.fill(pathB);
        }

        // Arrows.
        const base = P.angle * Math.PI / 180;
        const lw = P.outline * Math.max(unit * 1.1, cs * 0.1);
        const kS = 70, kD = 2 * Math.sqrt(kS) * 0.55;
        const flee = cs * 2.6 * hover;
        g.lineJoin = 'miter';
        g.miterLimit = 3;
        for (let i = 0; i < N; i++) {
          const h0 = hash(i, 3, seed);
          let x = hx[i], y = hy[i];
          const ci = cellOf(x, y, W, H);
          const v = pres[ci];
          // Who's drawn: the crowd where presence is high, rare big flyers elsewhere.
          const body = smooth(0.3, 0.65, v) * (0.2 + 0.9 * P.density);
          const flyer = (v > 0.04 || halo[ci] > 0.08) && v < 0.35 && hash(i, 4, seed) < 0.06 * (0.3 + P.density);
          const moving = Math.abs(vx[i]) + Math.abs(vy[i]) > 1 || Math.abs(ox[i]) + Math.abs(oy[i]) > 1;
          const show = h0 < body || flyer;
          if (!show && !moving) { angSet[i] = 0; continue; }

          // Spring physics: target offset = flee from the cursor.
          let tx = 0, ty = 0, near = 0;
          if (hover > 0.01) {
            const dx = x - mx, dy = y - my, dd = Math.hypot(dx, dy) || 1;
            if (dd < R * 1.6) {
              near = Math.pow(Math.max(0, 1 - dd / (R * 1.6)), 1.5);
              const f = dd < R ? Math.pow(1 - dd / R, 2) : 0;
              tx = dx / dd * flee * f; ty = dy / dd * flee * f;
            }
          }
          if (dt > 0) {
            vx[i] += ((tx - ox[i]) * kS - vx[i] * kD) * dt;
            vy[i] += ((ty - oy[i]) * kS - vy[i] * kD) * dt;
            ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
          }
          if (!show) continue;
          x += ox[i]; y += oy[i];

          // Direction: base angle, leaning along the presence gradient, an idle wobble,
          // turned toward the cursor nearby and along the flight path when flying.
          const gx = gxA[ci], gy = gyA[ci], gm = Math.hypot(gx, gy);
          let a = base;
          if (gm > 0.02) a += angDiff(Math.atan2(gy, gx), base) * P.flow * Math.min(1, gm * 4);
          a += Math.sin(t * 1.3 * spd + h0 * 40) * 0.14 * Math.min(1, spd);
          if (near > 0) a += angDiff(Math.atan2(my - y, mx - x), a) * Math.min(1, near * 1.8);
          const sp = Math.hypot(vx[i], vy[i]);
          if (sp > cs * 2) a += angDiff(Math.atan2(vy[i], vx[i]), a) * Math.min(1, (sp - cs * 2) / (cs * 10));
          if (!angSet[i] || dt === 0) { ang[i] = a; angSet[i] = 1; }
          else ang[i] += angDiff(a, ang[i]) * Math.min(1, dt * 12);

          const size = flyer && h0 >= body
            ? cs * (1.9 + hash(i, 5, seed) * 0.8)
            : cs * (0.85 + 0.55 * v) * (0.8 + 0.4 * hash(i, 6, seed)) * (hash(i, 7, seed) < 0.1 ? 1.55 : 1) * (1 + 0.05 * Math.sin(t * 2 * spd + h0 * 20));
          arrow(g, x, y, ang[i], size, fill, line, lw);
        }
        g.restore();

        if (px > 1) {
          c.save();
          c.imageSmoothingEnabled = false;
          c.drawImage(buf, 0, 0, buf.width * px, buf.height * px);
          c.restore();
        }
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize: stage.resize,
      frame: stage.frame,
      dispose() { stage.dispose(); buf.width = buf.height = 0; an.width = an.height = 0; },
      onParam(k) { if (k === 'source') anVer = -1; if (k === 'size') gridKey = ''; },
    };
  },
};
