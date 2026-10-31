// Night Map: a city at night seen from orbit (ref 3). A wide river winds across deep blue
// ground; districts grow dense nets of thin glowing streets (tips that step, branch at right
// angles and stop when they meet another road), and a few warm arterial roads cross the map.
// Everything is generated in map units (600 wide), drawn once into an offscreen buffer and
// only extended as new streets grow; each frame adds traffic, the cursor glow and flashes.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

const UW = 600;
const CELL = 6;

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
  const fbm = (x, y) => vn(x, y) * 0.5 + vn(x * 2.03 + 5.2, y * 2.03 + 1.3) * 0.28 + vn(x * 4.1 + 9.1, y * 4.1 + 7.7) * 0.14 + vn(x * 8.3 + 3.3, y * 8.3 + 2.2) * 0.08;
  return { vn, fbm };
}

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Point to polyline distance (also returns the nearest segment index).
function polyDist(pts, x, y) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - a[0] - dx * t, ey = y - a[1] - dy * t;
    const d = ex * ex + ey * ey;
    if (d < best) { best = d; bi = i; }
  }
  return { d: Math.sqrt(best), i: bi };
}
// Where segment a→b first crosses segment c→d (t along a→b), or -1.
function cross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t > 1e-4 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export default {
  id: 'nightmap',
  name: 'Night Map',
  engine: 'p5',
  hint: 'Hover to light up and grow the streets · click to found a new district',
  darkGround: () => true, // the poster text switches to the light colour
  params: {
    density:   { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Road density', rebuild: true },
    districts: { value: 8, min: 2, max: 16, step: 1, label: 'District count', rebuild: true },
    river:     { value: 1, min: 0, max: 2, step: 0.05, label: 'River size', rebuild: true },
    glow:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Glow amount' },
    arterials: { value: 5, min: 0, max: 10, step: 1, label: 'Arterial count', rebuild: true },
    thickness: { value: 1, min: 0.4, max: 2.5, step: 0.01, label: 'Line thickness' },
    relief:    { value: 0.8, min: 0, max: 1.5, step: 0.01, label: 'Relief amount' },
    speed:     { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
    reach:     { value: 1, min: 0.4, max: 2, step: 0.01, label: 'Hover size' },
  },
  controls: {
    essentials: ['density', 'districts', 'river', 'glow'],
    form: ['arterials', 'thickness', 'relief'],
    motion: ['speed'],
    interaction: ['reach'],
    colour: [],
    type: [],
  },
  presets: {
    'Megacity': { density: 1.7, districts: 14, arterials: 8, glow: 1.3 },
    'River town': { density: 0.7, districts: 4, river: 1.6, arterials: 3 },
    'Blackout': { glow: 0.25, relief: 1.4, density: 0.8, speed: 0.3 },
  },
  interactions: { hover: 'lights up the streets near the cursor and grows new ones', click: 'founds a new district that grows outward' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 2 ** 30);
    let W = 100, H = 100, DPR = 1, S = 1, HU = 140;
    let map = null;
    let dirty = true;
    const buf = document.createElement('canvas');
    const bc = buf.getContext('2d');
    let cols = null;

    // ---------- generation (map units) ----------
    function generate() {
      const rng = makeRng(seed);
      const rf = (a, b) => a + (b - a) * rng();
      const noise = makeNoise(Math.floor(rng() * 1e6));
      const Hu = HU;

      // River: a long meander from one edge to the other.
      let river = null;
      if (P.river > 0.02) {
        const pts = [];
        const x0 = rf(0.3, 0.7) * UW, tilt = rf(-0.35, 0.35);
        const A1 = rf(70, 120), f1 = rf(0.006, 0.01), p1 = rf(0, 6.28);
        const A2 = rf(20, 45), f2 = rf(0.015, 0.025), p2 = rf(0, 6.28);
        for (let s = -40; s <= Hu + 40; s += 5) {
          const wob = (noise.vn(s * 0.012, 5.5) - 0.5) * 70;
          pts.push([x0 + tilt * (s - Hu / 2) + A1 * Math.sin(s * f1 + p1) + A2 * Math.sin(s * f2 + p2) + wob, s]);
        }
        const hw = pts.map((_, i) => P.river * 14 * (0.75 + 0.5 * noise.vn(i * 0.07, 3.3)));
        river = { pts, hw };
      }
      const riverAt = (x, y) => {
        if (!river) return { d: Infinity, hw: 0 };
        const q = polyDist(river.pts, x, y);
        return { d: q.d, hw: river.hw[q.i] };
      };

      // Districts: centres of light, preferring the river banks.
      const districts = [];
      for (let i = 0; i < P.districts; i++) {
        let best = null;
        for (let k = 0; k < 6; k++) {
          const x = rf(0.06, 0.94) * UW, y = rf(0.05, 0.95) * Hu;
          const rq = riverAt(x, y);
          if (rq.d < rq.hw + 6) continue;
          let score = rng() + (river ? Math.exp(-(((rq.d - 50) / 70) ** 2)) : 0);
          for (const o of districts) score -= Math.exp(-((Math.hypot(o.x - x, o.y - y) / 90) ** 2));
          if (!best || score > best.score) best = { x, y, score };
        }
        if (!best) continue;
        districts.push({ x: best.x, y: best.y, r: rf(65, 140), w: rf(0.75, 1.1), a: rf(0, Math.PI / 2), organic: rf(0, 1) });
      }

      const segs = [];
      const grid = new Map();
      const gx0 = -40, gy0 = -40;
      const cellOf = (x, y) => ((Math.floor((x - gx0) / CELL) & 0xffff) << 16) | (Math.floor((y - gy0) / CELL) & 0xffff);
      function addSeg(x0, y0, x1, y1, kind, b) {
        const i = segs.length;
        segs.push({ x0, y0, x1, y1, kind, b, born: -1 });
        const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
        for (let gx = Math.floor((minx - gx0) / CELL); gx <= Math.floor((maxx - gx0) / CELL); gx++) {
          for (let gy = Math.floor((miny - gy0) / CELL); gy <= Math.floor((maxy - gy0) / CELL); gy++) {
            const k = ((gx & 0xffff) << 16) | (gy & 0xffff);
            let a = grid.get(k);
            if (!a) grid.set(k, (a = []));
            a.push(i);
          }
        }
        return i;
      }
      function near(x0, y0, x1, y1, pad, out) {
        out.length = 0;
        const seen = near.seen || (near.seen = new Set());
        seen.clear();
        for (let gx = Math.floor((Math.min(x0, x1) - pad - gx0) / CELL); gx <= Math.floor((Math.max(x0, x1) + pad - gx0) / CELL); gx++) {
          for (let gy = Math.floor((Math.min(y0, y1) - pad - gy0) / CELL); gy <= Math.floor((Math.max(y0, y1) + pad - gy0) / CELL); gy++) {
            const a = grid.get(((gx & 0xffff) << 16) | (gy & 0xffff));
            if (a) for (const i of a) if (!seen.has(i)) { seen.add(i); out.push(i); }
          }
        }
        return out;
      }

      // Arterials: long curving roads between districts and off the edges.
      const arterials = [];
      const curve = (ax, ay, bx, by) => {
        const pts = [];
        const L = Math.hypot(bx - ax, by - ay);
        const n = Math.max(4, Math.round(L / 6));
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        const bend = rf(-0.18, 0.18) * L, ph = rf(0, 100);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const off = Math.sin(t * Math.PI) * bend + (noise.vn(t * 6 + ph, 1.7) - 0.5) * 30 * Math.sin(t * Math.PI);
          pts.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
        }
        return pts;
      };
      const edgePoint = () => {
        const s = rng() * 4 | 0;
        return s === 0 ? [-20, rf(0, Hu)] : s === 1 ? [UW + 20, rf(0, Hu)] : s === 2 ? [rf(0, UW), -20] : [rf(0, UW), Hu + 20];
      };
      for (let i = 0; i < P.arterials; i++) {
        const a = districts.length && rng() < 0.75 ? districts[i % districts.length] : null;
        const A = a ? [a.x, a.y] : edgePoint();
        const b = districts.length > 1 && rng() < 0.4 ? districts[(i * 3 + 1) % districts.length] : null;
        const B = b && b !== a ? [b.x, b.y] : edgePoint();
        const pts = curve(A[0], A[1], B[0], B[1]);
        arterials.push(pts);
      }
      // One more hugging the river bank.
      if (river && P.arterials > 0) {
        const side = rng() < 0.5 ? -1 : 1;
        const pts = [];
        for (let i = 0; i < river.pts.length - 1; i++) {
          const a = river.pts[i], b = river.pts[i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          const o = river.hw[i] + 3.5;
          pts.push([a[0] - (dy / l) * o * side, a[1] + (dx / l) * o * side]);
        }
        arterials.push(pts);
      }
      for (const pts of arterials) for (let i = 0; i < pts.length - 1; i++) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1, 1);
      const roadStart = segs.length;

      // Light density: districts plus a faint scatter.
      const density = (x, y, extra = 0) => {
        let v = 0;
        for (const d of districts) {
          const q = Math.hypot(x - d.x, y - d.y) / d.r;
          if (q < 2.5) v = Math.max(v, d.w * Math.exp(-q * q));
        }
        return Math.min(1.2, v + (noise.fbm(x * 0.012, y * 0.012) - 0.45) * 0.25 + extra);
      };
      const orientAt = (x, y) => {
        let best = 0, bw = -1, org = 0.5;
        for (const d of districts) {
          const w = Math.exp(-((Math.hypot(x - d.x, y - d.y) / d.r) ** 2));
          if (w > bw) { bw = w; best = d.a; org = d.organic; }
        }
        return { a: best, organic: org };
      };

      // ---------- street growth ----------
      // A tip steps forward, wobbles, branches at right angles, and stops at another road.
      const queue = [];
      const tmp = [];
      function seedDistrict(d, n) {
        for (let k = 0; k < n; k++) queue.push({ x: d.x + rf(-3, 3), y: d.y + rf(-3, 3), a: d.a + (k % 4) * Math.PI / 2 + rf(-0.05, 0.05), life: 0 });
      }
      function stepTip(tip, boost, now) {
        const { x, y } = tip;
        const dens = density(x, y, boost ? boost(x, y) : 0);
        if (dens < 0.04 + rng() * 0.08) return false;
        const L = 2.6 + 6 * Math.max(0, 1 - dens);
        const o = orientAt(x, y);
        // Straight streets in planned districts, winding lanes in organic ones and the outskirts.
        const wob = (0.06 + 0.5 * o.organic * (1.1 - Math.min(1, dens))) * (rng() - 0.5);
        tip.a += wob;
        const nx = x + Math.cos(tip.a) * L, ny = y + Math.sin(tip.a) * L;
        if (nx < -30 || nx > UW + 30 || ny < -30 || ny > Hu + 30) return false;
        const rq = riverAt(nx, ny);
        if (rq.d < rq.hw + 1.2) return false;
        // Crossing another road: end there (a T-junction).
        near(x, y, nx, ny, 1.8, tmp);
        let bt = 2, bj = -1;
        for (const j of tmp) {
          const s = segs[j];
          const t = cross(x, y, nx, ny, s.x0, s.y0, s.x1, s.y1);
          if (t > 0 && t < bt) { bt = t; bj = j; }
        }
        const b = Math.min(1, 0.25 + 0.75 * dens) * (0.75 + 0.5 * noise.vn(x * 0.08, y * 0.08));
        if (bj >= 0) { addSeg(x, y, x + (nx - x) * bt, y + (ny - y) * bt, 0, b); segs[segs.length - 1].born = now; return false; }
        // Too close to a parallel road: join it.
        for (const j of tmp) {
          const s = segs[j];
          const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
          let t = ((nx - s.x0) * dx + (ny - s.y0) * dy) / (dx * dx + dy * dy || 1);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s.x0 + dx * t, py = s.y0 + dy * t;
          if (Math.hypot(nx - px, ny - py) < 1.5) {
            const sx = s.x0 + dx * Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / (dx * dx + dy * dy || 1)));
            const sy = s.y0 + dy * Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / (dx * dx + dy * dy || 1)));
            if (Math.hypot(x - sx, y - sy) < 0.01) continue; // the road we came from
            addSeg(x, y, px, py, 0, b); segs[segs.length - 1].born = now;
            return false;
          }
        }
        addSeg(x, y, nx, ny, 0, b);
        segs[segs.length - 1].born = now;
        tip.x = nx; tip.y = ny; tip.life++;
        // Right-angle branches, more often where it is dense.
        const pb = 0.08 + 0.32 * Math.min(1, dens);
        for (const sgn of [-1, 1]) {
          if (rng() < pb) queue.push({ x: nx, y: ny, a: tip.a + sgn * Math.PI / 2 + (rng() - 0.5) * 0.1 * (1 + o.organic), life: 0 });
        }
        return rng() < 0.9 + 0.08 * Math.min(1, dens);
      }
      function grow(budget, maxSegs, boost, now) {
        let n = 0;
        while (queue.length && n < budget && segs.length < maxSegs) {
          const tip = queue.shift();
          if (stepTip(tip, boost, now)) queue.push(tip);
          n++;
        }
      }

      for (const d of districts) seedDistrict(d, 4 + Math.round(d.w * 4));
      // Side streets off the arterials.
      for (const pts of arterials) {
        for (let i = 2; i < pts.length - 2; i += 4) {
          const a = pts[i], b = pts[i + 1];
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (density(a[0], a[1]) > 0.15) for (const sgn of [-1, 1]) if (rng() < 0.5) queue.push({ x: a[0], y: a[1], a: ang + sgn * Math.PI / 2, life: 0 });
        }
      }
      const base = Math.round(13000 * P.density * (HU / 850));
      grow(1e7, roadStart + base, null, -1);
      queue.length = 0;

      // Arterial lengths, for the traffic.
      const traffic = arterials.map((pts) => {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const cars = Array.from({ length: Math.max(2, Math.round(cum[cum.length - 1] / 60)) }, () => ({ p: rng(), v: rf(10, 26) * (rng() < 0.5 ? -1 : 1) }));
        return { pts, cum, len: cum[cum.length - 1], cars };
      });

      return { river, districts, segs, roadStart, arterials, traffic, noise, queue, grow, seedDistrict, near, density, rf, rng, riverAt, drawnTo: 0, base };
    }

    // ---------- colours ----------
    function colours() {
      const pal = ctx.palette;
      const bg = hexRgb(pal.bg), ink = hexRgb(pal.ink);
      const dark = lum(bg) < lum(ink) ? bg : ink, light = lum(bg) < lum(ink) ? ink : bg;
      const acc = ['c1', 'c2', 'c3', 'c4'].map((k) => hexRgb(pal[k]));
      let cool = acc[0], warm = acc[0], bc = -1e9, bw = -1e9;
      for (const a of acc) {
        const sat = Math.max(...a) - Math.min(...a);
        const c = a[2] - a[0] + sat * 0.2, w = a[0] - (a[1] + a[2]) / 2 + sat * 0.2 + (lum(a) > 0.3 ? 40 : -200);
        if (c > bc) { bc = c; cool = a; }
        if (w > bw) { bw = w; warm = a; }
      }
      // Deep ground: the cool accent dimmed to night, over the dark colour.
      const lc = Math.max(0.02, lum(cool));
      const deep = cool.map((v) => Math.min(255, v * (0.12 / lc)));
      const ground = mix(dark, deep, 0.8);
      const road = mix(light, cool, 0.38);
      const river = mix(ground, mix(cool, light, 0.4), 0.5);
      return { ground, light, cool, warm, road, river, dark };
    }

    // ---------- cached map ----------
    function drawSegs(c, list, from, to, lw, alpha, col, kindWanted) {
      const buckets = [[], [], []];
      for (let i = from; i < to; i++) {
        const s = list[i];
        if (s.kind !== kindWanted) continue;
        buckets[s.b < 0.45 ? 0 : s.b < 0.75 ? 1 : 2].push(s);
      }
      for (let k = 0; k < 3; k++) {
        if (!buckets[k].length) continue;
        c.strokeStyle = css(col, alpha * [0.35, 0.65, 1][k]);
        c.lineWidth = lw * [0.8, 1, 1.25][k];
        c.beginPath();
        for (const s of buckets[k]) { c.moveTo(s.x0, s.y0); c.lineTo(s.x1, s.y1); }
        c.stroke();
      }
    }
    function drawRoads(c, from, to) {
      const g = P.glow, th = P.thickness;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      if (g > 0) drawSegs(c, map.segs, from, to, 2.4 * th, 0.05 * g, cols.road, 0);
      drawSegs(c, map.segs, from, to, 0.45 * th, 0.85, cols.road, 0);
      c.restore();
    }

    function renderMap() {
      dirty = false;
      cols = colours();
      buf.width = Math.max(1, Math.round(W * DPR));
      buf.height = Math.max(1, Math.round(H * DPR));
      const c = bc;
      c.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
      c.fillStyle = css(cols.ground);
      c.fillRect(-2, -2, UW + 4, HU + 4);

      // Relief: a small hill-shaded image, smoothed by upscaling.
      if (P.relief > 0) {
        const rw = 150, rh = Math.max(8, Math.round((150 * HU) / UW));
        const rc = document.createElement('canvas');
        rc.width = rw; rc.height = rh;
        const x2 = rc.getContext('2d');
        const img = x2.createImageData(rw, rh);
        const n = map.noise;
        const e = (x, y) => n.fbm(x * 0.006 + 11, y * 0.006 + 4);
        for (let j = 0; j < rh; j++) {
          for (let i = 0; i < rw; i++) {
            const x = (i / rw) * UW, y = (j / rh) * HU;
            const h0 = e(x, y);
            const sh = (e(x + 3, y + 3) - h0) * 28;
            const city = Math.min(1, map.density(x, y) * 0.8);
            const k = (sh * 0.3 + (h0 - 0.5) * 0.45) * P.relief;
            const col = k > 0 ? mix(cols.ground, cols.cool, Math.min(0.35, k * 0.6 + city * 0.06)) : mix(cols.ground, [0, 0, 0], Math.min(0.5, -k * 0.8));
            const o = (j * rw + i) * 4;
            img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
          }
        }
        x2.putImageData(img, 0, 0);
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(rc, 0, 0, UW, HU);
      }

      // River: a lighter band, brighter along the banks and a faint current line.
      if (map.river) {
        const { pts, hw } = map.river;
        const L = [], R = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          L.push([pts[i][0] - (dy / l) * hw[i], pts[i][1] + (dx / l) * hw[i]]);
          R.push([pts[i][0] + (dy / l) * hw[i], pts[i][1] - (dx / l) * hw[i]]);
        }
        c.beginPath();
        L.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
        c.closePath();
        c.fillStyle = css(cols.river);
        c.fill();
        c.save();
        c.clip();
        c.strokeStyle = css(mix(cols.river, cols.light, 0.2), 0.5);
        c.lineWidth = 5;
        c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(q[0] + 3, q[1]) : c.moveTo(q[0] + 3, q[1])));
        c.stroke();
        c.restore();
        c.lineWidth = 0.7;
        c.strokeStyle = css(mix(cols.river, cols.light, 0.45), 0.7);
        for (const side of [L, R]) {
          c.beginPath();
          side.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
          c.stroke();
        }
      }

      // City glow under the streets.
      if (P.glow > 0) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (const d of map.districts) {
          const R = d.r * 0.9;
          const g = c.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
          g.addColorStop(0, css(mix(cols.cool, cols.light, 0.3), 0.26 * P.glow * d.w));
          g.addColorStop(1, css(cols.cool, 0));
          c.fillStyle = g;
          c.fillRect(d.x - R, d.y - R, R * 2, R * 2);
        }
        c.restore();
      }

      drawRoads(c, map.roadStart, map.segs.length);
      map.drawnTo = map.segs.length;

      // Warm arterials, with white bridges where they cross the river.
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const pts of map.arterials) {
        c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        if (P.glow > 0) { c.strokeStyle = css(cols.warm, 0.14 * P.glow); c.lineWidth = 3 * P.thickness; c.stroke(); }
        c.strokeStyle = css(cols.warm, 0.9);
        c.lineWidth = 0.85 * P.thickness;
        c.stroke();
        if (map.river) {
          c.strokeStyle = css(cols.light, 0.85);
          c.lineWidth = 1.6 * P.thickness;
          c.beginPath();
          for (let i = 0; i < pts.length - 1; i++) {
            const q = map.riverAt((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
            if (q.d < q.hw + 1) { c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[i + 1][0], pts[i + 1][1]); }
          }
          c.stroke();
        }
      }
      c.restore();
    }

    // ---------- frame ----------
    let palSig = '';
    const hov = { x: 300, y: 300, amt: 0 };
    const founded = [];
    const tmpNear = [];
    const stage = createP5Stage(ctx, {
      setup() {},
      draw(p, t, dt) {
        const c = p.drawingContext;
        const pal = ctx.palette;
        const sig = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4;
        if (sig !== palSig) { palSig = sig; dirty = true; }
        if (!map) map = generate();
        if (dirty) renderMap();

        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const ux = ptr.x * UW, uy = ptr.y * HU;
        const on = ptr.inside && mPow > 0;
        const ke = 1 - Math.pow(0.003, dt);
        if (on) { hov.x += (ux - hov.x) * Math.min(1, ke * 3); hov.y += (uy - hov.y) * Math.min(1, ke * 3); }
        hov.amt += ((on ? mPow : 0) - hov.amt) * ke;
        const reach = 55 * P.reach;

        // Click: a new district, seeded with tips that grow over the next frames.
        if (ptr.justPressed && ptr.inside && mPow > 0) {
          const d = { x: ux, y: uy, r: map.rf(45, 80), w: 1, a: map.rf(0, Math.PI / 2), organic: map.rf(0, 1), born: t };
          map.districts.push(d);
          map.seedDistrict(d, 8);
          founded.push(d);
          if (founded.length > 8) founded.shift();
        }
        // Hover: sprout side streets from roads near the cursor.
        const cap = map.roadStart + map.base + 9000;
        if (hov.amt > 0.05 && map.segs.length < cap && dt > 0) {
          map.near(hov.x - reach * 0.6, hov.y - reach * 0.6, hov.x + reach * 0.6, hov.y + reach * 0.6, 0, tmpNear);
          for (let k = 0; k < 2 && tmpNear.length; k++) {
            const s = map.segs[tmpNear[(map.rng() * tmpNear.length) | 0]];
            const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0) + (map.rng() < 0.5 ? 1 : -1) * Math.PI / 2;
            map.queue.push({ x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2, a, life: 0 });
          }
        }
        if (map.queue.length && dt > 0) {
          const hx = hov.x, hy = hov.y, ha = hov.amt;
          const boost = (x, y) => 0.6 * ha * Math.exp(-((Math.hypot(x - hx, y - hy) / reach) ** 2));
          map.grow(40, cap, boost, t);
          if (map.queue.length > 400) map.queue.splice(0, map.queue.length - 400);
        }
        // New streets go straight into the cached map.
        if (map.drawnTo < map.segs.length) {
          bc.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
          drawRoads(bc, map.drawnTo, map.segs.length);
          map.drawnTo = map.segs.length;
        }

        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(buf, 0, 0, c.canvas.width, c.canvas.height);
        c.restore();

        c.save();
        c.scale(S, S);
        c.globalCompositeOperation = 'lighter';
        c.lineCap = 'round';

        // Traffic on the arterials.
        const sp = P.speed;
        c.fillStyle = css(mix(cols.warm, cols.light, 0.5), 0.9);
        c.beginPath();
        for (const tr of map.traffic) {
          for (const car of tr.cars) {
            let d = ((car.p * tr.len + t * car.v * sp) % tr.len + tr.len) % tr.len;
            let i = 1;
            while (i < tr.cum.length - 1 && tr.cum[i] < d) i++;
            const a = tr.pts[i - 1], b = tr.pts[i];
            const f = (d - tr.cum[i - 1]) / (tr.cum[i] - tr.cum[i - 1] || 1);
            const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
            c.moveTo(x + 0.9, y);
            c.arc(x, y, 0.9 * P.thickness, 0, Math.PI * 2);
          }
        }
        c.fill();

        // Fresh streets flash as they appear.
        const segs = map.segs;
        c.strokeStyle = css(cols.light, 0.9);
        c.lineWidth = 0.9 * P.thickness;
        c.beginPath();
        for (let i = segs.length - 1; i >= map.roadStart; i--) {
          const s = segs[i];
          if (s.born < 0) break;
          const age = t - s.born;
          if (age > 0.8 || age < 0) { if (age > 3) break; continue; }
          c.moveTo(s.x0, s.y0); c.lineTo(s.x1, s.y1);
        }
        c.stroke();

        // New districts pulse for a while.
        for (const d of founded) {
          const age = t - d.born;
          if (age < 0 || age > 6) continue;
          const k = Math.min(1, age * 2) * Math.max(0, 1 - age / 6);
          const R = d.r * (0.4 + 0.5 * Math.min(1, age / 2));
          const g = c.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
          g.addColorStop(0, css(cols.light, 0.35 * k));
          g.addColorStop(1, css(cols.cool, 0));
          c.fillStyle = g;
          c.fillRect(d.x - R, d.y - R, R * 2, R * 2);
        }

        // Hover: a soft pool of light and every street inside it lit up.
        if (hov.amt > 0.01) {
          const R = reach * 1.3;
          const g = c.createRadialGradient(hov.x, hov.y, 0, hov.x, hov.y, R);
          g.addColorStop(0, css(mix(cols.cool, cols.light, 0.3), 0.32 * hov.amt * Math.max(0.3, P.glow)));
          g.addColorStop(1, css(cols.cool, 0));
          c.fillStyle = g;
          c.fillRect(hov.x - R, hov.y - R, R * 2, R * 2);
          map.near(hov.x - reach, hov.y - reach, hov.x + reach, hov.y + reach, 0, tmpNear);
          const rings = [[], [], []];
          for (const i of tmpNear) {
            const s = segs[i];
            if (s.kind !== 0) continue;
            const d = Math.hypot((s.x0 + s.x1) / 2 - hov.x, (s.y0 + s.y1) / 2 - hov.y) / reach;
            if (d < 1) rings[d < 0.4 ? 2 : d < 0.7 ? 1 : 0].push(s);
          }
          for (let k = 0; k < 3; k++) {
            c.strokeStyle = css(cols.light, hov.amt * [0.18, 0.38, 0.6][k]);
            c.lineWidth = 0.6 * P.thickness;
            c.beginPath();
            for (const s of rings[k]) { c.moveTo(s.x0, s.y0); c.lineTo(s.x1, s.y1); }
            c.stroke();
          }
        }
        c.restore();
        drawGrain(c, W, H, ctx.state.grain * 0.6);
      },
    });

    return {
      resize(w, h, dpr) {
        const hu = (UW * h) / w;
        const regen = Math.abs(hu - HU) > 0.5 || !map;
        W = w; H = h; DPR = dpr; S = w / UW; HU = hu;
        stage.resize(w, h, dpr);
        if (regen) { map = generate(); founded.length = 0; }
        dirty = true;
      },
      frame: stage.frame,
      onParam(key) { if (['palette', 'glow', 'thickness', 'relief'].includes(key)) dirty = true; },
      dispose() { stage.dispose(); buf.width = buf.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'nightmap', name: 'Night Map', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (no relief, traffic or grain).
const SKETCH = String.raw`
// Night Map
// A city at night seen from above. Streets grow from district centres: each growing tip
// steps forward, branches at right angles, and stops as soon as it meets another street,
// which closes the blocks. A river winds through; warm arterials cross the map.
// Click to found a new district.

let segs = [], tips = [], districts = [], river = [];
const ground = '#0f1e3a';

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  // River: a meander from top to bottom.
  const x0 = random(0.3, 0.7) * width, A = random(0.1, 0.2) * width, f = random(0.004, 0.008), ph = random(TWO_PI);
  for (let y = -40; y <= height + 40; y += 8) river.push(createVector(x0 + A * sin(y * f + ph), y));
  for (let i = 0; i < params.districts; i++) addDistrict(random(width), random(height));
}

function addDistrict(x, y) {
  const d = { x, y, r: random(60, 140), a: random(HALF_PI) };
  districts.push(d);
  for (let k = 0; k < 8; k++) tips.push({ x, y, a: d.a + (k % 4) * HALF_PI });
}
function mousePressed() { addDistrict(mouseX, mouseY); }

// How lit the city is here (0..1): high near district centres.
function density(x, y) {
  let v = 0;
  for (const d of districts) v = max(v, exp(-sq(dist(x, y, d.x, d.y) / d.r)));
  return v + (noise(x * 0.01, y * 0.01) - 0.45) * 0.25;
}
function riverDist(x, y) {
  let best = 1e9;
  for (const p of river) best = min(best, dist(x, y, p.x, p.y));
  return best;
}

// Grow one tip by one step. Returns false when the tip should stop.
function step(tip) {
  const dn = density(tip.x, tip.y);
  if (dn < 0.05 + random(0.08)) return false;
  const L = 4 + 9 * max(0, 1 - dn);
  tip.a += random(-0.08, 0.08);
  const nx = tip.x + cos(tip.a) * L, ny = tip.y + sin(tip.a) * L;
  if (riverDist(nx, ny) < 22 * params.river) return false;
  // Does the new street cross an existing one? Then stop there.
  let hit = 2;
  for (const s of segs) {
    const t = crossAt(tip.x, tip.y, nx, ny, s);
    if (t > 0 && t < hit) hit = t;
  }
  const ex = lerp(tip.x, nx, min(1, hit)), ey = lerp(tip.y, ny, min(1, hit));
  segs.push({ x0: tip.x, y0: tip.y, x1: ex, y1: ey, b: min(1, 0.3 + dn) });
  if (hit <= 1) return false;
  tip.x = nx; tip.y = ny;
  for (const s of [-1, 1]) if (random() < 0.1 + 0.3 * dn) tips.push({ x: nx, y: ny, a: tip.a + s * HALF_PI });
  return random() < 0.93;
}
function crossAt(ax, ay, bx, by, s) {
  const rx = bx - ax, ry = by - ay, sx = s.x1 - s.x0, sy = s.y1 - s.y0;
  const den = rx * sy - ry * sx;
  if (abs(den) < 1e-9) return -1;
  const qx = s.x0 - ax, qy = s.y0 - ay;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t > 1e-4 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

function draw() {
  // Grow a few hundred steps per frame until the budget is spent.
  for (let n = 0; n < 60 && tips.length && segs.length < 4000 * params.density; n++) {
    const tip = tips.shift();
    if (step(tip)) tips.push(tip);
  }
  background(ground);
  // River band.
  noFill(); stroke(lerpColor(color(ground), color(colors.c3), 0.6));
  strokeWeight(32 * params.river);
  beginShape(); for (const p of river) vertex(p.x, p.y); endShape();
  // Streets, additive so dense areas glow.
  blendMode(ADD);
  const road = lerpColor(color(colors.bg), color(colors.c3), 0.35);
  for (const s of segs) {
    road.setAlpha(255 * s.b * 0.8);
    stroke(road); strokeWeight(0.8 * params.thickness);
    line(s.x0, s.y0, s.x1, s.y1);
  }
  blendMode(BLEND);
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
