// Zigzag Maze: a dense maze of stepped lines in three isometric directions (refs 46, 41, 42).
// The poster is tiled with triangles; each holds a few parallel strokes along one of its
// sides. Strokes always meet their neighbours' strokes on shared edges, so where up- and
// down-triangles pick different sides the lines zigzag, where they agree the lines run
// straight, and where a neighbour runs parallel the line ends: a maze. Strokes are joined
// into long chains, each with one palette colour, and cached; tiles only change on interaction.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

const UW = 600;
const R3 = Math.sqrt(3) / 2;

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
  return { vn, h };
}
const hash1 = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// For an up / down triangle, which vertex is opposite the side of each direction class
// (0 = along the rows, 1 and 2 = the two diagonals).
const OPP = [[2, 1, 0], [2, 0, 1]];

export default {
  id: 'zigzag',
  name: 'Zigzag Maze',
  engine: 'p5',
  hint: 'Hover to flip the tiles under the cursor · click to reshuffle a whole region',
  darkGround: () => true, // the poster text switches to the light colour
  params: {
    size:      { value: 17, min: 8, max: 40, step: 0.5, label: 'Tile size', rebuild: true },
    lines:     { value: 3, min: 1, max: 6, step: 1, label: 'Line count', rebuild: true },
    thickness: { value: 1, min: 0.3, max: 2, step: 0.01, label: 'Line thickness' },
    chaos:     { value: 0.12, min: 0, max: 1, step: 0.01, label: 'Chaos amount', rebuild: true },
    region:    { value: 1, min: 0.3, max: 3, step: 0.01, label: 'Region scale', rebuild: true },
    angle:     { value: 'Vertical', options: ['Vertical', 'Horizontal'], label: 'Direction', rebuild: true },
    speed:     { value: 0.3, min: 0, max: 3, step: 0.01, label: 'Speed' },
    reach:     { value: 1, min: 0.3, max: 2.5, step: 0.01, label: 'Hover size' },
    colours:   { value: 6, min: 2, max: 6, step: 1, label: 'Colour count' },
  },
  controls: {
    essentials: ['size', 'lines', 'thickness', 'chaos'],
    form: ['region', 'angle'],
    motion: ['speed'],
    interaction: ['reach'],
    colour: ['colours'],
    type: [],
  },
  presets: {
    'Fine weave': { size: 11, lines: 3, thickness: 0.9, chaos: 0.1 },
    'Bold blocks': { size: 30, lines: 5, region: 2.2, chaos: 0.05, thickness: 1.2 },
    'Static': { chaos: 0.75, size: 14, lines: 2, speed: 1.5 },
  },
  interactions: { hover: 'flips the tiles near the cursor to new directions', click: 'reshuffles a whole region in a ring spreading from the click' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 2 ** 30);
    const rng = makeRng(seed);
    const noise = makeNoise(Math.floor(rng() * 1e6));
    let W = 100, H = 100, DPR = 1, S = 1, HU = 850;
    const vertical = P.angle === 'Vertical';
    const s = P.size, k = P.lines, h = s * R3;

    // ---------- tiles ----------
    // Grid space (a, b): rows of alternating triangles along a. With 'Vertical' the grid is
    // turned 90°, so a runs down the poster and the row lines are vertical.
    let tris = null, cls = null;
    function build() {
      const A = vertical ? HU : UW, B = vertical ? UW : HU;
      const nRows = Math.ceil(B / h) + 2, nCols = Math.ceil(A / (s / 2)) + 4;
      tris = [];
      const fr = 0.0045 / P.region;
      for (let j = -1; j < nRows - 1; j++) {
        for (let i = -2; i < nCols - 2; i++) {
          const up = ((i + j) & 1) === 0;
          const ca = i * (s / 2), ta = j * h, ba = (j + 1) * h;
          const v = up ? [[ca - s / 2, ba], [ca + s / 2, ba], [ca, ta]] : [[ca - s / 2, ta], [ca + s / 2, ta], [ca, ba]];
          const pts = v.map(([a, b]) => (vertical ? [b, a] : [a, b]));
          const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
          tris.push({ up: up ? 0 : 1, pts, cx, cy });
        }
      }
      cls = new Uint8Array(tris.length);
      // Regions: each picks a side for up- and for down-triangles (same = straight, different = zigzag).
      tris.forEach((t, n) => { cls[n] = regionClass(t, fr, 0); if (rng() < P.chaos) cls[n] = Math.floor(rng() * 3); });
    }
    function regionClass(t, fr, shift) {
      const n1 = noise.vn(t.cx * fr + 10 + shift, t.cy * fr);
      const n2 = noise.vn(t.cx * fr + 50, t.cy * fr + 30 + shift);
      const c = t.up === 0 ? n1 : n2;
      return Math.floor(((c * 2.7) % 1) * 3) % 3;
    }

    // ---------- strokes and chains ----------
    let chains = [];
    const keyOf = (x, y) => Math.round((x + 200) * 8) * 65536 + Math.round((y + 200) * 8);
    function chainUp() {
      const n = tris.length * k;
      const sx0 = new Float32Array(n), sy0 = new Float32Array(n), sx1 = new Float32Array(n), sy1 = new Float32Array(n);
      const ends = new Map();
      const link = (key, si) => { const a = ends.get(key); if (a) a.push(si); else ends.set(key, [si]); };
      for (let t = 0; t < tris.length; t++) {
        const tr = tris[t];
        const d = OPP[tr.up][cls[t]];
        const V = tr.pts[d], O1 = tr.pts[(d + 1) % 3], O2 = tr.pts[(d + 2) % 3];
        for (let m = 0; m < k; m++) {
          const f = (m + 0.5) / k;
          const si = t * k + m;
          sx0[si] = O1[0] + (V[0] - O1[0]) * f; sy0[si] = O1[1] + (V[1] - O1[1]) * f;
          sx1[si] = O2[0] + (V[0] - O2[0]) * f; sy1[si] = O2[1] + (V[1] - O2[1]) * f;
          link(keyOf(sx0[si], sy0[si]), si);
          link(keyOf(sx1[si], sy1[si]), si);
        }
      }
      const seen = new Uint8Array(n);
      const other = (key, si) => { const a = ends.get(key); return a.length > 1 ? (a[0] === si ? a[1] : a[0]) : -1; };
      const walk = (start, fromEnd) => {
        // fromEnd: which endpoint of `start` is the free one.
        const pts = [];
        let si = start, enter = fromEnd, minId = start;
        pts.push(enter ? [sx1[si], sy1[si]] : [sx0[si], sy0[si]]);
        for (;;) {
          seen[si] = 1;
          if (si < minId) minId = si;
          const ex = enter ? sx0[si] : sx1[si], ey = enter ? sy0[si] : sy1[si];
          pts.push([ex, ey]);
          const key = keyOf(ex, ey);
          const nx = other(key, si);
          if (nx < 0 || seen[nx]) break;
          enter = keyOf(sx1[nx], sy1[nx]) === key;
          si = nx;
        }
        return { pts, id: minId };
      };
      chains = [];
      for (let si = 0; si < n; si++) {
        if (seen[si]) continue;
        const free0 = ends.get(keyOf(sx0[si], sy0[si])).length < 2;
        const free1 = ends.get(keyOf(sx1[si], sy1[si])).length < 2;
        if (free0) chains.push(walk(si, false));
        else if (free1) chains.push(walk(si, true));
      }
      for (let si = 0; si < n; si++) if (!seen[si]) chains.push(walk(si, false)); // loops
    }

    // ---------- colours ----------
    let cols = null;
    function colours() {
      const pal = ctx.palette;
      const bg = hexRgb(pal.bg), ink = hexRgb(pal.ink);
      const ground = lum(bg) < lum(ink) ? bg : ink, light = lum(bg) < lum(ink) ? ink : bg;
      const gl = lum(ground);
      const lift = (c) => { let o = c; for (let i = 0; i < 8 && Math.abs(lum(o) - gl) < 0.22; i++) o = mix(o, light, 0.15); return o; };
      const list = [light, ...['c1', 'c2', 'c3', 'c4'].map((key) => lift(hexRgb(pal[key]))), mix(ground, light, 0.42)];
      return { ground, list: list.slice(0, Math.max(2, P.colours)) };
    }

    // ---------- cache ----------
    const buf = document.createElement('canvas');
    const bc = buf.getContext('2d');
    let tilesDirty = true, paintDirty = true;
    function render() {
      paintDirty = false;
      if (buf.width !== Math.round(W * DPR) || buf.height !== Math.round(H * DPR)) {
        buf.width = Math.max(1, Math.round(W * DPR));
        buf.height = Math.max(1, Math.round(H * DPR));
      }
      const c = bc;
      c.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
      c.fillStyle = css(cols.ground);
      c.fillRect(-2, -2, UW + 4, HU + 4);
      const nC = cols.list.length;
      const fr = 0.006 / P.region;
      c.lineWidth = (h / k) * 0.38 * P.thickness;
      c.lineJoin = 'miter';
      c.miterLimit = 3;
      c.lineCap = 'butt';
      const paths = cols.list.map(() => new Path2D());
      for (const ch of chains) {
        const p0 = ch.pts[0];
        const zone = noise.vn(p0[0] * fr + 90, p0[1] * fr + 90);
        const ci = Math.floor((hash1(ch.id + 1) * 0.3 + zone * 1.7) * nC) % nC;
        const path = paths[ci];
        path.moveTo(p0[0], p0[1]);
        for (let i = 1; i < ch.pts.length; i++) path.lineTo(ch.pts[i][0], ch.pts[i][1]);
      }
      paths.forEach((path, i) => { c.strokeStyle = css(cols.list[i]); c.stroke(path); });
    }

    // ---------- frame ----------
    let palSig = '';
    let flipT = 0, ambT = 0;
    const rings = [];
    const flipNear = (x, y, r, count) => {
      let changed = false;
      for (let n = 0; n < count * 6 && count > 0; n++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r;
        const t = findTri(x + Math.cos(a) * d, y + Math.sin(a) * d);
        if (t < 0) continue;
        cls[t] = (cls[t] + 1 + (rng() < 0.5 ? 1 : 0)) % 3;
        changed = true;
        count--;
      }
      return changed;
    };
    // Nearest triangle centre, via the grid's own indexing (approximate, then refine).
    function findTri(x, y) {
      let best = -1, bd = Infinity;
      const A = vertical ? y : x, B = vertical ? x : y;
      const j = Math.floor(B / h), i = Math.round(A / (s / 2));
      const nCols = Math.ceil((vertical ? HU : UW) / (s / 2)) + 4;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const n = (j + dj + 1) * nCols + (i + di + 2);
        if (n < 0 || n >= tris.length) continue;
        const t = tris[n];
        const dd = (t.cx - x) ** 2 + (t.cy - y) ** 2;
        if (dd < bd) { bd = dd; best = n; }
      }
      return best;
    }

    const stage = createP5Stage(ctx, {
      setup() {},
      draw(p, t, dt) {
        const c = p.drawingContext;
        const pal = ctx.palette;
        const sig = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.colours + P.thickness;
        if (sig !== palSig) { palSig = sig; paintDirty = true; }
        if (!tris) { build(); tilesDirty = true; }

        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const ux = ptr.x * UW, uy = ptr.y * HU;
        // Hover: a few tiles near the cursor flip every few hundredths of a second.
        if (ptr.inside && mPow > 0 && dt > 0) {
          flipT -= dt;
          if (flipT <= 0) {
            flipT = 0.06;
            if (flipNear(ux, uy, s * 2.2 * P.reach, Math.max(1, Math.round(2 * mPow)))) tilesDirty = true;
          }
        }
        if (ptr.justPressed && ptr.inside && mPow > 0) rings.push({ x: ux, y: uy, r: 0, max: s * 9 * P.reach * Math.min(1.5, mPow), shift: rng() * 100 });
        // Click rings: as the ring passes, tiles take a fresh region pattern (or a random side).
        for (let i = rings.length - 1; i >= 0; i--) {
          const rg = rings[i];
          const r0 = rg.r;
          rg.r += dt * s * 14;
          const fr = 0.0045 / P.region * 2.5;
          for (let n = 0; n < tris.length; n++) {
            const tr = tris[n];
            const d = Math.hypot(tr.cx - rg.x, tr.cy - rg.y);
            if (d >= r0 && d < rg.r && d < rg.max) {
              cls[n] = rng() < 0.15 + P.chaos * 0.5 ? Math.floor(rng() * 3) : regionClass(tr, fr, rg.shift);
              tilesDirty = true;
            }
          }
          if (rg.r > rg.max) rings.splice(i, 1);
        }
        // Idle: now and then a tile flips somewhere along a slow wandering path.
        if (P.speed > 0 && dt > 0) {
          ambT -= dt * P.speed;
          if (ambT <= 0) {
            ambT = 0.5;
            const wx = (0.5 + 0.45 * Math.sin(t * 0.13 + 1)) * UW, wy = (0.5 + 0.45 * Math.sin(t * 0.09 + 4)) * HU;
            if (flipNear(wx, wy, s * 3, 2)) tilesDirty = true;
          }
        }

        if (tilesDirty) { tilesDirty = false; chainUp(); paintDirty = true; }
        if (paintDirty) { cols = colours(); render(); }

        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(buf, 0, 0, c.canvas.width, c.canvas.height);
        c.restore();
        drawGrain(c, W, H, ctx.state.grain * 0.7);
      },
    });

    return {
      resize(w, hh, dpr) {
        const hu = (UW * hh) / w;
        if (Math.abs(hu - HU) > 0.5) tris = null;
        W = w; H = hh; DPR = dpr; S = w / UW; HU = hu;
        stage.resize(w, hh, dpr);
        paintDirty = true;
      },
      frame: stage.frame,
      onParam(key) { if (key === 'palette') paintDirty = true; },
      dispose() { stage.dispose(); buf.width = buf.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'zigzag', name: 'Zigzag Maze', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (strokes are drawn per tile, not joined into chains).
const SKETCH = String.raw`
// Zigzag Maze
// The canvas is tiled with triangles. Each triangle holds a few strokes parallel to one of
// its three sides. Strokes always land on the same points of a shared edge, so they connect
// across tiles: where up- and down-triangles choose different sides the lines zigzag, where
// they agree the lines run straight, and where a neighbour runs parallel a line ends.
// Move the mouse to flip tiles; click to reshuffle everything.

let tiles = [];
const s = params.size * 1.6, h = s * Math.sqrt(3) / 2;

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  for (let j = -1; j < width / h + 1; j++) {
    for (let i = -2; i < height / (s / 2) + 2; i++) {
      const up = (i + j) % 2 === 0, a = i * s / 2, t = j * h, b = (j + 1) * h;
      // Vertices in grid space, then turned 90° so the row lines run vertically.
      const v = up ? [[a - s / 2, b], [a + s / 2, b], [a, t]] : [[a - s / 2, t], [a + s / 2, t], [a, b]];
      const pts = v.map(([p, q]) => createVector(q, p));
      tiles.push({ up, pts, side: pick(pts, up) });
    }
  }
  strokeCap(SQUARE);
}

// Regions from noise: up- and down-triangles each pick a side.
function pick(pts, up) {
  const c = p5.Vector.add(pts[0], pts[1]).add(pts[2]).div(3);
  return floor(noise(c.x * 0.006 + (up ? 0 : 50), c.y * 0.006) * 2.7 * 3) % 3;
}

function mousePressed() { for (const t of tiles) t.side = floor(random(3)); }

function draw() {
  background(colors.ink);
  const pal = [colors.bg, colors.c1, colors.c2, colors.c3, colors.c4];
  strokeWeight(h / params.lines * 0.38 * params.thickness);
  tiles.forEach((t, n) => {
    const c = p5.Vector.add(t.pts[0], t.pts[1]).add(t.pts[2]).div(3);
    if (dist(c.x, c.y, mouseX, mouseY) < s * 2 && random() < 0.05) t.side = (t.side + 1) % 3;
    const V = t.pts[t.side], A = t.pts[(t.side + 1) % 3], B = t.pts[(t.side + 2) % 3];
    stroke(pal[floor(noise(c.x * 0.01 + 9, c.y * 0.01) * 2.5 * pal.length) % pal.length]);
    for (let m = 0; m < params.lines; m++) {
      const f = (m + 0.5) / params.lines; // the same fractions on every edge, so strokes meet
      const p = p5.Vector.lerp(A, V, f), q = p5.Vector.lerp(B, V, f);
      line(p.x, p.y, q.x, q.y);
    }
  });
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
