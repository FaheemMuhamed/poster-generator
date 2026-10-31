// Tracker HUD: the picture annotated like a computer-vision tracking feed (refs 7, 8, 9).
// Feature points come from a Shi–Tomasi corner score (the smaller eigenvalue of the structure
// tensor) on a low-res sample, thinned by non-maximum suppression. Each tracked point gets a
// thin box, a filled label tag with pseudo-data and hairlines to its neighbours or to a hub;
// some carry a magnified inset crop. Boxes wobble like a live tracker and now and then hop to
// another feature; with the webcam they follow the nearest feature from frame to frame.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain, hexA } from '../../shared/bloom2d.js';

const MONO = '"JetBrains Mono", "Space Mono", ui-monospace, Menlo, monospace';
const PREFIX = ['obj', 'trk', 'pt', 'id', 'node', 'feat'];

// Integer hash -> 0..1 (stable per target, so labels and styles don't flicker).
function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const lumHex = (hex) => lumOf(...rgbOf(hex));
const mix3 = (A, B, k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pad = (n, k = 3) => String(n).padStart(k, '0');

// The part of a sw×sh picture that covers a W×H poster (centre crop).
function coverRect(sw, sh, W, H) {
  const sa = sw / sh, da = W / H;
  if (sa > da) { const w = sh * da; return [(sw - w) / 2, 0, w, sh]; }
  const h = sw / da;
  return [0, (sh - h) / 2, sw, h];
}

export default {
  id: 'tracker',
  name: 'Tracker HUD',
  engine: 'p5',
  medium: 'image',
  hint: 'Hover to track and zoom · click to lock a target',
  params: {
    count:     { value: 16, min: 3, max: 48, step: 1, label: 'Target count' },
    size:      { value: 0.1, min: 0.03, max: 0.3, step: 0.005, label: 'Box size' },
    links:     { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Link amount' },
    look:      { value: 'Washed', options: ['Washed', 'Mono', 'Photo'], label: 'Picture' },
    insets:    { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Inset amount' },
    labelSize: { value: 1, min: 0.6, max: 2, step: 0.05, label: 'Label size' },
    hub:       { value: true, label: 'Hub lines' },
    frame:     { value: true, label: 'HUD frame' },
    speed:     { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
    jitter:    { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Jitter amount' },
    pull:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    contrast:  { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Contrast' },
    detail:    { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Detail' },
    hud:       { value: 'Accent 1', options: ['Accent 1', 'Accent 2', 'Accent 3', 'Accent 4', 'Mixed'], label: 'Tag colour' },
  },
  controls: {
    essentials: ['count', 'size', 'links', 'look'],
    form: ['insets', 'labelSize', 'hub', 'frame'],
    motion: ['speed', 'jitter'],
    interaction: ['pull'],
    image: ['contrast', 'detail'],
    colour: ['hud'],
    type: [],
  },
  presets: {
    'Data map': { look: 'Washed', count: 26, size: 0.05, links: 0.9, insets: 0, hub: true, labelSize: 1.1 },
    'Red alert': { look: 'Mono', count: 10, size: 0.17, links: 0.45, insets: 0.15, contrast: 0.8 },
    'Field survey': { look: 'Photo', count: 11, size: 0.11, links: 0.75, insets: 0.9, hub: false },
  },
  interactions: { hover: 'a tracking box follows the cursor, snaps to features and shows a zoomed crop', click: 'locks a new target and links it to its neighbours' },

  create(ctx) {
    const P = ctx.params;
    const src = ctx.source;
    const seed = ctx.rand.int(1, 1e6);

    // ---------- Analysis: corner score on a low-res sample ----------
    const an = document.createElement('canvas');
    const anx = an.getContext('2d', { willReadFrequently: true });
    let GC = 0, GR = 0;
    let lum = null, blur = null, gxA = null, gyA = null, score = null;
    let lumLo = 0, lumHi = 1;
    let cands = [];             // [{ x, y, s }] in 0..1 poster coords, strongest first
    let anVer = -1, anW = 0, anH = 0, anAt = 0, anKey = '';

    function analyse(W, H) {
      const cols = Math.round(56 + P.detail * 104);
      const rows = Math.max(8, Math.round(cols * H / W));
      if (an.width !== cols || an.height !== rows) { an.width = cols; an.height = rows; }
      const [sx, sy, sw, sh] = coverRect(src.width, src.height, W, H);
      anx.imageSmoothingEnabled = true;
      anx.drawImage(src.canvas, sx, sy, sw, sh, 0, 0, cols, rows);
      const d = anx.getImageData(0, 0, cols, rows).data;
      const n = cols * rows;
      if (!lum || lum.length !== n) {
        lum = new Float32Array(n); blur = new Float32Array(n);
        gxA = new Float32Array(n); gyA = new Float32Array(n); score = new Float32Array(n);
      }
      GC = cols; GR = rows;
      const hist = new Uint32Array(64);
      for (let i = 0; i < n; i++) {
        const L = lumOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        lum[i] = L;
        hist[Math.min(63, (L * 64) | 0)]++;
      }
      // Tonal range (2nd–98th percentile) for the picture's contrast stretch.
      let acc = 0; lumLo = 0; lumHi = 1;
      for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc > n * 0.02) { lumLo = b / 64; break; } }
      acc = 0;
      for (let b = 63; b >= 0; b--) { acc += hist[b]; if (acc > n * 0.02) { lumHi = (b + 1) / 64; break; } }
      if (lumHi - lumLo < 0.15) { lumLo = Math.max(0, lumLo - 0.08); lumHi = Math.min(1, lumHi + 0.08); }

      const at = (a, x, y) => a[(y < 0 ? 0 : y >= rows ? rows - 1 : y) * cols + (x < 0 ? 0 : x >= cols ? cols - 1 : x)];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(lum, x + dx, y + dy);
        blur[y * cols + x] = s / 9;
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        gxA[i] = (at(blur, x + 1, y - 1) + 2 * at(blur, x + 1, y) + at(blur, x + 1, y + 1))
          - (at(blur, x - 1, y - 1) + 2 * at(blur, x - 1, y) + at(blur, x - 1, y + 1));
        gyA[i] = (at(blur, x - 1, y + 1) + 2 * at(blur, x, y + 1) + at(blur, x + 1, y + 1))
          - (at(blur, x - 1, y - 1) + 2 * at(blur, x, y - 1) + at(blur, x + 1, y - 1));
      }
      // Structure tensor over a 3×3 window; the smaller eigenvalue is high only at corners.
      // A little plain edge strength is added so straight contours still get points.
      let max = 1e-6;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let sxx = 0, syy = 0, sxy = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const gx = at(gxA, x + dx, y + dy), gy = at(gyA, x + dx, y + dy);
          sxx += gx * gx; syy += gy * gy; sxy += gx * gy;
        }
        const tr = sxx + syy, df = sxx - syy;
        const lmin = (tr - Math.sqrt(df * df + 4 * sxy * sxy)) / 2;
        const i = y * cols + x;
        const v = lmin + 0.04 * (gxA[i] * gxA[i] + gyA[i] * gyA[i]);
        score[i] = v;
        if (v > max) max = v;
      }
      // Local maxima, strongest first, then greedy thinning so points spread out.
      const peaks = [];
      const floor = max * 0.012;
      const m = 2;
      for (let y = m; y < rows - m; y++) for (let x = m; x < cols - m; x++) {
        const i = y * cols + x, v = score[i];
        if (v < floor) continue;
        let top = true;
        for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && score[i + dy * cols + dx] > v) { top = false; break; }
        }
        if (top) peaks.push(i);
      }
      peaks.sort((a, b) => score[b] - score[a]);
      const want = Math.max(12, Math.round(P.count * 3));
      const minD = Math.max(2, Math.sqrt(n / want) * 0.75);
      const minD2 = minD * minD;
      const kept = [];
      for (const i of peaks) {
        const x = i % cols, y = (i - x) / cols;
        let ok = true;
        for (const k of kept) { const dx = k[0] - x, dy = k[1] - y; if (dx * dx + dy * dy < minD2) { ok = false; break; } }
        if (!ok) continue;
        kept.push([x, y, score[i] / max]);
        if (kept.length >= want) break;
      }
      cands = kept.map(([x, y, s]) => ({ x: (x + 0.5) / cols, y: (y + 0.5) / rows, s }));
    }

    // ---------- The picture, re-toned for the look (cached) ----------
    const tone = document.createElement('canvas');
    const tx = tone.getContext('2d', { willReadFrequently: true });
    let toneKey = '', toneMean = 0.5;

    function buildTone(W, H, d, pal, hudHex) {
      const live = src.kind === 'webcam';
      const cap = live ? 520 : d > 2.5 ? 2400 : 1400;
      const k = Math.min(1, cap / (Math.max(W, H) * d));
      const tw = Math.max(16, Math.round(W * d * k)), th = Math.max(16, Math.round(H * d * k));
      if (tone.width !== tw || tone.height !== th) { tone.width = tw; tone.height = th; }
      const [sx, sy, sw, sh] = coverRect(src.width, src.height, W, H);
      tx.imageSmoothingEnabled = true;
      tx.imageSmoothingQuality = 'high';
      tx.drawImage(src.canvas, sx, sy, sw, sh, 0, 0, tw, th);
      const img = tx.getImageData(0, 0, tw, th);
      const px = img.data;
      const bgDark = lumHex(pal.bg) < lumHex(pal.ink);
      const darkC = rgbOf(bgDark ? pal.bg : pal.ink), lightC = rgbOf(bgDark ? pal.ink : pal.bg);
      const hud = rgbOf(hudHex);
      const span = Math.max(0.05, lumHi - lumLo);
      const C = P.contrast;
      // Washed and Mono map brightness through a 256-entry colour ramp.
      const lut = new Uint8ClampedArray(256 * 3);
      for (let v = 0; v < 256; v++) {
        let g = clamp01((v / 255 - lumLo) / span);
        let col;
        if (P.look === 'Mono') {
          const s = 3 + C * 9;
          g = 1 / (1 + Math.exp(-(g - 0.5) * s));
          col = mix3(darkC, mix3(lightC, darkC, 0.3), g);
        } else {
          // Washed: a low-contrast duotone from tinted slate up to paper.
          g = clamp01(0.5 + (g - 0.5) * (0.7 + C * 1.1));
          col = mix3(mix3(darkC, hud, 0.32), lightC, 0.08 + 0.92 * g);
        }
        lut[v * 3] = col[0]; lut[v * 3 + 1] = col[1]; lut[v * 3 + 2] = col[2];
      }
      const photo = P.look === 'Photo';
      const gam = 1.6 - C * 1.1;
      let sum = 0;
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const L = (0.299 * r + 0.587 * g + 0.114 * b);
        if (photo) {
          // Photo: colour kept in the lights, shadows sink into the dark ground.
          const t = Math.pow(clamp01((L / 255 - lumLo) / span), gam) * 0.92;
          px[i] = darkC[0] + (r - darkC[0]) * t;
          px[i + 1] = darkC[1] + (g - darkC[1]) * t;
          px[i + 2] = darkC[2] + (b - darkC[2]) * t;
        } else {
          let v = L | 0;
          if (P.look === 'Mono') v = Math.max(0, Math.min(255, v + ((hash(j, 7, seed) - 0.5) * 34) | 0));
          px[i] = lut[v * 3]; px[i + 1] = lut[v * 3 + 1]; px[i + 2] = lut[v * 3 + 2];
        }
        if ((j & 7) === 0) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      }
      // Mean brightness, so hairlines can pick the colour that shows against the picture.
      toneMean = sum / Math.ceil(px.length / 32) / 255;
      tx.putImageData(img, 0, 0);
    }

    // ---------- Targets ----------
    let targets = [];
    let serial = 0;
    let clock = 0;
    const locks = [];
    const hb = { x: 0.5, y: 0.5, a: 0 };   // the hover tracking box

    function newTarget(c, t0) {
      const n = serial++;
      return {
        n, num: Math.floor(hash(n, 1, seed) * 900) + 10,
        x: c.x, y: c.y, tx: c.x, ty: c.y,
        sz: 0.65 + hash(n, 2, seed) * 0.7, asp: 0.75 + hash(n, 3, seed) * 0.55,
        hop: t0 + 2 + hash(n, 4, seed) * 5, a: 1,
      };
    }
    function reset() {
      targets = [];
      const k = Math.min(Math.round(P.count), cands.length);
      for (let i = 0; i < k; i++) targets.push(newTarget(cands[i], clock));
    }
    // Live picture: each target follows the nearest fresh feature (greedy, one each).
    function follow() {
      const used = new Uint8Array(cands.length);
      for (const tg of targets) {
        let best = -1, bd = 0.1 * 0.1;
        for (let i = 0; i < cands.length; i++) {
          if (used[i]) continue;
          const dx = cands[i].x - tg.tx, dy = cands[i].y - tg.ty, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = i; }
        }
        if (best >= 0) { used[best] = 1; tg.tx = cands[best].x; tg.ty = cands[best].y; }
      }
    }
    function syncCount() {
      const want = Math.min(Math.round(P.count), cands.length);
      while (targets.length > want) targets.pop();
      while (targets.length < want) {
        const c = cands[targets.length] || cands[0];
        if (!c) break;
        targets.push(newTarget(c, clock));
      }
    }

    // ---------- Drawing helpers ----------
    function brackets(c, x, y, w, h, L) {
      c.moveTo(x, y + L); c.lineTo(x, y); c.lineTo(x + L, y);
      c.moveTo(x + w - L, y); c.lineTo(x + w, y); c.lineTo(x + w, y + L);
      c.moveTo(x + w, y + h - L); c.lineTo(x + w, y + h); c.lineTo(x + w - L, y + h);
      c.moveTo(x + L, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - L);
    }
    // A filled tag with one or two lines of mono text; returns its height.
    function tag(c, lines, x, y, fs, fill, ink, W, below) {
      const lh = fs * 1.18, padX = fs * 0.32;
      let w = 0;
      for (const s of lines) w = Math.max(w, c.measureText(s).width);
      w += padX * 2;
      const h = lh * lines.length + fs * 0.12;
      let ty = below ? y : y - h;
      const tx0 = Math.max(1, Math.min(W - w - 1, x));
      c.fillStyle = fill;
      // One slab per line (like the reference): ragged right edges.
      for (let k = 0; k < lines.length; k++) {
        const lw = c.measureText(lines[k]).width + padX * 2;
        c.fillRect(tx0, ty + k * lh, lw, lh + (k === lines.length - 1 ? fs * 0.12 : 0.5));
      }
      c.fillStyle = ink;
      for (let k = 0; k < lines.length; k++) c.fillText(lines[k], tx0 + padX, ty + k * lh + fs * 0.92);
      return h;
    }
    // A magnified crop of the picture around (cx, cy) (poster px) into the rect.
    function inset(c, x, y, w, h, cx, cy, zoom, W, H, usePhoto) {
      const rw = w / zoom, rh = h / zoom;
      let sx, sy, sw, sh, img;
      if (usePhoto) {
        const [ox, oy, ow, oh] = coverRect(src.width, src.height, W, H);
        const kx = ow / W, ky = oh / H;
        sx = ox + (cx - rw / 2) * kx; sy = oy + (cy - rh / 2) * ky; sw = rw * kx; sh = rh * ky;
        img = src.canvas;
      } else {
        const kx = tone.width / W, ky = tone.height / H;
        sx = (cx - rw / 2) * kx; sy = (cy - rh / 2) * ky; sw = rw * kx; sh = rh * ky;
        img = tone;
      }
      const iw = img.width, ih = img.height;
      if (sx < 0) sx = 0; if (sy < 0) sy = 0;
      if (sx + sw > iw) sx = iw - sw; if (sy + sh > ih) sy = ih - sh;
      if (sw <= 1 || sh <= 1) return;
      c.imageSmoothingEnabled = true;
      c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, d = p.pixelDensity(), c = p.drawingContext;
        const pal = ctx.palette;
        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        dt = Math.min(0.05, dt || 0);
        clock += dt;
        const spd = P.speed;

        // Colours.
        const acc = [pal.c1, pal.c2, pal.c3, pal.c4];
        const mixed = P.hud === 'Mixed';
        const hudHex = mixed ? pal.c1 : acc[Math.max(0, ['Accent 1', 'Accent 2', 'Accent 3', 'Accent 4'].indexOf(P.hud))];
        const bgDark = lumHex(pal.bg) < lumHex(pal.ink);
        const darkHex = bgDark ? pal.bg : pal.ink, lightHex = bgDark ? pal.ink : pal.bg;
        const textOn = (fill) => (Math.abs(lumHex(fill) - lumHex(darkHex)) > Math.abs(lumHex(fill) - lumHex(lightHex)) ? darkHex : lightHex);
        const colOf = (tg) => (mixed ? acc[Math.floor(hash(tg.n, 9, seed) * 4)] : hudHex);

        // Picture changes: re-detect (throttled for the webcam) and re-tone.
        const now = performance.now();
        const live = src.kind === 'webcam';
        const key = `${Math.round(P.count)}:${P.detail}`;
        if (src.version !== anVer || W !== anW || H !== anH || key !== anKey) {
          if (!live || now - anAt > 50 || W !== anW || H !== anH || key !== anKey) {
            const fresh = !live || anVer < 0 || W !== anW || H !== anH || key !== anKey;
            analyse(W, H);
            if (fresh && !(live && targets.length)) reset();
            else { syncCount(); follow(); }
            anVer = src.version; anW = W; anH = H; anAt = now; anKey = key;
            toneKey = '';
          }
        }
        const tk = [anVer, W, H, d, P.look, P.contrast, pal.bg, pal.ink, hudHex].join('|');
        if (tk !== toneKey) { buildTone(W, H, d, pal, hudHex); toneKey = tk; }
        // Hairlines: light on a dark picture, dark on a light one (Mono uses the tag colour).
        const lineHex = P.look === 'Mono' ? hudHex : toneMean > 0.55 ? darkHex : lightHex;

        // Cursor: an eased tracking box that snaps toward the nearest strong feature.
        const pull = Math.min(2, P.pull * mPow);
        hb.a += ((ptr.inside && pull > 0 ? 1 : 0) - hb.a) * (dt > 0 ? Math.min(1, dt * 6) : 1);
        let goalX = ptr.x, goalY = ptr.y;
        if (ptr.inside) {
          let best = null, bd = 0.08 * 0.08;
          const ar = W / H;
          for (const cd of cands) {
            const dx = (cd.x - ptr.x) * ar, dy = cd.y - ptr.y, dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = cd; }
          }
          if (best) { const k = Math.min(0.85, 0.45 * pull); goalX += (best.x - goalX) * k; goalY += (best.y - goalY) * k; }
          const kk = dt > 0 ? Math.min(1, dt * 9) : 1;
          hb.x += (goalX - hb.x) * kk; hb.y += (goalY - hb.y) * kk;
        }
        const hov = hb.a * Math.min(1, pull);

        // Click: lock a new target where the tracking box is.
        if (ptr.justPressed && ptr.inside) {
          locks.push({ x: goalX, y: goalY, t0: clock, num: Math.floor(hash(locks.length + serial, 5, seed + clock * 7) * 90) + 1 });
          if (locks.length > 6) locks.shift();
        }

        // Advance targets: ease toward their feature, hop now and then (stills).
        const kMove = dt > 0 ? 1 - Math.exp(-dt * 3.2 * Math.max(0.3, spd)) : 0;
        const inUse = new Set();
        for (const tg of targets) {
          if (spd > 0 && !live && clock > tg.hop && cands.length > targets.length) {
            for (let tries = 0; tries < 6; tries++) {
              const cd = cands[Math.floor(hash(tg.n, Math.floor(clock * 10) + tries, seed) * Math.min(cands.length, targets.length * 2.5))];
              if (!cd || inUse.has(cd)) continue;
              tg.tx = cd.x; tg.ty = cd.y; break;
            }
            tg.hop = clock + (2.5 + hash(tg.n, Math.floor(clock), seed) * 5) / spd;
          }
          tg.x += (tg.tx - tg.x) * kMove; tg.y += (tg.ty - tg.y) * kMove;
        }

        // ---------- Draw ----------
        c.save();
        c.fillStyle = darkHex;
        c.fillRect(0, 0, W, H);
        c.imageSmoothingEnabled = true;
        c.drawImage(tone, 0, 0, W, H);

        const base = P.size * Math.min(W, H);
        const fs = 9 * P.labelSize * Math.max(0.85, Math.min(1.7, Math.min(W, H) / 560));
        c.font = `500 ${fs}px ${MONO}`;
        c.textBaseline = 'alphabetic';
        const jit = P.jitter * Math.max(1, base * 0.06);
        const confEpoch = Math.floor(t * 2.2 * spd);

        // Screen positions (with tracker wobble and a pull toward the cursor).
        const pts = targets.map((tg) => {
          const ph = hash(tg.n, 11, seed) * 100;
          let x = tg.x * W + (Math.sin(t * 2.3 * spd + ph) + 0.5 * Math.sin(t * 7.1 * spd + ph * 1.7)) * jit;
          let y = tg.y * H + (Math.cos(t * 2.0 * spd + ph * 1.3) + 0.5 * Math.sin(t * 6.3 * spd + ph)) * jit;
          if (hov > 0.01) {
            const dx = hb.x * W - x, dy = hb.y * H - y;
            const r = Math.min(W, H) * 0.22;
            const f = Math.exp(-(dx * dx + dy * dy) / (r * r)) * 0.16 * hov * Math.min(1.5, P.pull);
            x += dx * f; y += dy * f;
          }
          const s = base * tg.sz * (1 + 0.04 * P.jitter * Math.sin(t * 3.1 * spd + ph));
          return { tg, x, y, w: s * tg.asp, h: s / tg.asp };
        });

        // Mono look: solid accent slabs with notches behind some targets (ref 8).
        if (P.look === 'Mono') {
          for (const q of pts) {
            const hs = hash(q.tg.n, 21, seed);
            if (hs > 0.5) continue;
            const bw = q.w * (1.1 + hash(q.tg.n, 22, seed) * 0.9), bh = q.h * (0.4 + hash(q.tg.n, 23, seed) * 0.5);
            const bx = q.x - q.w / 2 + (hs < 0.25 ? -bw * 0.25 : q.w * 0.3), by = q.y + q.h / 2 - bh * 0.6;
            c.fillStyle = colOf(q.tg);
            c.globalAlpha = 0.93;
            c.fillRect(bx, by, bw, bh);
            c.globalAlpha = 1;
            c.fillStyle = darkHex;
            const r = Math.min(bw, bh) * 0.16;
            c.beginPath(); c.arc(bx + bw * 0.8, by + bh * 0.62, r, 0, Math.PI * 2); c.fill();
            const tw = bh * 0.14;
            for (let k = 0; k < 3; k++) c.fillRect(bx + bw * (0.18 + k * 0.12), by + bh - tw, tw * 1.6, tw);
            c.fillRect(bx + bw * 0.06, by + bh * 0.25, 1, bh * 0.5);
            c.font = `500 ${fs * 0.85}px ${MONO}`;
            c.fillText(`${pad(q.tg.num)}  B.W ${(hash(q.tg.n, 24, seed) * 99).toFixed(0)}`, bx + bw * 0.1, by + fs * 1.1);
            c.font = `500 ${fs}px ${MONO}`;
          }
        }

        // Links: nearest neighbours (solid) and a hub fan (dashed).
        c.lineWidth = 0.8;
        c.strokeStyle = hexA(lineHex, 0.85);
        c.beginPath();
        const nl = P.links;
        for (let i = 0; i < pts.length; i++) {
          if (hash(pts[i].tg.n, 31, seed) > nl * 1.1) continue;
          const k2 = nl > 0.7 ? 2 : 1;
          const near = [];
          for (let j = 0; j < pts.length; j++) {
            if (j === i) continue;
            near.push([Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y), j]);
          }
          near.sort((a, b) => a[0] - b[0]);
          for (let k = 0; k < Math.min(k2, near.length); k++) {
            const q = pts[near[k][1]];
            c.moveTo(pts[i].x, pts[i].y); c.lineTo(q.x, q.y);
          }
        }
        c.stroke();

        const hubX = W * [0.5, 0.82, 0.2][seed % 3], hubY = H * 0.11;
        const hubOn = P.hub && nl > 0.05;
        if (hubOn) {
          c.setLineDash(P.look === 'Mono' ? [] : [2, 3]);
          c.strokeStyle = hexA(P.look === 'Mono' ? hudHex : lineHex, 0.75);
          c.beginPath();
          for (const q of pts) {
            if (hash(q.tg.n, 32, seed) > 0.25 + nl * 0.6) continue;
            c.moveTo(hubX, hubY); c.lineTo(q.x, q.y);
          }
          c.stroke();
          c.setLineDash([]);
        }

        // Boxes, centre marks and inset crops.
        const photoInset = P.look === 'Photo';
        for (const q of pts) {
          const col = colOf(q.tg);
          const x0 = q.x - q.w / 2, y0 = q.y - q.h / 2;
          const style = hash(q.tg.n, 41, seed);
          c.strokeStyle = col;
          c.lineWidth = 1;
          c.beginPath();
          if (style < 0.55) c.rect(x0, y0, q.w, q.h);
          else brackets(c, x0, y0, q.w, q.h, Math.min(q.w, q.h) * 0.24);
          c.stroke();
          // Centre dot (in the line colour, like the reference graph nodes).
          c.fillStyle = lineHex;
          c.beginPath(); c.arc(q.x, q.y, Math.max(1.4, fs * 0.2), 0, Math.PI * 2); c.fill();

          if (hash(q.tg.n, 42, seed) < P.insets) {
            const iw = q.w * 1.25, ih = q.h * 1.25;
            const side = q.x < W / 2 ? 1 : -1;
            let ix = side > 0 ? q.x + q.w / 2 + fs : q.x - q.w / 2 - fs - iw;
            let iy = q.y - ih * (0.2 + hash(q.tg.n, 43, seed) * 0.6);
            ix = Math.max(2, Math.min(W - iw - 2, ix)); iy = Math.max(2, Math.min(H - ih - 2, iy));
            inset(c, ix, iy, iw, ih, q.x, q.y, 2, W, H, photoInset);
            c.strokeStyle = col;
            c.beginPath(); c.rect(ix, iy, iw, ih);
            c.moveTo(side > 0 ? x0 + q.w : x0, y0); c.lineTo(side > 0 ? ix : ix + iw, iy);
            c.moveTo(side > 0 ? x0 + q.w : x0, y0 + q.h); c.lineTo(side > 0 ? ix : ix + iw, iy + ih);
            c.stroke();
          }
        }

        // Tags.
        for (const q of pts) {
          const tg = q.tg, col = colOf(tg);
          const conf = 0.62 + 0.37 * hash(tg.n, confEpoch, seed);
          const pre = PREFIX[Math.floor(hash(tg.n, 51, seed) * PREFIX.length)];
          const lines = [`${pre}_${pad(tg.num)} ${conf.toFixed(2)}`];
          const two = hash(tg.n, 52, seed);
          if (two < 0.3) lines.push(`x${pad(Math.round(tg.x * 999))} y${pad(Math.round(tg.y * 999))}`);
          else if (two < 0.45) lines.push(`v${(Math.abs(Math.sin(t * spd + tg.n)) * 4).toFixed(1)} Δ${(hash(tg.n, confEpoch, 3) * 0.2).toFixed(2)}`);
          const below = q.y - q.h / 2 - fs * 2.6 < 0;
          tag(c, lines, q.x - q.w / 2, below ? q.y + q.h / 2 + 2 : q.y - q.h / 2 - 2, fs, col, textOn(col), W, below);
        }
        if (hubOn) {
          c.font = `500 ${fs * 1.35}px ${MONO}`;
          const s = `track_hub n=${pts.length}`;
          const tw = c.measureText(s).width;
          tag(c, [s], hubX - tw / 2, hubY - fs * 0.4, fs * 1.35, hudHex, textOn(hudHex), W, false);
          c.font = `500 ${fs}px ${MONO}`;
        }

        // Locked targets: a box that snaps in, a fan of lines to the nearest targets.
        for (let li = locks.length - 1; li >= 0; li--) {
          const L = locks[li];
          const age = clock - L.t0;
          const lx = L.x * W, ly = L.y * H;
          const snap = dt === 0 && age === 0 ? 1 : Math.min(1, age / 0.35);
          const e = 1 - Math.pow(1 - snap, 3);
          const s = base * 1.1 * (2.2 - 1.2 * e);
          c.strokeStyle = hudHex;
          c.lineWidth = 1;
          c.beginPath();
          const near = pts.map((q) => [Math.hypot(q.x - lx, q.y - ly), q]).sort((a, b) => a[0] - b[0]);
          for (let k = 0; k < Math.min(5, near.length); k++) { c.moveTo(lx, ly); c.lineTo(near[k][1].x, near[k][1].y); }
          if (hubOn) { c.moveTo(lx, ly); c.lineTo(hubX, hubY); }
          c.stroke();
          c.lineWidth = 1.5;
          c.beginPath();
          c.rect(lx - s / 2, ly - s / 2, s, s);
          brackets(c, lx - s / 2 - 4, ly - s / 2 - 4, s + 8, s + 8, s * 0.18);
          c.moveTo(lx - s * 0.12, ly); c.lineTo(lx + s * 0.12, ly);
          c.moveTo(lx, ly - s * 0.12); c.lineTo(lx, ly + s * 0.12);
          c.stroke();
          if (age < 0.7 && dt > 0) {
            const f = age / 0.7, r = s * (0.6 + f * 1.6);
            c.strokeStyle = hexA(hudHex, 1 - f);
            c.strokeRect(lx - r, ly - r, r * 2, r * 2);
          }
          tag(c, [`LOCK_${pad(L.num, 2)} ▸ ${(0.9 + 0.09 * hash(L.num, confEpoch, seed)).toFixed(2)}`, `${(age).toFixed(1).padStart(5, '0')}s`],
            lx - s / 2, ly - s / 2 - 6, fs, hudHex, textOn(hudHex), W, false);
        }

        // Hover: crosshair hairlines, tracking brackets and a zoom crop.
        if (hov > 0.02) {
          const hx = hb.x * W, hy = hb.y * H;
          c.globalAlpha = hov;
          c.strokeStyle = hexA(hudHex, 0.6);
          c.lineWidth = 0.7;
          c.setLineDash([3, 4]);
          c.beginPath();
          c.moveTo(0, hy); c.lineTo(W, hy); c.moveTo(hx, 0); c.lineTo(hx, H);
          c.stroke();
          c.setLineDash([]);
          const s = Math.max(28, base * 0.9);
          c.strokeStyle = hudHex;
          c.lineWidth = 1.5;
          c.beginPath();
          brackets(c, hx - s / 2, hy - s / 2, s, s, s * 0.28);
          c.stroke();
          const zw = Math.max(70, Math.min(W, H) * 0.24), zh = zw * 0.78;
          const zx = hx + s / 2 + 10 + zw > W ? hx - s / 2 - 10 - zw : hx + s / 2 + 10;
          const zy = Math.max(4, Math.min(H - zh - 4, hy - zh - s * 0.2));
          inset(c, zx, zy, zw, zh, hx, hy, 2 + 1.5 * Math.min(1, pull), W, H, photoInset);
          c.strokeStyle = hudHex;
          c.lineWidth = 1;
          c.beginPath(); c.rect(zx, zy, zw, zh); c.stroke();
          tag(c, [`TRK x${pad(Math.round(hb.x * 999))} y${pad(Math.round(hb.y * 999))}`, `zoom x${(2 + 1.5 * Math.min(1, pull)).toFixed(1)}`],
            zx, zy + zh + 2, fs, hudHex, textOn(hudHex), W, true);
          c.globalAlpha = 1;
        }

        // Frame: corner brackets and a little readout.
        if (P.frame) {
          const m = Math.max(10, Math.min(W, H) * 0.025), L = m * 1.3;
          c.strokeStyle = lineHex;
          c.lineWidth = 1.2;
          c.beginPath(); brackets(c, m, m, W - m * 2, H - m * 2, L); c.stroke();
          c.font = `500 ${fs * 0.95}px ${MONO}`;
          c.fillStyle = lineHex;
          const secs = Math.max(0, t);
          const tc = `${pad(Math.floor(secs / 3600) % 24, 2)}:${pad(Math.floor(secs / 60) % 60, 2)}:${pad(Math.floor(secs) % 60, 2)}:${pad(Math.floor(secs * 24) % 24, 2)}`;
          c.fillText(`● REC  TRK ${pad(pts.length + locks.length, 2)}`, m + L * 0.5, m + L + fs);
          const rt = `CAM_0${1 + (seed % 4)}  ${src.width}×${src.height}`;
          c.fillText(rt, W - m - L * 0.5 - c.measureText(rt).width, m + L + fs);
          c.fillText(`x ${(ptr.x).toFixed(3)}  y ${(ptr.y).toFixed(3)}`, m + L * 0.5, H - m - L * 0.6);
          c.fillText(tc, W - m - L * 0.5 - c.measureText(tc).width, H - m - L * 0.6);
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize: stage.resize,
      frame: stage.frame,
      dispose() { stage.dispose(); tone.width = tone.height = 0; an.width = an.height = 0; },
      onParam(k) {
        if (k === 'source') { anVer = -1; toneKey = ''; locks.length = 0; }
        if (k === 'palette' || k === 'look' || k === 'contrast' || k === 'hud') toneKey = '';
      },
    };
  },
};
