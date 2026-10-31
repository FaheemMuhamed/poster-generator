// Bit Glitch: the picture as chunky grey pixel blocks, binary digits and torn colour bars
// (refs 16, 19, 12). The picture is sampled once per cell and split into figure and void
// (distance from the backdrop colour, or plain tone). Figure cells become blocks from a short
// grey ramp, the darkest ones turn into digits and glyphs, and edges get accent "flags".
// On top, a glitch band wanders up and down: row strips are cut and slid sideways (the
// canvas is copied onto itself), solid colour bars tear across, and a few strips get a
// tinted channel-split ghost. Hover tears the rows at the cursor; a click sets off a burst.
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

function coverRect(sw, sh, W, H) {
  const sa = sw / sh, da = W / H;
  if (sa > da) { const w = sh * da; return [(sw - w) / 2, 0, w, sh]; }
  const h = sw / da;
  return [0, (sh - h) / 2, sw, h];
}

const MONO = '"JetBrains Mono", "Space Mono", ui-monospace, Menlo, monospace';
// Glyphs for dark cells: mostly bits, a few separators.
const GLYPHS = ['0', '1', '0', '1', '0', '1', '0', '1', ':', '|', '/', '"', '.', '0', '1'];

export default {
  id: 'bitglitch',
  name: 'Bit Glitch',
  engine: 'p5',
  medium: 'image',
  hint: 'Hover to tear the rows · click for a burst of glitches',
  darkGround: (p) => p.darkGround, // the poster text switches to the light colour
  params: {
    pixel:      { value: 10, min: 5, max: 28, step: 1, label: 'Pixel size', unit: 'px' },
    glyphs:     { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Glyph amount' },
    glitch:     { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Glitch amount' },
    flags:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Flag amount' },
    levels:     { value: 5, min: 2, max: 8, step: 1, label: 'Tone detail' },
    split:      { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Split amount' },
    speed:      { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
    hover:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    read:       { value: 'Subject', options: ['Subject', 'Dark', 'Light'], label: 'Map from' },
    contrast:   { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Contrast' },
    darkGround: { value: true, label: 'Dark ground' },
  },
  controls: {
    essentials: ['pixel', 'glyphs', 'glitch', 'flags'],
    form: ['levels'],
    motion: ['speed', 'split'],
    interaction: ['hover'],
    image: ['read', 'contrast'],
    colour: ['darkGround'],
    type: [],
  },
  presets: {
    'Data rain': { glyphs: 1, pixel: 8, glitch: 0.25, flags: 0.35, levels: 6, darkGround: true },
    'Torn signal': { glitch: 1, split: 1, pixel: 12, flags: 0.6, darkGround: true },
    'Big pixels': { pixel: 22, glyphs: 0.35, flags: 0.85, levels: 4, glitch: 0.4 },
  },
  interactions: { hover: 'tears and shifts the rows around the cursor', click: 'sets off a burst of tearing and colour bars' },

  create(ctx) {
    const P = ctx.params;
    const src = ctx.source;
    const seed = ctx.rand.int(1, 1e6);

    // ---------- Per-cell picture data ----------
    const an = document.createElement('canvas');
    const anx = an.getContext('2d', { willReadFrequently: true });
    let cols = 0, rows = 0, s = 10, ox = 0, oy = 0;
    let tone = null, pres = null, halo = null, edge = null, tmp = null;
    let anVer = -1, anKey = '', anAt = 0;

    function analyse(W, H) {
      s = P.pixel;
      cols = Math.ceil(W / s); rows = Math.ceil(H / s);
      ox = (W - cols * s) / 2; oy = (H - rows * s) / 2;
      if (an.width !== cols || an.height !== rows) { an.width = cols; an.height = rows; }
      const [sx, sy, sw, sh] = coverRect(src.width, src.height, cols * s, rows * s);
      anx.imageSmoothingEnabled = true;
      anx.imageSmoothingQuality = 'high';
      anx.drawImage(src.canvas, sx, sy, sw, sh, 0, 0, cols, rows);
      const d = anx.getImageData(0, 0, cols, rows).data;
      const n = cols * rows;
      if (!tone || tone.length !== n) {
        tone = new Float32Array(n); pres = new Float32Array(n); halo = new Float32Array(n);
        edge = new Float32Array(n); tmp = new Float32Array(n);
      }
      const C = P.contrast;
      for (let i = 0; i < n; i++) tone[i] = lumOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);

      // Figure vs void.
      if (P.read === 'Subject') {
        const R = [], G = [], B = [];
        const push = (i) => { R.push(d[i * 4]); G.push(d[i * 4 + 1]); B.push(d[i * 4 + 2]); };
        for (let x = 0; x < cols; x++) { push(x); push((rows - 1) * cols + x); }
        for (let y = 1; y < rows - 1; y++) { push(y * cols); push(y * cols + cols - 1); }
        const med = (a) => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
        const mr = med(R), mg = med(G), mb = med(B);
        const hi = 0.05 + 0.4 * (1 - 0.85 * C);
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          pres[i] = smooth(0.04, hi, Math.hypot(d[o] - mr, d[o + 1] - mg, d[o + 2] - mb) / 255);
        }
      }
      // Tone stretch (2nd–98th percentile), over the figure only when there is one.
      const hist = new Uint32Array(64);
      let tot = 0;
      for (let i = 0; i < n; i++) {
        if (P.read === 'Subject' && pres[i] < 0.5) continue;
        hist[Math.min(63, (tone[i] * 64) | 0)]++; tot++;
      }
      if (tot < n * 0.02) { hist.fill(0); for (let i = 0; i < n; i++) hist[Math.min(63, (tone[i] * 64) | 0)]++; tot = n; }
      let acc = 0, lo = 0, hi = 1;
      for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc > tot * 0.02) { lo = b / 64; break; } }
      acc = 0;
      for (let b = 63; b >= 0; b--) { acc += hist[b]; if (acc > tot * 0.02) { hi = (b + 1) / 64; break; } }
      const span = Math.max(0.1, hi - lo), w = 0.62 - 0.45 * C;
      for (let i = 0; i < n; i++) tone[i] = smooth(0.5 - w, 0.5 + w, (tone[i] - lo) / span);
      if (P.read !== 'Subject') {
        for (let i = 0; i < n; i++) pres[i] = smooth(0.15, 0.45, P.read === 'Dark' ? 1 - tone[i] : tone[i]);
      }

      // Edges (tone + figure outline), and a wide halo of the figure for the void's digits.
      const at = (a, x, y) => a[(y < 0 ? 0 : y >= rows ? rows - 1 : y) * cols + (x < 0 ? 0 : x >= cols ? cols - 1 : x)];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const gx = at(tone, x + 1, y) - at(tone, x - 1, y), gy = at(tone, x, y + 1) - at(tone, x, y - 1);
        const px = at(pres, x + 1, y) - at(pres, x - 1, y), py = at(pres, x, y + 1) - at(pres, x, y - 1);
        edge[y * cols + x] = Math.hypot(gx, gy) * 0.8 + Math.hypot(px, py);
      }
      const r = Math.max(2, Math.round(40 / s));
      for (let y = 0; y < rows; y++) {
        let acc2 = 0;
        for (let x = -r; x <= r; x++) acc2 += at(pres, x, y);
        for (let x = 0; x < cols; x++) {
          tmp[y * cols + x] = acc2 / (2 * r + 1);
          acc2 += at(pres, x + r + 1, y) - at(pres, x - r, y);
        }
      }
      for (let x = 0; x < cols; x++) {
        let acc2 = 0;
        for (let y = -r; y <= r; y++) acc2 += at(tmp, x, y);
        for (let y = 0; y < rows; y++) {
          halo[y * cols + x] = acc2 / (2 * r + 1);
          acc2 += at(tmp, x, y + r + 1) - at(tmp, x, y - r);
        }
      }
    }

    // A strip-sized scratch canvas for the channel-split ghosts.
    const ghost = document.createElement('canvas');
    const gx = ghost.getContext('2d');

    let clock = 0, burstAt = -10, burstY = 0.5;
    const cur = { x: 0.5, y: 0.5, hov: 0 };

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

        // Picture changes (throttled for the webcam).
        const now = performance.now();
        const key = `${W}x${H}:${P.pixel}:${P.read}:${P.contrast}`;
        if (src.version !== anVer || key !== anKey) {
          if (src.kind !== 'webcam' || now - anAt > 33 || key !== anKey) {
            analyse(W, H);
            anVer = src.version; anKey = key; anAt = now;
          }
        }
        const N = cols * rows;

        // Colours: ground, a grey ramp toward the light colour, accent flags.
        const bgDark = lumHex(pal.bg) < lumHex(pal.ink);
        const darkC = bgDark ? pal.bg : pal.ink, lightC = bgDark ? pal.ink : pal.bg;
        const ground = P.darkGround ? darkC : lightC, far = P.darkGround ? lightC : darkC;
        const nl = Math.round(P.levels);
        const greys = [];
        // greys[0] is always the darkest, so blocks keep the picture's tones on either ground.
        for (let k = 0; k < nl; k++) {
          const u = nl > 1 ? k / (nl - 1) : 1;
          greys.push(mixHex(ground, far, 0.2 + 0.66 * (P.darkGround ? u : 1 - u)));
        }
        // Flags: accents ranked by how loud they are against the ground.
        const accs = [pal.c4, pal.c2, pal.c3, pal.c1];
        const loud = accs.slice().sort((a, b) => distHex(b, ground) - distHex(a, ground));
        const flagCols = loud.slice(0, 3);
        const glyphCols = [far, greys[P.darkGround ? Math.max(0, nl - 2) : Math.min(1, nl - 1)], flagCols[2]];

        // Cursor and burst.
        cur.hov += ((ptr.inside ? 1 : 0) - cur.hov) * (dt > 0 ? Math.min(1, dt * 6) : 0);
        if (ptr.inside) { cur.x = ptr.x; cur.y = ptr.y; }
        const hover = cur.hov * mPow * P.hover;
        const mx = cur.x * W, my = cur.y * H;
        if (ptr.justPressed && ptr.inside && mPow > 0) { burstAt = clock; burstY = ptr.y; }
        const burst = Math.exp(-(clock - burstAt) * 2.2) * Math.min(1.5, mPow);

        const fast = Math.floor(t * 9 * spd);          // flicker epoch
        const slow = Math.floor(t * 1.6 * spd);        // glyph flip epoch
        const nearR = s * 7;

        // ---------- Cells ----------
        c.save();
        c.fillStyle = ground;
        c.fillRect(0, 0, W, H);
        const blockPaths = greys.map(() => new Path2D());
        const flagPaths = flagCols.map(() => new Path2D());
        const hiPath = new Path2D();
        const glyphLists = glyphCols.map(() => []);
        const hiGlyphs = [];

        for (let i = 0; i < N; i++) {
          const x = i % cols, y = (i - x) / cols;
          const X = ox + x * s, Y = oy + y * s;
          const v = pres[i], L = tone[i];
          // The cursor scrambles cells around it.
          let near = 0;
          if (hover > 0.01) {
            const dx = X + s / 2 - mx, dy = Y + s / 2 - my;
            near = Math.max(0, 1 - Math.hypot(dx, dy) / nearR) * Math.min(1.5, hover);
          }
          const scr = near > 0 && hash(i, fast, seed) < near * 0.55;
          const runH = hash(x >> 2, y, seed + slow * 13);   // shared by short horizontal runs

          if (v < 0.35 && !scr) {
            // Void: sparse digits, denser near the figure; rare highlighted runs.
            const pr = P.glyphs * (0.015 + 0.42 * halo[i] * halo[i]);
            const hg = hash(i, 1, seed);
            if (hg < pr) {
              const ch = GLYPHS[Math.floor(hash(i, slow + Math.floor(hg * 50), seed) * GLYPHS.length)];
              if (runH < 0.035 * P.glyphs && halo[i] > 0.15) { hiPath.rect(X, Y, s, s); hiGlyphs.push(ch, X, Y); }
              else glyphLists[hash(i, 2, seed) < 0.82 ? 1 : hash(i, 3, seed) < 0.5 ? 0 : 2].push(ch, X, Y);
            } else if (hg > 0.996 - 0.01 * halo[i]) blockPaths[Math.floor(hash(i, 4, seed) * nl)].rect(X, Y, s, s);
            continue;
          }

          // Figure: edges carry accent flags.
          const e = edge[i];
          const fl = P.flags * smooth(0.18, 0.55, e);
          if ((runH < fl * 0.9 && hash(i, 5, seed) < 0.85) || (scr && hash(i, fast, 7) < 0.4)) {
            const k = Math.floor(hash(x >> 2, y, seed + 99) * flagCols.length);
            const kind = hash(i, 6, seed);
            if (kind < 0.72) flagPaths[k].rect(X, Y, s, s);
            else flagPaths[k].rect(X, Y + s * 0.5, s, s * 0.5);
            continue;
          }
          // Dark parts of the figure: glyphs instead of blocks.
          if (L < 0.2 + 0.25 * P.glyphs * 0.6 || (scr && hash(i, fast, 8) < 0.5)) {
            if (hash(i, 7, seed) < 0.35 + 0.65 * P.glyphs || scr) {
              const ch = GLYPHS[Math.floor(hash(i, slow + (scr ? fast : 0), seed) * GLYPHS.length)];
              if (runH > 0.97 - 0.04 * P.glyphs) { hiPath.rect(X, Y, s, s); hiGlyphs.push(ch, X, Y); }
              else glyphLists[L < 0.1 ? 1 : hash(i, 9, seed) < 0.8 ? 0 : 2].push(ch, X, Y);
            }
            continue;
          }
          // Grey block, a step brighter or darker now and then; some carry a checker dither.
          let q = Math.min(nl - 1, Math.floor(Math.pow(L, 1.35) * nl));
          const flick = hash(i, slow, seed + 5);
          if (flick < 0.05) q = Math.max(0, Math.min(nl - 1, q + (flick < 0.025 ? -1 : 1)));
          if (hash(i, 10, seed) < 0.12 && q > 0) {
            const h2 = s / 2;
            blockPaths[q].rect(X, Y, h2, h2); blockPaths[q].rect(X + h2, Y + h2, h2, h2);
            blockPaths[q - 1].rect(X + h2, Y, h2, h2); blockPaths[q - 1].rect(X, Y + h2, h2, h2);
          } else blockPaths[q].rect(X, Y, s, s);
        }

        for (let k = 0; k < nl; k++) { c.fillStyle = greys[k]; c.fill(blockPaths[k]); }
        for (let k = 0; k < flagCols.length; k++) { c.fillStyle = flagCols[k]; c.fill(flagPaths[k]); }
        c.fillStyle = pal.c2; c.fill(hiPath);
        c.font = `700 ${s * 1.05}px ${MONO}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const dy0 = s * 0.56;
        for (let k = 0; k < glyphLists.length; k++) {
          const L = glyphLists[k];
          if (!L.length) continue;
          c.fillStyle = glyphCols[k];
          for (let j = 0; j < L.length; j += 3) c.fillText(L[j], L[j + 1] + s / 2, L[j + 2] + dy0);
        }
        c.fillStyle = ground;
        for (let j = 0; j < hiGlyphs.length; j += 3) c.fillText(hiGlyphs[j], hiGlyphs[j + 1] + s / 2, hiGlyphs[j + 2] + dy0);

        // ---------- Glitch pass (device pixels; the canvas is copied onto itself) ----------
        const cv = c.canvas;
        const CW = cv.width;
        c.setTransform(1, 0, 0, 1, 0, 0);
        const strips = [];
        // The wandering band: it jumps to a new place a few times a minute.
        const be = Math.floor(t * 0.4 * spd);
        const bf = t * 0.4 * spd - be;
        const env = 0.35 + 0.65 * Math.pow(Math.sin(Math.PI * bf), 0.6);
        let bandY = H * (0.08 + 0.75 * hash(be, 1, seed)), bandH = H * (0.05 + 0.15 * hash(be, 2, seed));
        let amp = P.glitch * env;
        if (burst > 0.02) {
          const bh = H * (0.12 + 0.3 * burst);
          bandY = bandY + (burstY * H - bh / 2 - bandY) * Math.min(1, burst * 2);
          bandH = bandH + (bh - bandH) * Math.min(1, burst * 2);
          amp = Math.max(amp, Math.min(1.6, burst * 1.4));
        }
        // Row strips inside the band.
        if (amp > 0.01) {
          let y = Math.floor(bandY / s) * s + oy;
          let k = 0;
          while (y < bandY + bandH) {
            const sh = s * (1 + Math.floor(hash(k, be, seed) * 3));
            const r = hash(k, fast >> 1, seed + 3);
            if (r < 0.75) strips.push({ y, h: sh, dx: (hash(k, fast >> 1, seed + 4) - 0.5) * 2 * W * 0.22 * amp, k, bar: r < 0.18 + 0.2 * amp, split: r > 0.55 });
            y += sh; k++;
          }
        }
        // Rare stray tears anywhere.
        for (let k = 0; k < 3; k++) {
          if (hash(k, fast, seed + 21) < 0.18 * P.glitch) {
            const y = oy + Math.floor(hash(k, fast, seed + 22) * rows) * s;
            strips.push({ y, h: s, dx: (hash(k, fast, seed + 23) - 0.5) * W * 0.3 * P.glitch, k: 100 + k, bar: false, split: false });
          }
        }
        // Hover: rows near the cursor slide back and forth.
        if (hover > 0.02) {
          const span = s * 9;
          let y = Math.floor((my - span) / s) * s + oy;
          let k = 0;
          while (y < my + span) {
            const sh = s * (1 + Math.floor(hash(k, 31, seed) * 2));
            const f = Math.max(0, 1 - Math.abs(y + sh / 2 - my) / span);
            if (hash(Math.floor((y - oy) / s), fast, seed + 9) < 0.75)
              strips.push({ y, h: sh, dx: (hash(Math.floor((y - oy) / s), fast, seed + 8) - 0.5) * 2 * s * 9 * f * Math.min(1.5, hover), k: 200 + k, bar: false, split: f > 0.6 });
            y += sh; k++;
          }
        }

        const sp = P.split * s * 1.4 * d;
        for (const st of strips) {
          const y0 = Math.max(0, Math.round(st.y * d)), y1 = Math.min(cv.height, Math.round((st.y + st.h) * d));
          const hh = y1 - y0;
          if (hh <= 0) continue;
          const dx = Math.round(st.dx * d);
          if (dx !== 0) {
            c.drawImage(cv, 0, y0, CW, hh, dx, y0, CW, hh);
            c.drawImage(cv, 0, y0, CW, hh, dx > 0 ? dx - CW : dx + CW, y0, CW, hh);
          }
          // Channel-split ghost: the strip tinted with an accent, offset sideways.
          if (st.split && sp > 0.5) {
            if (ghost.width !== CW || ghost.height < hh) { ghost.width = CW; ghost.height = Math.max(hh, ghost.height); }
            gx.globalCompositeOperation = 'copy';
            gx.drawImage(cv, 0, y0, CW, hh, 0, 0, CW, hh);
            gx.globalCompositeOperation = P.darkGround ? 'multiply' : 'screen';
            const tint = hash(st.k, 41, seed) < 0.5 ? pal.c1 : pal.c3;
            gx.fillStyle = tint;
            gx.fillRect(0, 0, CW, hh);
            gx.globalCompositeOperation = 'source-over';
            c.globalCompositeOperation = P.darkGround ? 'screen' : 'multiply';
            c.globalAlpha = 0.85;
            const off = (hash(st.k, 42, seed) < 0.5 ? -1 : 1) * sp * (0.5 + hash(st.k, fast, 43));
            c.drawImage(ghost, 0, 0, CW, hh, off, y0, CW, hh);
            c.globalAlpha = 1;
            c.globalCompositeOperation = 'source-over';
          }
          // Torn colour bars: a long slab with a thinner stripe of another accent.
          if (st.bar) {
            const x0 = hash(st.k, be * 7 + (fast >> 2), seed + 51) * W * 0.7;
            const len = W * (0.15 + 0.6 * hash(st.k, be, seed + 52));
            const a = loud[Math.floor(hash(st.k, be, seed + 53) * 3)];
            const b2 = loud[Math.floor(hash(st.k, be, seed + 54) * 4)];
            c.fillStyle = a;
            c.fillRect(x0 * d, y0, len * d, hh);
            if (hh > 2 * d) {
              c.fillStyle = b2;
              const sub = Math.max(1, Math.round(hh * 0.3));
              c.fillRect((x0 + len * hash(st.k, 55, seed) * 0.6) * d, y0 + (hash(st.k, 56, seed) < 0.5 ? 0 : hh - sub), len * 0.4 * d, sub);
            }
          }
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize: stage.resize,
      frame: stage.frame,
      dispose() { stage.dispose(); ghost.width = ghost.height = 0; an.width = an.height = 0; },
      onParam(k) { if (k === 'source') anVer = -1; },
    };
  },
};
