// Arc Panels: concentric arc bands of colour (thick and thin, partial, hatched, ticked) centred low
// on the page, seen through a fractured layout of slightly tilted panels on cream paper, like a
// technical drawing cut into frames (refs 68, 65).
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain, hexA } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

// ---- small helpers (kept local so the mode is self-contained) ----
function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry(a) {
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
  return f;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TAU = Math.PI * 2;

// Splits a convex polygon [[x,y]...] by the line through (px,py) with direction (dx,dy).
// Returns [a, b], or null if the line misses it.
function splitPoly(poly, px, py, dx, dy) {
  const side = poly.map(([x, y]) => (x - px) * dy - (y - py) * dx);
  if (side.every((s) => s >= 0) || side.every((s) => s <= 0)) return null;
  const a = [], b = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const p = poly[i], q = poly[j], sp = side[i], sq = side[j];
    (sp >= 0 ? a : b).push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq);
      const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      a.push(m); b.push(m);
    }
  }
  return a.length > 2 && b.length > 2 ? [a, b] : null;
}
// Shrinks a convex polygon by g (each edge moved inward), for the gutters between panels.
function insetPoly(poly, g) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const s = area > 0 ? 1 : -1;
  const lines = poly.map(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % n];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * s, ny = (dx / l) * s; // inward normal
    return [x0 + nx * g, y0 + ny * g, dx, dy];
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n], B = lines[i];
    const den = A[2] * B[3] - A[3] * B[2];
    if (Math.abs(den) < 1e-9) { out.push([B[0], B[1]]); continue; }
    const t = ((B[0] - A[0]) * B[3] - (B[1] - A[1]) * B[2]) / den;
    out.push([A[0] + A[2] * t, A[1] + A[3] * t]);
  }
  let a2 = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = out[i], [x1, y1] = out[(i + 1) % n]; a2 += x0 * y1 - x1 * y0; }
  return a2 * area > 0 && Math.abs(a2) > g * g * 4 ? out : null;
}

const STYLES = ['solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'thin', 'thin', 'hatch', 'ticks', 'squares', 'scribble', 'outline'];
const MAXP = 40;

export default {
  id: 'arcpanels',
  name: 'Arc Panels',
  engine: 'p5',
  hint: 'Hover to turn the arcs under the cursor · click to shuffle the panels',
  params: {
    bands:     { value: 26, min: 8, max: 50, step: 1, label: 'Band count', rebuild: true },
    panels:    { value: 8, min: 1, max: 16, step: 1, label: 'Panel count', rebuild: true },
    thickness: { value: 1, min: 0.3, max: 2.5, step: 0.01, label: 'Band thickness', unit: '×' },
    tilt:      { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Tilt amount' },
    detail:    { value: 1, min: 0, max: 2, step: 0.01, label: 'Detail' },
    gutter:    { value: 1, min: 0, max: 3, step: 0.01, label: 'Panel spacing', unit: '×' },
    centreY:   { value: 0.8, min: 0.3, max: 1.1, step: 0.01, label: 'Centre height' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    hover:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Hover strength' },
  },
  controls: {
    essentials: ['bands', 'panels', 'thickness', 'tilt'],
    form: ['detail', 'gutter', 'centreY'],
    motion: ['speed'],
    interaction: ['hover'],
    colour: [],
  },
  presets: {
    'Blueprint': { detail: 1.8, thickness: 0.6, bands: 36 },
    'Bold bands': { thickness: 2, bands: 14, detail: 0.5 },
    'Shattered': { panels: 14, tilt: 2, gutter: 1.6 },
  },
  interactions: { hover: 'turns the arcs that pass under the cursor', click: 'shuffles the panel layout' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 1e6);
    const rnd = mulberry(seed);
    let clock = 0;

    // ---- Bands: radius, width, partial angle, style and colour ----
    const bands = [];
    {
      let r = 0.025;
      for (let i = 0; i < P.bands; i++) {
        let style = STYLES[rnd.int(0, STYLES.length - 1)];
        if (i < 2) style = 'solid';
        const thick = style === 'solid' && rnd() < 0.55;
        const w = style === 'thin' ? rnd.range(0.004, 0.009) : thick ? rnd.range(0.03, 0.07) : rnd.range(0.012, 0.03);
        const full = rnd() < 0.2;
        const len = full ? TAU : rnd.range(0.9, 4.2);
        const mid = -Math.PI / 2 + rnd.range(-1.3, 1.3); // most arcs face up, into the page
        const b = {
          r, w, style, col: rnd.int(0, 7),
          a0: mid - len / 2, len,
          spin: rnd.range(-0.03, 0.03), turn: 0, dir: rnd() < 0.5 ? -1 : 1,
          scr: style === 'scribble' ? Array.from({ length: 70 }, () => ({ a: rnd.range(0, TAU), f: rnd(), l: rnd.range(0.02, 0.09), c: rnd.int(0, 3), k: rnd.range(-1, 1) })) : null,
          sq: style === 'squares' ? Array.from({ length: 40 }, () => ({ a: rnd.range(0, TAU), f: rnd.int(0, 2), c: rnd.int(0, 7) })) : null,
        };
        bands.push(b);
        r += w + rnd.range(0.002, 0.022) * (60 / (P.bands + 30));
      }
      // Normalise so the outer band reaches past the far corner.
      const scale = 1.25 / r;
      for (const b of bands) { b.r *= scale; b.w *= scale; }
    }
    // Hairline circles between bands, and outlined discs sitting on the arcs.
    const hairs = Array.from({ length: Math.round(P.bands * 2.2) }, () => rnd.range(0.02, 1.25));
    const discs = Array.from({ length: 9 }, () => ({ b: rnd.int(2, P.bands - 1), a: rnd.range(0, TAU), r: rnd.range(0.02, 0.08), half: rnd() < 0.6, ha: rnd.range(0, TAU), col: rnd.int(0, 7) }));
    // Clusters of small square markers, checkered like pixels.
    const markers = [];
    for (let k = 0; k < 6; k++) {
      const b = bands[rnd.int(2, bands.length - 1)];
      const a = rnd.range(0, TAU), n = rnd.int(5, 14);
      for (let i = 0; i < n; i++) markers.push({ r: b.r + rnd.range(-0.03, 0.05), a: a + rnd.range(-0.12, 0.12), gx: rnd.int(-3, 3), gy: rnd.int(-3, 3), col: rnd.int(0, 7) });
    }

    // ---- Panel layout as a flat list of numbers, so a shuffle can glide between two layouts ----
    const topCols = Math.max(1, Math.round(P.panels * 0.45));
    const botCols = Math.max(1, Math.round(P.panels * 0.3));
    const nFr = Math.max(0, P.panels - topCols - botCols);
    function makeLayout(r) {
      const v = [];
      const yL = r.range(0.42, 0.6);
      v.push(yL, yL + r.range(-0.14, 0.14));
      // Column edges stay within a quarter column of their slot, so panels never collapse into slivers.
      const cols = (n) => { for (let k = 1; k < n; k++) { const b = (k + r.range(-0.2, 0.2)) / n; v.push(b + r.range(-0.1, 0.1) / n, b + r.range(-0.2, 0.2) / n); } };
      cols(topCols); cols(botCols);
      for (let k = 0; k < nFr; k++) v.push(r.range(0.15, 0.85), r.range(0.15, 0.9), r.range(-1.3, 1.3) + (r() < 0.5 ? 0 : Math.PI / 2));
      for (let k = 0; k < MAXP; k++) v.push(r.range(-0.1, 0.1), r.range(-0.012, 0.012), r.range(-0.012, 0.012));
      v.push(r.int(1, 1e6)); // band mask seed
      return v;
    }
    let layout = makeLayout(rnd), fromLayout = null, shuffle = 1;

    // Builds the panel polygons (in px) from a layout.
    function buildPanels(L, W, H, tilt) {
      const m = Math.min(W, H) * 0.045;
      const page = [[m, m], [W - m, m], [W - m, H - m], [m, H - m]];
      let i = 0;
      const yL = L[i++], yR = L[i++];
      const ym = (yL + yR) / 2;
      const tier = splitPoly(page, 0, (ym + (yL - ym) * tilt) * H, W, ((yR - yL) * tilt) * H) || [page, null];
      // splitPoly returns [side ≥ 0, side < 0]; with a rightward line, side ≥ 0 is the top.
      let top = [tier[0]], bot = tier[1] ? [tier[1]] : [];
      const cut = (pieces, xt, xb) => {
        const xm = (xt + xb) / 2;
        const out = [];
        for (const pc of pieces) {
          const s = splitPoly(pc, (xm + (xt - xm) * tilt) * W, 0, ((xb - xt) * tilt) * W, H);
          if (s) out.push(...s); else out.push(pc);
        }
        return out;
      };
      for (let k = 1; k < topCols; k++) { top = cut(top, L[i], L[i + 1]); i += 2; }
      for (let k = 1; k < botCols; k++) { bot = cut(bot, L[i], L[i + 1]); i += 2; }
      let all = [...top, ...bot];
      for (let k = 0; k < nFr; k++) {
        const px = L[i] * W, py = L[i + 1] * H, a = L[i + 2]; i += 3;
        const idx = all.findIndex((pc) => inside(pc, px, py));
        if (idx < 0) continue;
        const s = splitPoly(all[idx], px, py, Math.cos(a), Math.sin(a));
        if (s) all.splice(idx, 1, ...s);
      }
      return { polys: all, props: i };
    }
    function inside(poly, x, y) {
      let sgn = 0;
      for (let k = 0; k < poly.length; k++) {
        const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length];
        const s = Math.sign((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0));
        if (s && sgn && s !== sgn) return false;
        if (s) sgn = s;
      }
      return true;
    }

    // ---- Colours and patterns (rebuilt when the palette changes) ----
    let palKey = '', cols = [], hatch = null, grid = null;
    function buildColours(c) {
      const pal = ctx.palette;
      const key = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4;
      if (key === palKey) return;
      palKey = key;
      const bg = rgb(pal.bg);
      const acc = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb);
      cols = [...acc.map(toHex), ...acc.map((a) => toHex(mix(a, bg, 0.42)))];
      const tile = (draw) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 8;
        const g = cv.getContext('2d');
        g.strokeStyle = hexA(pal.ink, 0.45);
        g.lineWidth = 0.7;
        draw(g);
        return c.createPattern(cv, 'repeat');
      };
      hatch = tile((g) => { g.beginPath(); g.moveTo(0, 0.5); g.lineTo(8, 0.5); g.moveTo(0, 4.5); g.lineTo(8, 4.5); g.stroke(); });
      grid = tile((g) => { g.beginPath(); g.moveTo(0, 0.5); g.lineTo(8, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, 8); g.moveTo(0, 4.5); g.lineTo(8, 4.5); g.moveTo(4.5, 0); g.lineTo(4.5, 8); g.stroke(); });
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        buildColours(c);
        clock += dt;
        const tt = clock * P.speed;
        const U = Math.max(W, H);
        const cx = W * 0.4, cy = H * P.centreY;
        const lw = Math.max(0.5, U * 0.0009);

        // Click: shuffle to a new layout and glide there.
        if (mouse.justPressed && mouse.inside) {
          fromLayout = current();
          layout = makeLayout(mulberry(Math.floor(Math.random() * 1e9)));
          shuffle = 0;
        }
        if (shuffle < 1) shuffle = Math.min(1, shuffle + dt / 0.9);
        function current() {
          if (!fromLayout || shuffle >= 1) return layout.slice();
          const k = easeInOut(shuffle);
          return layout.map((v, i) => (i === layout.length - 1 ? (k < 0.5 ? fromLayout[i] : v) : fromLayout[i] + (v - fromLayout[i]) * k));
        }
        const L = current();

        // Hover: arcs whose radius passes near the cursor keep turning while you stay there.
        if (mouse.inside && mPow > 0 && P.hover > 0) {
          const rm = Math.hypot(mouse.x * W - cx, mouse.y * H - cy) / U;
          for (const b of bands) {
            const d = (b.r + b.w / 2 - rm) / 0.05;
            b.turn += dt * Math.exp(-d * d) * 1.4 * mPow * P.hover * b.dir;
          }
        }

        // ---- Draws the whole arc system, given a panel index (for its own band mask) ----
        const maskSeed = L[L.length - 1] | 0;
        const drawArcs = (pi) => {
          // Hairline circles first.
          if (P.detail > 0) {
            c.strokeStyle = hexA(pal.ink, 0.28);
            c.lineWidth = lw * 0.8;
            c.beginPath();
            const n = Math.round(hairs.length * Math.min(1, P.detail));
            for (let i = 0; i < n; i++) { const r = hairs[i] * U; c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, TAU); }
            c.stroke();
          }
          for (let i = 0; i < bands.length; i++) {
            const b = bands[i];
            if (pi >= 0 && hash(i, pi, maskSeed) < 0.2) continue;
            const a0 = b.a0 + tt * b.spin + b.turn;
            const a1 = a0 + b.len;
            const w = b.w * U * P.thickness;
            const rm = b.r * U + w / 2;
            const col = cols[(b.col + (pi >= 0 ? Math.floor(hash(pi, i, maskSeed + 1) * 1.4) : 0)) % 8];
            c.lineCap = 'butt';
            switch (b.style) {
              case 'solid':
              case 'thin':
                c.strokeStyle = col; c.lineWidth = w;
                c.beginPath(); c.arc(cx, cy, rm, a0, a1); c.stroke();
                break;
              case 'hatch':
                if (P.detail <= 0) break;
                c.strokeStyle = i % 2 ? hatch : grid; c.lineWidth = w;
                c.beginPath(); c.arc(cx, cy, rm, a0, a1); c.stroke();
                break;
              case 'ticks':
                c.strokeStyle = pal.ink; c.lineWidth = w * 0.8;
                c.setLineDash([lw * 1.2, U * 0.006]);
                c.beginPath(); c.arc(cx, cy, rm, a0, a1); c.stroke();
                c.setLineDash([]);
                break;
              case 'outline':
                c.strokeStyle = pal.ink; c.lineWidth = lw;
                c.beginPath(); c.arc(cx, cy, b.r * U, a0, a1); c.moveTo(cx + Math.cos(a0) * (b.r * U + w), cy + Math.sin(a0) * (b.r * U + w)); c.arc(cx, cy, b.r * U + w, a0, a1); c.stroke();
                break;
              case 'squares': {
                const s = Math.max(2, w * 0.5);
                for (const q of b.sq) {
                  const rr = b.r * U + q.f * s;
                  const a = q.a + a0;
                  c.fillStyle = cols[q.c];
                  c.fillRect(cx + Math.cos(a) * rr - s / 2, cy + Math.sin(a) * rr - s / 2, s, s);
                }
                break;
              }
              case 'scribble': {
                if (P.detail <= 0) break;
                c.lineWidth = lw * 0.9;
                for (let k = 0; k < 4; k++) {
                  c.strokeStyle = hexA(cols[k], 0.75);
                  c.beginPath();
                  for (const s of b.scr) {
                    if (s.c !== k) continue;
                    const r0 = b.r * U + s.f * w, a = s.a + a0 * 0.3;
                    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
                    const r1 = b.r * U + ((s.f + s.k * 0.5 + 1) % 1) * w, a2 = a + s.l;
                    c.lineTo(cx + Math.cos(a2) * r1, cy + Math.sin(a2) * r1);
                  }
                  c.stroke();
                }
                break;
              }
              default: break;
            }
          }
          // Discs sitting on the arcs, some half-filled.
          c.lineWidth = lw;
          for (const d of discs) {
            const b = bands[d.b];
            const a = d.a + tt * b.spin + b.turn;
            const x = cx + Math.cos(a) * b.r * U, y = cy + Math.sin(a) * b.r * U, r = d.r * U;
            if (d.half) { c.fillStyle = cols[d.col]; c.beginPath(); c.arc(x, y, r, d.ha, d.ha + Math.PI); c.closePath(); c.fill(); }
            c.strokeStyle = pal.ink; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
          }
          // Square markers.
          if (P.detail > 0) {
            const s = U * 0.011;
            for (const m of markers) {
              c.fillStyle = cols[m.col];
              c.fillRect(cx + Math.cos(m.a) * m.r * U + m.gx * s - s / 2, cy + Math.sin(m.a) * m.r * U + m.gy * s - s / 2, s, s);
            }
          }
        };

        // 1. Paper, then a faint ghost of the arcs (it tints the gutters).
        c.fillStyle = pal.bg;
        c.fillRect(0, 0, W, H);
        c.globalAlpha = 0.18;
        drawArcs(-1);
        c.globalAlpha = 1;

        // 2. Each panel: clip, clean paper, its own slightly turned copy of the arcs, then a border.
        const { polys, props } = buildPanels(L, W, H, P.tilt);
        const gut = Math.min(W, H) * 0.007 * P.gutter;
        polys.forEach((poly, pi) => {
          const shape = gut > 0 ? insetPoly(poly, gut) : poly;
          if (!shape) return;
          const o = props + (pi % MAXP) * 3;
          c.save();
          c.beginPath();
          shape.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.closePath();
          c.clip();
          c.fillStyle = pal.bg;
          c.fillRect(0, 0, W, H);
          c.translate(cx + L[o + 1] * U * P.tilt, cy + L[o + 2] * U * P.tilt);
          c.rotate(L[o] * P.tilt);
          c.translate(-cx, -cy);
          drawArcs(pi);
          c.restore();
          c.strokeStyle = pal.ink;
          c.lineWidth = Math.max(0.8, U * 0.0016);
          c.beginPath();
          shape.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.closePath();
          c.stroke();
        });
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'arcpanels', name: 'Arc Panels', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Arc Panels
// One set of concentric arc bands (random widths, colours and partial lengths) centred low on
// the page. The page is cut into tilted panels; each panel clips the arcs and shows them turned
// by its own small angle, so the drawing looks fractured and misregistered.
// Hover turns the arcs passing under the cursor. Click shuffles the panels.

let bands = [], panels = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED);
  let r = 0.025;
  for (let i = 0; i < params.bands; i++) {
    const w = random() < 0.4 ? random(0.03, 0.07) : random(0.006, 0.03);
    bands.push({ r, w, a0: random(TWO_PI), len: random() < 0.25 ? TWO_PI : random(0.7, 4.6),
                 col: random([colors.c1, colors.c2, colors.c3, colors.c4]), turn: 0 });
    r += w + random(0.004, 0.035);
  }
  for (const b of bands) { b.r *= 1.25 / r; b.w *= 1.25 / r; }
  makePanels();
}

function mousePressed() { makePanels(); }

// Panels: vertical strips with tilted edges, each cut once more by a tilted horizontal line.
function makePanels() {
  panels = [];
  const n = max(1, round(params.panels / 2));
  let xs = [0];
  for (let k = 1; k < n; k++) xs.push(k / n + random(-0.05, 0.05));
  xs.push(1);
  for (let k = 0; k < n; k++) {
    const cutL = random(0.35, 0.7), cutR = cutL + random(-0.1, 0.1) * params.tilt;
    const tl = xs[k], tr = xs[k + 1], skew = k > 0 && k < n ? random(-0.03, 0.03) * params.tilt : 0;
    panels.push({ pts: [[tl + skew, 0], [tr, 0], [tr, cutR], [tl + skew, cutL]], rot: random(-0.1, 0.1) * params.tilt });
    panels.push({ pts: [[tl + skew, cutL], [tr, cutR], [tr, 1], [tl, 1]], rot: random(-0.1, 0.1) * params.tilt });
  }
}

function draw() {
  background(colors.bg);
  const U = max(width, height), cx = width * 0.4, cy = height * params.centreY;
  const m = min(width, height) * 0.045, g = min(width, height) * 0.007 * params.gutter;
  const rm = dist(mouseX, mouseY, cx, cy) / U;
  for (const b of bands) b.turn += exp(-sq((b.r - rm) / 0.05)) * 0.02 * params.hover;   // hover

  for (const pn of panels) {
    const pts = pn.pts.map(([x, y]) => [m + x * (width - 2 * m), m + y * (height - 2 * m)]);
    drawingContext.save();
    beginShape(); for (const [x, y] of pts) vertex(x, y); endShape(CLOSE);
    drawingContext.clip();                                  // only draw inside this panel
    translate(cx, cy); rotate(pn.rot); translate(-cx, -cy);
    noFill();
    stroke(colors.ink + '44'); strokeWeight(0.7);           // hairline circles
    for (const b of bands) circle(cx, cy, b.r * U * 2);
    strokeCap(SQUARE);
    for (const b of bands) {                                // the coloured arc bands
      stroke(b.col); strokeWeight(b.w * U * params.thickness);
      const a = b.a0 + b.turn + millis() / 1000 * 0.02 * params.speed;
      arc(cx, cy, (b.r * U + b.w * U / 2) * 2, (b.r * U + b.w * U / 2) * 2, a, a + b.len);
    }
    drawingContext.restore();
    resetMatrix();
    noFill(); stroke(colors.ink); strokeWeight(1.2);         // panel border, inset for a gutter
    beginShape(); for (const [x, y] of pts) vertex(x + (x < width / 2 ? g : -g), y + (y < height / 2 ? g : -g)); endShape(CLOSE);
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
