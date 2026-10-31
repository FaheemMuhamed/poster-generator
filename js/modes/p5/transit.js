// Transit Board: a metro map crossed with a circuit board (refs 6, 45). Routes walk the grid
// in straight runs with rounded 90° corners, avoiding running along each other; a few are
// thin branch lines with dots and station rings. Clusters of small coloured squares (some in
// outlined cells) fill a noise density field around them. Routes, squares and stations are
// cached; each frame only draws the arrow pulses travelling along the lines.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

const UW = 600;

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const h = (x, y) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => vn(x, y) * 0.6 + vn(x * 2.1 + 3.1, y * 2.1 + 7.4) * 0.28 + vn(x * 4.3 + 1.7, y * 4.3 + 2.9) * 0.12;
}

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

export default {
  id: 'transit',
  name: 'Transit Board',
  engine: 'p5',
  hint: 'Hover a line to light it and pull its pulses toward you · click to open a new route',
  darkGround: () => true, // the poster text switches to the light colour
  params: {
    routes:    { value: 20, min: 3, max: 40, step: 1, label: 'Route count', rebuild: true },
    density:   { value: 0.8, min: 0, max: 1.5, step: 0.01, label: 'Square density', rebuild: true },
    cell:      { value: 19, min: 10, max: 40, step: 1, label: 'Cell size', rebuild: true },
    pulses:    { value: 1, min: 0, max: 3, step: 0.01, label: 'Pulse count' },
    corner:    { value: 1.4, min: 0, max: 3, step: 0.05, label: 'Corner size', rebuild: true },
    outline:   { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Outline amount', rebuild: true },
    branches:  { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Branch amount', rebuild: true },
    thickness: { value: 1, min: 0.4, max: 2.5, step: 0.01, label: 'Line thickness' },
    speed:     { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
    pull:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
  },
  controls: {
    essentials: ['routes', 'density', 'cell', 'pulses'],
    form: ['corner', 'outline', 'branches', 'thickness'],
    motion: ['speed'],
    interaction: ['pull'],
    colour: [],
    type: [],
  },
  presets: {
    'Metro': { routes: 24, density: 0.3, corner: 2.2, branches: 0.5, cell: 16 },
    'Circuit': { cell: 12, corner: 0.6, density: 1.1, routes: 30, outline: 0.7 },
    'Pixel city': { density: 1.4, outline: 0.9, routes: 8, pulses: 2 },
  },
  interactions: { hover: 'lights up nearby lines and pulls their pulses toward the cursor', click: 'opens a new route from that cell, drawn out with pulses' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 2 ** 30);
    let W = 100, H = 100, DPR = 1, S = 1, HU = 140;
    let board = null;
    let dirty = true;
    const buf = document.createElement('canvas');
    const bc = buf.getContext('2d');
    let cols = null;

    // ---------- generation (units, poster = 600 wide) ----------
    function generate() {
      const rng = makeRng(seed);
      const rf = (a, b) => a + (b - a) * rng();
      const ri = (a, b) => Math.floor(rf(a, b + 1));
      const noise = makeNoise(Math.floor(rng() * 1e6));
      const g = P.cell;
      const nx = Math.floor(UW / g), ny = Math.floor(HU / g);
      const ox = (UW - nx * g) / 2 + g / 2, oy = (HU - ny * g) / 2 + g / 2;
      const occ = new Map(); // cell -> bit 1 horizontal run, 2 vertical run
      const key = (i, j) => i * 4096 + j;
      const cx = (i) => ox + i * g, cy = (j) => oy + j * g;

      // A route: straight runs of 3–14 cells, turning left or right, never running along another.
      function walk(i, j, d, isBranch, maxTurns) {
        const corners = [[i, j]];
        occ.set(key(i, j), (occ.get(key(i, j)) || 0) | 3);
        let turns = 0, fails = 0, exited = false;
        while (turns < maxTurns && fails < 3) {
          const len = ri(isBranch ? 2 : 3, isBranch ? 8 : 14);
          const bit = d % 2 === 0 ? 1 : 2;
          let moved = 0;
          for (let k = 0; k < len; k++) {
            const ni = i + DX[d], nj = j + DY[d];
            if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) {
              if (!isBranch && moved + k > 0) { i = ni + DX[d]; j = nj + DY[d]; moved++; exited = true; }
              break;
            }
            const o = occ.get(key(ni, nj)) || 0;
            if (o & bit) break;
            i = ni; j = nj; moved++;
            occ.set(key(i, j), o | bit);
          }
          if (moved === 0) { fails++; d = (d + (rng() < 0.5 ? 1 : 3)) % 4; continue; }
          fails = 0;
          corners.push([i, j]);
          if (exited) break;
          occ.set(key(i, j), (occ.get(key(i, j)) || 0) | 3);
          d = (d + (rng() < 0.5 ? 1 : 3)) % 4;
          turns++;
        }
        return corners.length > 1 ? corners : null;
      }

      // Corner list -> sampled polyline (rounded corners as quadratic curves) + arc lengths.
      function shape(corners) {
        const pts = corners.map(([i, j]) => [cx(i), cy(j)]);
        const out = [pts[0]];
        for (let k = 1; k < pts.length - 1; k++) {
          const a = pts[k - 1], b = pts[k], c = pts[k + 1];
          const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
          const r = Math.min(P.corner * g, l1 / 2, l2 / 2);
          if (r < 0.5) { out.push(b); continue; }
          const p0 = [b[0] + ((a[0] - b[0]) / l1) * r, b[1] + ((a[1] - b[1]) / l1) * r];
          const p2 = [b[0] + ((c[0] - b[0]) / l2) * r, b[1] + ((c[1] - b[1]) / l2) * r];
          for (let s = 0; s <= 8; s++) {
            const t = s / 8, u = 1 - t;
            out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
          }
        }
        out.push(pts[pts.length - 1]);
        const cum = [0];
        for (let k = 1; k < out.length; k++) cum.push(cum[k - 1] + Math.hypot(out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]));
        return { pts: out, cum, len: cum[cum.length - 1], corners: pts };
      }

      function makeRoute(i, j, d, isBranch, born) {
        const c = walk(i, j, d, isBranch, isBranch ? ri(2, 5) : ri(3, 9));
        if (!c) return null;
        const r = shape(c);
        if (r.len < g * 3) return null;
        r.branch = isBranch;
        r.born = born;
        r.hl = 0;
        // Branch lines: dots, small stations at corners and sometimes a big ring station.
        r.dots = [];
        r.stations = [];
        if (isBranch) {
          for (let s = g * 0.8; s < r.len - g * 0.5; s += g * rf(0.7, 1.6)) if (rng() < 0.6) r.dots.push(s);
          for (let k = 1; k < r.corners.length; k++) if (rng() < 0.35) r.stations.push({ p: r.corners[k], ring: 0 });
          if (rng() < 0.6) {
            const s = rf(0.2, 0.8) * r.len;
            r.stations.push({ p: posAt(r, s), ring: ri(2, 3) });
          }
        }
        // Pulses: groups of arrowheads that run along the line.
        r.pulses = [];
        const n = Math.max(1, Math.round(r.len / (g * 9)));
        for (let k = 0; k < n * 3; k++) {
          const v = rf(0.7, 1.3) * (rng() < 0.5 ? 1 : -1);
          r.pulses.push({ s: rng() * r.len, v, dir: Math.sign(v), n: ri(1, 3), k: k / 3 });
        }
        return r;
      }

      const routes = [];
      let tries = 0;
      while (routes.length < P.routes && tries++ < P.routes * 8) {
        const isBranch = rng() < P.branches;
        let i, j, d;
        if (!isBranch && rng() < 0.55) {
          // Enter from an edge.
          d = ri(0, 3);
          i = d === 0 ? 0 : d === 2 ? nx - 1 : ri(0, nx - 1);
          j = d === 1 ? 0 : d === 3 ? ny - 1 : ri(0, ny - 1);
        } else { i = ri(1, nx - 2); j = ri(1, ny - 2); d = ri(0, 3); }
        const r = makeRoute(i, j, d, isBranch, -1);
        if (r) routes.push(r);
      }

      // Squares in the density field, skipping cells a route runs through.
      const squares = [];
      const thr = 0.68 - P.density * 0.22;
      const fq = 0.11 * (19 / g) ** 0.5;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          if (occ.has(key(i, j))) continue;
          const v = noise(i * fq, j * fq);
          if (v < thr || rng() < 0.12) continue;
          squares.push({
            x: cx(i), y: cy(j), col: ri(0, 4),
            box: v > thr + 0.04 && rng() < P.outline,
            hollow: rng() < 0.06,
          });
        }
      }
      return { g, nx, ny, routes, squares, occ, rng, rf, ri, makeRoute, cx, cy, ox, oy, extra: [] };
    }

    function posAt(r, s) {
      s = Math.max(0, Math.min(r.len, s));
      let lo = 0, hi = r.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] < s) lo = m; else hi = m; }
      const a = r.pts[lo], b = r.pts[hi];
      const f = (s - r.cum[lo]) / (r.cum[hi] - r.cum[lo] || 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])];
    }

    // ---------- colours ----------
    function colours() {
      const pal = ctx.palette;
      const bg = hexRgb(pal.bg), ink = hexRgb(pal.ink);
      const ground = lum(bg) < lum(ink) ? bg : ink, light = lum(bg) < lum(ink) ? ink : bg;
      const gl = lum(ground);
      // Accents that would vanish on the ground are lifted toward the light colour.
      const vivid = (c) => { let o = c; for (let k = 0; k < 8 && Math.abs(lum(o) - gl) < 0.32; k++) o = mix(o, light, 0.15); return o; };
      const acc = ['c1', 'c2', 'c3', 'c4'].map((k) => vivid(hexRgb(pal[k])));
      let cool = acc[0], bc = -1e9;
      // Branch lines take the most vivid accent, leaning toward cool hues.
      for (const a of acc) { const s = Math.max(...a) - Math.min(...a) + (a[2] - a[0]) * 0.6; if (s > bc) { bc = s; cool = a; } }
      return { ground, light, acc, cool, squares: [...acc, light] };
    }

    // ---------- cached board ----------
    function strokeRoute(c, r, upto = Infinity) {
      c.beginPath();
      const pts = r.pts;
      c.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) {
        if (r.cum[k] > upto) { const q = posAt(r, upto); c.lineTo(q[0], q[1]); break; }
        c.lineTo(pts[k][0], pts[k][1]);
      }
      c.stroke();
    }
    function drawRoute(c, r, g, upto = Infinity) {
      const th = P.thickness;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.strokeStyle = css(r.branch ? cols.cool : cols.light, r.branch ? 0.95 : 0.85);
      c.lineWidth = (r.branch ? 0.9 : 1.15) * th;
      strokeRoute(c, r, upto);
      const end = Math.min(upto, r.len);
      if (r.branch) {
        c.fillStyle = css(cols.cool);
        c.beginPath();
        for (const s of r.dots) { if (s > end) break; const q = posAt(r, s); c.moveTo(q[0] + g * 0.09, q[1]); c.arc(q[0], q[1], g * 0.09 * th, 0, Math.PI * 2); }
        c.fill();
        c.lineWidth = 0.9 * th;
        for (const st of r.stations) {
          const [x, y] = st.p;
          const rr = st.ring ? g * 0.3 : g * 0.18;
          c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2);
          c.fillStyle = css(cols.ground); c.fill(); c.stroke();
          for (let k = 1; k < st.ring; k++) { c.beginPath(); c.arc(x, y, rr + k * g * 0.22, 0, Math.PI * 2); c.stroke(); }
        }
        // Open circles at the ends.
        for (const s of [0, end]) {
          const q = posAt(r, s);
          c.beginPath(); c.arc(q[0], q[1], g * 0.2, 0, Math.PI * 2);
          c.fillStyle = css(cols.ground); c.fill(); c.stroke();
        }
      }
    }
    function renderBoard() {
      dirty = false;
      cols = colours();
      buf.width = Math.max(1, Math.round(W * DPR));
      buf.height = Math.max(1, Math.round(H * DPR));
      const c = bc;
      c.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
      c.fillStyle = css(cols.ground);
      c.fillRect(-2, -2, UW + 4, HU + 4);
      const g = board.g;
      // Outlined cells first, then the squares.
      c.strokeStyle = css(cols.light, 0.75);
      c.lineWidth = 0.6 * P.thickness;
      c.beginPath();
      for (const q of board.squares) if (q.box) c.rect(q.x - g / 2, q.y - g / 2, g, g);
      c.stroke();
      const sz = g * 0.36;
      for (let k = 0; k < cols.squares.length; k++) {
        c.fillStyle = css(cols.squares[k]);
        c.strokeStyle = css(cols.squares[k]);
        c.lineWidth = 0.8 * P.thickness;
        c.beginPath();
        for (const q of board.squares) if (q.col === k && !q.hollow) c.rect(q.x - sz / 2, q.y - sz / 2, sz, sz);
        c.fill();
        c.beginPath();
        for (const q of board.squares) if (q.col === k && q.hollow) c.rect(q.x - sz / 2, q.y - sz / 2, sz, sz);
        c.stroke();
      }
      for (const r of board.routes) drawRoute(c, r, g);
    }

    // ---------- frame ----------
    let palSig = '';
    const hov = { x: 300, y: 300, amt: 0 };
    const stage = createP5Stage(ctx, {
      setup() {},
      draw(p, t, dt) {
        const c = p.drawingContext;
        const pal = ctx.palette;
        const sig = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4;
        if (sig !== palSig) { palSig = sig; dirty = true; }
        if (!board) board = generate();
        const g = board.g;

        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse * P.pull;
        const ux = ptr.x * UW, uy = ptr.y * HU;
        const on = ptr.inside && mPow > 0;
        if (on) { hov.x = ux; hov.y = uy; }
        hov.amt += ((on ? Math.min(1.5, mPow) : 0) - hov.amt) * (1 - Math.pow(0.004, dt));
        const reach = g * 3.5;

        // Click: a new route from this cell, drawn out over a second.
        if (ptr.justPressed && ptr.inside && ctx.state.motion.mouse > 0) {
          const i = Math.round((ux - board.ox) / g), j = Math.round((uy - board.oy) / g);
          if (i >= 0 && j >= 0 && i < board.nx && j < board.ny) {
            let r = null;
            for (let k = 0; k < 6 && !r; k++) r = board.makeRoute(i, j, board.ri(0, 3), board.rng() < 0.35, t);
            if (r) {
              board.extra.push(r);
              if (board.extra.length > 10) { board.extra.shift(); }
            }
          }
        }
        // Finished new routes join the cached board.
        for (const r of board.extra) {
          if (!r.cached && t - r.born > r.len / (g * 30) + 0.2) {
            r.cached = true;
            board.routes.push(r);
            if (!dirty) { bc.setTransform(S * DPR, 0, 0, S * DPR, 0, 0); drawRoute(bc, r, g); }
          }
        }
        if (dirty) renderBoard();

        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(buf, 0, 0, c.canvas.width, c.canvas.height);
        c.restore();

        c.save();
        c.scale(S, S);
        const th = P.thickness;

        // Routes still being drawn out.
        for (const r of board.extra) {
          if (r.cached) continue;
          const upto = (t - r.born) * g * 30;
          drawRoute(c, r, g, upto);
          const q = posAt(r, upto);
          c.fillStyle = css(cols.light);
          c.beginPath(); c.arc(q[0], q[1], g * 0.22, 0, Math.PI * 2); c.fill();
        }

        // Hover: nearby lines light up.
        const near = (x, y) => Math.hypot(x - hov.x, y - hov.y);
        for (const r of board.routes) {
          let target = 0;
          if (hov.amt > 0.01) {
            let best = Infinity;
            for (let k = 0; k < r.pts.length; k += 2) { const d = near(r.pts[k][0], r.pts[k][1]); if (d < best) best = d; }
            target = best < reach ? hov.amt * (1 - best / reach) : 0;
          }
          r.hl += (Math.min(1, target * 1.6) - r.hl) * (1 - Math.pow(0.002, dt || 0.016));
          if (r.hl > 0.02) {
            c.save();
            c.shadowColor = css(cols.cool, r.hl);
            c.shadowBlur = g * 0.6 * S * p.pixelDensity();
            c.strokeStyle = css(r.branch ? cols.light : cols.cool, r.hl);
            c.lineWidth = (r.branch ? 1.6 : 2) * th;
            c.lineJoin = 'round';
            strokeRoute(c, r);
            c.restore();
          }
        }

        // Pulses: groups of arrowheads. Near the cursor they turn and run toward it.
        const sp = P.speed * g * 2.2;
        const a = g * 0.2;
        const visible = (pl) => pl.k < P.pulses;
        {
          for (const r of board.routes) {
            c.fillStyle = css(r.hl > 0.3 ? cols.cool : r.branch ? cols.cool : cols.light);
            c.beginPath();
            for (const pl of r.pulses) {
              if (!visible(pl)) continue;
              let dir = pl.dir;
              if (hov.amt > 0.01) {
                const q = posAt(r, pl.s);
                const d0 = near(q[0], q[1]);
                if (d0 < reach * 1.4) {
                  const qa = posAt(r, pl.s + g * 0.3), qb = posAt(r, pl.s - g * 0.3);
                  const toward = near(qa[0], qa[1]) < near(qb[0], qb[1]) ? 1 : -1;
                  dir = d0 < g * 0.4 ? 0 : toward;
                }
              }
              pl.vv = pl.vv === undefined ? pl.v : pl.vv;
              const target = dir === pl.dir ? pl.v : dir * Math.abs(pl.v) * (1 + hov.amt);
              pl.vv += (target - pl.vv) * Math.min(1, dt * 4);
              pl.s += pl.vv * sp * dt;
              if (pl.s > r.len) pl.s -= r.len;
              if (pl.s < 0) pl.s += r.len;
              const fdir = pl.vv >= 0 ? 1 : -1;
              for (let k = 0; k < pl.n; k++) {
                const s = pl.s - fdir * k * a * 2.4;
                if (s < 0 || s > r.len) continue;
                const [x, y, ang0] = posAt(r, s);
                const ang = fdir > 0 ? ang0 : ang0 + Math.PI;
                const ca = Math.cos(ang), sa = Math.sin(ang);
                c.moveTo(x + ca * a, y + sa * a);
                c.lineTo(x - ca * a - sa * a * 0.6, y - sa * a + ca * a * 0.6);
                c.lineTo(x - ca * a + sa * a * 0.6, y - sa * a - ca * a * 0.6);
                c.closePath();
              }
            }
            c.fill();
          }
        }
        c.restore();
        drawGrain(c, W, H, ctx.state.grain * 0.6);
      },
    });

    return {
      resize(w, h, dpr) {
        const hu = (UW * h) / w;
        const regen = Math.abs(hu - HU) > 0.5 || !board;
        W = w; H = h; DPR = dpr; S = w / UW; HU = hu;
        stage.resize(w, h, dpr);
        if (regen) board = generate();
        dirty = true;
      },
      frame: stage.frame,
      onParam(key) { if (key === 'palette' || key === 'thickness') dirty = true; },
      dispose() { stage.dispose(); buf.width = buf.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'transit', name: 'Transit Board', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (no stations, hover glow or grain).
const SKETCH = String.raw`
// Transit Board
// Routes walk a grid in straight runs and turn left or right with rounded corners; a cell
// can't be used twice in the same direction, so lines cross but never run on top of each
// other. Small coloured squares fill a noise field around them. Arrow pulses ride the lines.
// Click to open a new route.

let g, nx, ny, used = new Map(), routes = [], squares = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  g = params.cell * width / 600;
  nx = floor(width / g); ny = floor(height / g);
  for (let k = 0; k < params.routes; k++) addRoute(floor(random(nx)), floor(random(ny)));
  // Squares where the noise field is high and no route passes.
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (used.has(i + ',' + j) || noise(i * 0.11, j * 0.11) < 0.68 - params.density * 0.22 || random() < 0.12) continue;
    squares.push({ i, j, col: random([colors.c1, colors.c2, colors.c4, colors.bg]), box: random() < params.outline });
  }
}

function addRoute(i, j) {
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let d = floor(random(4)), pts = [[i, j]];
  for (let turn = 0; turn < 6; turn++) {
    const len = floor(random(3, 14)), bit = d % 2 ? 'v' : 'h';
    let moved = 0;
    for (let k = 0; k < len; k++) {
      const ni = i + dirs[d][0], nj = j + dirs[d][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || used.get(ni + ',' + nj) === bit) break;
      i = ni; j = nj; moved++;
      used.set(i + ',' + j, bit);
    }
    if (moved) pts.push([i, j]);
    d = (d + (random() < 0.5 ? 1 : 3)) % 4;
  }
  if (pts.length < 2) return;
  const path = roundCorners(pts.map(([a, b]) => createVector((a + 0.5) * g, (b + 0.5) * g)), params.corner * g);
  routes.push({ path, pulses: [random(), random(), random()] });
}

// Replace each corner with a short quadratic curve.
function roundCorners(p, R) {
  const out = [p[0]];
  for (let k = 1; k < p.length - 1; k++) {
    const r = min(R, p5.Vector.dist(p[k - 1], p[k]) / 2, p5.Vector.dist(p[k], p[k + 1]) / 2);
    const a = p5.Vector.lerp(p[k], p[k - 1], r / p5.Vector.dist(p[k], p[k - 1]));
    const b = p5.Vector.lerp(p[k], p[k + 1], r / p5.Vector.dist(p[k], p[k + 1]));
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      out.push(p5.Vector.lerp(p5.Vector.lerp(a, p[k], t), p5.Vector.lerp(p[k], b, t), t));
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

function mousePressed() { addRoute(floor(mouseX / g), floor(mouseY / g)); }

function draw() {
  background(colors.ink);
  noStroke();
  for (const q of squares) {
    fill(q.col); rect((q.i + 0.32) * g, (q.j + 0.32) * g, g * 0.36, g * 0.36);
    if (q.box) { noFill(); stroke(colors.bg); strokeWeight(0.6); rect(q.i * g, q.j * g, g, g); noStroke(); }
  }
  for (const r of routes) {
    noFill(); stroke(colors.bg); strokeWeight(1.2 * params.thickness);
    beginShape(); for (const v of r.path) vertex(v.x, v.y); endShape();
    // Pulses: a point moving along the polyline.
    noStroke(); fill(colors.bg);
    for (let k = 0; k < r.pulses.length; k++) {
      const f = (r.pulses[k] + frameCount * 0.001 * params.speed) % 1;
      const idx = f * (r.path.length - 1), a = r.path[floor(idx)], b = r.path[ceil(idx)];
      const p = p5.Vector.lerp(a, b, idx % 1);
      circle(p.x, p.y, g * 0.3);
    }
  }
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
