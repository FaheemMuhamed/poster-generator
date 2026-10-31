// Watercolour Trail: a thick, wet watercolour stroke on textured paper whose colour shifts along
// its path, with darker pooled edges, granulated pigment and overlaps that mix. When idle it paints
// a looping path by itself; hold the pointer down to paint your own (ref "Screenshot 10.01.07").
//
// The paint lives in two offscreen buffers at a fixed internal resolution (so exports and resizes
// never lose it): "wet" holds the section being painted (opaque colour), "pigment" holds dried
// paint. Each section dries by multiplying onto the pigment, which is what makes overlaps mix.
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
// Smooth 1D value noise in -1..1.
function noise1(x, s = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash(i, s) * (1 - u) + hash(i + 1, s) * u) * 2 - 1;
}
// Smooth 2D value noise in 0..1, tileable with period p.
function noise2(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (i, j) => hash(((xi + i) % p + p) % p, ((yi + j) % p + p) % p, s);
  return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

const BW = 1400;          // internal paint resolution (width); height follows the poster's aspect
const K = BW / 1000;      // scale for sizes given in pixels at 1000 wide
const STEP = 2.5 * K;     // brush step in buffer pixels
const DRY_STEPS = 40;     // steps per wet section before it dries onto the pigment
const PAINT_TIME = 14;    // seconds an idle loop takes to paint (at Speed 1)
const HOLD_TIME = 4, FADE_TIME = 1.6;

// Paper relief (an embossed fibre noise) and pigment mottle, both as small tiles.
function makePaperTile() {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const f = (x, y) => noise2(x / 4, y / 4, N / 4, 1) * 0.45 + noise2(x / 2, y / 2, N / 2, 2) * 0.25 + noise2(x / 16, y / 16, N / 16, 3) * 0.3;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Light from the top left: brightness from the slope of the height field.
      const e = (f(x + 1, y + 1) - f(x - 1, y - 1)) * 2.2;
      const v = Math.max(0, Math.min(255, 236 + e * 255 * 0.35 - (hash(x, y, 7) < 0.004 ? 30 : 0)));
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function makeMottleTile() {
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = noise2(x / 9, y / 9, N / 9, 11) * 0.55 + noise2(x / 3.2, y / 3.2, N / 3.2, 12) * 0.3 + hash(x, y, 13) * 0.15;
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
      img.data[o + 3] = Math.max(0, Math.min(255, (v - 0.35) * 2.2 * 255));
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

export default {
  id: 'watercolour',
  name: 'Watercolour Trail',
  engine: 'p5',
  hint: 'Paints by itself · hold and drag to paint your own stroke',
  params: {
    size:      { value: 1, min: 0.4, max: 2.5, step: 0.01, label: 'Brush size', unit: '×' },
    spacing:   { value: 1, min: 0.3, max: 3, step: 0.01, label: 'Colour spacing', unit: '×' },
    amount:    { value: 0.78, min: 0.3, max: 1, step: 0.01, label: 'Paint amount' },
    edges:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Edge contrast' },
    texture:   { value: 1, min: 0, max: 2, step: 0.01, label: 'Texture amount' },
    detail:    { value: 1, min: 0.5, max: 2, step: 0.01, label: 'Path detail', rebuild: true },
    speed:     { value: 1, min: 0.2, max: 4, step: 0.01, label: 'Speed' },
    autoPaint: { value: true, label: 'Auto paint' },
  },
  controls: {
    essentials: ['size', 'spacing', 'amount', 'edges'],
    form: ['texture', 'detail'],
    motion: ['speed', 'autoPaint'],
    interaction: [],
    colour: [],
  },
  presets: {
    'Soft wash': { amount: 0.5, edges: 0.5, size: 1.5 },
    'Ink pen': { size: 0.5, edges: 1.7, amount: 0.95, spacing: 0.7 },
    'Rainbow': { spacing: 0.4, size: 1.15, texture: 1.4 },
  },
  interactions: { hover: 'no effect: the brush only paints while pressed', click: 'hold and drag to paint your own stroke; the idle loop fades back in after a pause' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 1e6);

    const paperTile = makePaperTile();
    const mottleTile = makeMottleTile();
    const pigment = document.createElement('canvas');
    const wet = document.createElement('canvas');
    const pc = pigment.getContext('2d');
    const wc = wet.getContext('2d');
    let BH = 0, aspect = 0, mottle = null;

    // ---- Brush ----
    const brush = { on: false, x: 0, y: 0, dx: 1, dy: 0, dist: 0, steps: 0, L: [], R: [], lastCol: null, stroke: 0 };
    let colours = [], palKey = '';
    function buildColours() {
      const pal = ctx.palette;
      const key = pal.bg + pal.c1 + pal.c2 + pal.c3 + pal.c4;
      if (key === palKey) return false;
      palKey = key;
      const bg = rgb(pal.bg);
      // Accents too close to the paper are dropped (or, if that leaves too few, pushed toward ink).
      const acc = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb);
      const ok = acc.filter((c) => Math.abs(lum(c) - lum(bg)) >= 0.12 || Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) > 90);
      const base = ok.length >= 2 ? ok : acc.map((c) => mix(c, rgb(pal.ink), 0.35));
      colours = Array.from({ length: 4 }, (_, i) => base[i % base.length]);
      return true;
    }
    // Colour along the stroke: the four accents in a loop, blended.
    const colourAt = (d) => {
      const u = d / (BH * 0.9 * P.spacing);
      const i = Math.floor(u), f = u - i;
      const s = f * f * (3 - 2 * f);
      return mix(colours[((i % 4) + 4) % 4], colours[(((i + 1) % 4) + 4) % 4], s);
    };

    function startStroke(x, y) {
      brush.on = true; brush.x = x; brush.y = y; brush.steps = 0; brush.L = []; brush.R = []; brush.stroke++;
      brush.dx = 1; brush.dy = 0;
      // A round pooled start, a little wider than the stroke.
      blob(x, y, width(0) * 1.12, colourAt(brush.dist), true);
    }
    function endStroke() {
      if (!brush.on) return;
      if (brush.steps > 2) blob(brush.x, brush.y, width(brush.dist) * 1.08, brush.lastCol || colourAt(brush.dist), false);
      brush.on = false;
      dry();
    }
    const width = (d0) => { const d = d0 / K; return BW * 0.045 * P.size * (0.82 + 0.3 * noise1(d * 0.004, seed) + 0.08 * noise1(d * 0.02, seed + 1)); };

    // Ragged disc for the stroke ends. `full` = draw the whole outline (the start), otherwise only
    // the arc facing forward (the end), so no edge line crosses the body.
    function blob(x, y, r, col, full) {
      const pts = [];
      const N = 40, s = brush.stroke * 17 + seed;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const k = 1 + noise1(a * 2.2, s) * 0.12 + noise1(a * 7, s + 1) * 0.05;
        pts.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]);
      }
      wc.globalCompositeOperation = 'source-over';
      wc.fillStyle = css(col);
      wc.beginPath(); pts.forEach(([px, py], i) => (i ? wc.lineTo(px, py) : wc.moveTo(px, py))); wc.closePath(); wc.fill();
      grain(() => { wc.beginPath(); pts.forEach(([px, py], i) => (i ? wc.lineTo(px, py) : wc.moveTo(px, py))); wc.closePath(); });
      const fwd = Math.atan2(brush.dy, brush.dx);
      edge(col, () => {
        wc.beginPath();
        let pen = false;
        pts.forEach(([px, py], i) => {
          const a = (i / N) * Math.PI * 2;
          let d = Math.abs(a - fwd) % (Math.PI * 2); d = Math.min(d, Math.PI * 2 - d);
          const keep = full || d < 1.75;
          if (keep && pen) wc.lineTo(px, py); else if (keep) { wc.moveTo(px, py); pen = true; } else pen = false;
        });
        if (full) wc.closePath();
      });
    }
    // Pigment granulation: darken the wet colour with the mottle tile, only where paint already is.
    function grain(path) {
      if (P.texture <= 0) return;
      wc.globalCompositeOperation = 'source-atop';
      wc.globalAlpha = Math.min(1, 0.26 * P.texture);
      wc.fillStyle = mottle;
      path(); wc.fill();
      wc.globalAlpha = 1;
      wc.globalCompositeOperation = 'source-over';
    }
    // Darker pooled edge: a soft wide line plus a crisp thin one, in a deeper shade of the colour.
    function edge(col, path) {
      if (P.edges <= 0) return;
      const dark = mix(col, [20, 20, 30], 0.38);
      wc.globalCompositeOperation = 'source-over';
      wc.lineJoin = 'round';
      wc.lineCap = 'round';
      path();
      wc.strokeStyle = css(dark, Math.min(1, 0.26 * P.edges)); wc.lineWidth = 5 * K; wc.stroke();
      wc.strokeStyle = css(dark, Math.min(1, 0.55 * P.edges)); wc.lineWidth = 1.6 * K; wc.stroke();
    }

    // One brush step forward to (x, y).
    function stepTo(x, y) {
      const ddx = x - brush.x, ddy = y - brush.y, l = Math.hypot(ddx, ddy);
      if (l < 1e-6) return;
      // Smoothed heading, so the ribbon edges don't kink.
      brush.dx = brush.dx * 0.55 + (ddx / l) * 0.45; brush.dy = brush.dy * 0.55 + (ddy / l) * 0.45;
      const hl = Math.hypot(brush.dx, brush.dy) || 1;
      const nx = -brush.dy / hl, ny = brush.dx / hl;
      brush.x = x; brush.y = y; brush.dist += l; brush.steps++;
      const d = brush.dist;
      const dk = d / K; // noise runs in 1000-wide units, so the look doesn't depend on BW
      const w = width(d) * Math.min(1, 0.75 + brush.steps * 0.02);
      // Each side gets its own ragged offset (two octaves of noise).
      const wl = w * (1 + noise1(dk * 0.03, seed + 5) * 0.12 + noise1(dk * 0.12, seed + 6) * 0.07 + noise1(dk * 0.45, seed + 9) * 0.035);
      const wr = w * (1 + noise1(dk * 0.03, seed + 7) * 0.12 + noise1(dk * 0.12, seed + 8) * 0.07 + noise1(dk * 0.45, seed + 10) * 0.035);
      const L = [x + nx * wl, y + ny * wl], R = [x - nx * wr, y - ny * wr];
      brush.L.push(L); brush.R.push(R);
      if (brush.L.length > 3) { brush.L.shift(); brush.R.shift(); }
      const col = colourAt(d);
      brush.lastCol = col;
      // Body: a quad that reaches back two steps, so neighbouring quads overlap (no seams).
      const Ls = brush.L, Rs = brush.R;
      const body = () => {
        wc.beginPath();
        wc.moveTo(Ls[0][0], Ls[0][1]);
        for (let i = 1; i < Ls.length; i++) wc.lineTo(Ls[i][0], Ls[i][1]);
        for (let i = Rs.length - 1; i >= 0; i--) wc.lineTo(Rs[i][0], Rs[i][1]);
        wc.closePath();
      };
      wc.globalCompositeOperation = 'source-over';
      wc.fillStyle = css(col);
      body(); wc.fill();
      // A disc at the brush head keeps the leading end round while painting.
      const hr = Math.min(wl, wr) * 0.96;
      const head = () => { wc.beginPath(); wc.arc(x, y, hr, 0, Math.PI * 2); };
      head(); wc.fill();
      grain(body);
      edge(col, () => {
        wc.beginPath();
        wc.moveTo(Ls[0][0], Ls[0][1]); for (let i = 1; i < Ls.length; i++) wc.lineTo(Ls[i][0], Ls[i][1]);
        wc.moveTo(Rs[0][0], Rs[0][1]); for (let i = 1; i < Rs.length; i++) wc.lineTo(Rs[i][0], Rs[i][1]);
      });
      // Now and then a soft bleed just outside an edge, like water creeping into the paper.
      if (hash(brush.stroke, brush.steps, seed) < 0.018) {
        const side = hash(brush.steps, brush.stroke, seed + 1) < 0.5 ? 1 : -1;
        const bx = x + nx * side * w * 0.95, by = y + ny * side * w * 0.95, br = w * (0.35 + hash(brush.steps, 3, seed) * 0.5);
        const g = wc.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, css(col, 0.55)); g.addColorStop(1, css(col, 0));
        wc.globalCompositeOperation = 'destination-over';
        wc.fillStyle = g; wc.fillRect(bx - br, by - br, br * 2, br * 2);
        wc.globalCompositeOperation = 'source-over';
      }
      if (brush.steps % DRY_STEPS === 0) dry(x, y, w * 1.4 + STEP * 4);
    }
    // Walks the brush toward (x, y) in fixed steps.
    function walkTo(x, y, maxSteps = 600) {
      let n = 0;
      while (n++ < maxSteps) {
        const dx = x - brush.x, dy = y - brush.y, l = Math.hypot(dx, dy);
        if (l < STEP) break;
        stepTo(brush.x + (dx / l) * STEP, brush.y + (dy / l) * STEP);
      }
    }
    // The wet section soaks into the pigment layer (multiply = overlapping colours mix).
    // While painting, a disc around the brush head stays wet: the next quads reach back into it,
    // and if it had dried already they would multiply twice there and leave a dark seam.
    function dry(hx, hy, hr) {
      const hole = (g) => {
        if (hr === undefined) return;
        g.beginPath(); g.rect(0, 0, BW, BH); g.arc(hx, hy, hr, 0, Math.PI * 2, true); g.clip('evenodd');
      };
      pc.save(); hole(pc);
      pc.globalCompositeOperation = 'multiply';
      pc.globalAlpha = P.amount;
      pc.drawImage(wet, 0, 0);
      pc.restore();
      wc.save(); hole(wc);
      wc.clearRect(0, 0, BW, BH);
      wc.restore();
    }

    // ---- The idle loop: a seeded wandering path (two sine pairs per axis), painted over time ----
    let cycle = 0, autoT = 0, autoU = 0, userMode = false, idle = 0, fadeOut = 0;
    let path = null;
    function makePath(k) {
      const r = (i) => hash(k, i, seed);
      const D = P.detail;
      const fx = [1, 1.5, 2][Math.floor(r(1) * 3)] * D, fy = [1, 1.5, 2, 2.5][Math.floor(r(2) * 4)] * D;
      const ph = [r(3), r(4), r(5), r(6)].map((v) => v * Math.PI * 2);
      const fx2 = 2.5 + r(7) * 3, fy2 = 3 + r(8) * 3;
      // Strokes: one long, one shorter, with a lift between.
      const cut = 0.68 + r(9) * 0.14;
      return {
        at(u) {
          const a = u * Math.PI * 2;
          const x = 0.5 + 0.27 * Math.sin(a * fx + ph[0]) + 0.07 * Math.sin(a * fx2 + ph[1]);
          const y = 0.5 + 0.33 * Math.sin(a * fy + ph[2]) + 0.06 * Math.sin(a * fy2 + ph[3]);
          return [Math.min(0.88, Math.max(0.12, x)) * BW, Math.min(0.9, Math.max(0.1, y)) * BH];
        },
        segs: [[0, cut], [cut + 0.04, 1]],
      };
    }
    // Paints the auto path from autoU up to u.
    function paintAuto(u) {
      for (const [a, b] of path.segs) {
        if (u <= a || autoU >= b) continue;
        const from = Math.max(a, autoU), to = Math.min(b, u);
        if (from === a || !brush.on) { endStroke(); const [x, y] = path.at(from); startStroke(x, y); }
        const n = Math.max(1, Math.ceil((to - from) * 900));
        for (let i = 1; i <= n; i++) { const [x, y] = path.at(from + ((to - from) * i) / n); walkTo(x, y); }
        if (to >= b) endStroke();
      }
      autoU = u;
    }
    function resetBuffers() {
      pc.clearRect(0, 0, BW, BH); wc.clearRect(0, 0, BW, BH);
      brush.on = false; brush.dist = hash(cycle, 99, seed) * BH * 4; autoU = 0;
    }
    function newCycle(prepaint) {
      cycle++;
      resetBuffers();
      path = makePath(cycle);
      autoT = prepaint * PAINT_TIME;
      paintAuto(prepaint);
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const palChanged = buildColours();

        // Buffers follow the poster's aspect at a fixed width; a new aspect starts afresh.
        const asp = W / H;
        if (!BH || Math.abs(asp - aspect) / aspect > 0.02) {
          aspect = asp;
          BH = Math.round(BW / asp);
          pigment.width = wet.width = BW; pigment.height = wet.height = BH;
          mottle = wc.createPattern(mottleTile, 'repeat');
          cycle = 0; userMode = false; fadeOut = 0;
          newCycle(0.45); // start with a stroke already half painted
        } else if (palChanged && !userMode) {
          // New palette: repaint the current loop in the new colours.
          const u = autoU; cycle--; newCycle(u);
        }

        // ---- Painting by hand ----
        if (mouse.down && mouse.inside) {
          if (!userMode) { endStroke(); userMode = true; fadeOut = 0; }
          const x = mouse.x * BW, y = mouse.y * BH;
          if (mouse.justPressed || !brush.on) startStroke(x, y);
          walkTo(x, y);
          idle = 0;
        } else if (userMode) {
          if (brush.on) endStroke();
          idle += dt;
          // After a pause, the hand painting fades and the idle loop starts again.
          if (P.autoPaint && idle > 6) { fadeOut += dt / FADE_TIME; if (fadeOut >= 1) { userMode = false; fadeOut = 0; newCycle(0); } }
        } else if (P.autoPaint) {
          // ---- Idle loop: paint, hold, fade, then a new path ----
          autoT += dt * P.speed;
          if (autoT < PAINT_TIME) paintAuto(autoT / PAINT_TIME);
          else { paintAuto(1); if (autoT > PAINT_TIME + HOLD_TIME) fadeOut = (autoT - PAINT_TIME - HOLD_TIME) / FADE_TIME; }
          if (fadeOut >= 1) { fadeOut = 0; newCycle(0); }
        }

        // ---- Compose: paper, pigment, wet paint, paper relief ----
        const light = lum(rgb(pal.bg)) > 0.45;
        c.fillStyle = pal.bg;
        c.fillRect(0, 0, W, H);
        c.save();
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        const vis = 1 - Math.min(1, Math.max(0, fadeOut));
        c.globalCompositeOperation = light ? 'multiply' : 'source-over';
        c.globalAlpha = vis;
        c.drawImage(pigment, 0, 0, W, H);
        c.globalAlpha = vis * P.amount;
        c.drawImage(wet, 0, 0, W, H);
        // Paper relief over everything (it shows through the paint too, like real paper).
        if (P.texture > 0) {
          const pat = c.createPattern(paperTile, 'repeat');
          const k = W / 900;
          pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
          c.globalCompositeOperation = light ? 'multiply' : 'overlay';
          c.globalAlpha = Math.min(1, 0.32 * P.texture);
          c.fillStyle = pat;
          c.fillRect(0, 0, W, H);
        }
        c.restore();
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'watercolour', name: 'Watercolour Trail', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Watercolour Trail
// The brush walks along a path in small steps. Each step adds a short ribbon quad whose two edges
// are pushed in and out by noise (ragged edges), filled with a colour that drifts through the
// palette, and outlined in a darker shade (pigment pools at the edges of a wet stroke).
// Every few dozen steps the wet layer "dries": it is multiplied onto the paint layer, so where the
// stroke crosses itself the colours mix. Idle, it follows a looping sine path; drag to paint.

let paint, wet, brush, u = 0, L = [], R = [], steps = 0;
const BW = 1000;

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  paint = createGraphics(BW, round(BW * height / width)); paint.pixelDensity(1);
  wet = createGraphics(paint.width, paint.height); wet.pixelDensity(1);
  brush = { x: 0, y: 0, d: random(1000), dir: createVector(1, 0) };
  const p = pathAt(0); brush.x = p.x; brush.y = p.y;
}

// A looping path from two sine waves per axis.
function pathAt(t) {
  const a = t * TWO_PI * params.detail;
  return createVector((0.5 + 0.27 * sin(a + 1) + 0.07 * sin(a * 3.7)) * paint.width,
                      (0.5 + 0.33 * sin(a * 1.5 + 2) + 0.06 * sin(a * 4.3)) * paint.height);
}

function colourAt(d) {
  const pal = [colors.c1, colors.c2, colors.c3, colors.c4];
  const t = d / (paint.height * 0.9 * params.spacing), i = floor(t);
  return lerpColor(color(pal[i % 4]), color(pal[(i + 1) % 4]), t - i);
}

function mousePressed() { brush.x = mouseX / width * paint.width; brush.y = mouseY / height * paint.height; L = []; R = []; }

function draw() {
  // Where the brush wants to go: the mouse while pressed, otherwise the idle path.
  let target;
  if (mouseIsPressed) target = createVector(mouseX / width * paint.width, mouseY / height * paint.height);
  else { u += deltaTime / 1000 / 14 * params.speed; target = pathAt(u); }
  // Walk there in 2.5 px steps.
  for (let n = 0; n < 400; n++) {
    const d = p5.Vector.sub(target, createVector(brush.x, brush.y));
    if (d.mag() < 2.5) break;
    d.setMag(2.5);
    step(brush.x + d.x, brush.y + d.y);
  }
  background(colors.bg);
  blendMode(MULTIPLY);
  image(paint, 0, 0, width, height);
  tint(255, 255 * params.amount); image(wet, 0, 0, width, height); noTint();
  blendMode(BLEND);
}

function step(x, y) {
  const dx = x - brush.x, dy = y - brush.y;
  brush.dir.lerp(createVector(dx, dy).normalize(), 0.45);
  const n = createVector(-brush.dir.y, brush.dir.x).normalize();
  brush.x = x; brush.y = y; brush.d += 2.5; steps++;
  const w = BW * 0.036 * params.size * (0.82 + 0.6 * (noise(brush.d * 0.004) - 0.5));
  const wl = w * (1 + 0.18 * (noise(brush.d * 0.05, 1) - 0.5)), wr = w * (1 + 0.18 * (noise(brush.d * 0.05, 2) - 0.5));
  L.push([x + n.x * wl, y + n.y * wl]); R.push([x - n.x * wr, y - n.y * wr]);
  if (L.length > 3) { L.shift(); R.shift(); }
  const c = colourAt(brush.d);
  // Body: a quad reaching back two steps, so neighbours overlap without seams.
  wet.noStroke(); wet.fill(c);
  wet.beginShape();
  for (const p of L) wet.vertex(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) wet.vertex(R[i][0], R[i][1]);
  wet.endShape(CLOSE);
  // Darker pooled edges.
  const edge = lerpColor(c, color(20, 20, 30), 0.32); edge.setAlpha(110 * params.edges);
  wet.noFill(); wet.stroke(edge); wet.strokeWeight(2.5);
  wet.beginShape(); for (const p of L) wet.vertex(p[0], p[1]); wet.endShape();
  wet.beginShape(); for (const p of R) wet.vertex(p[0], p[1]); wet.endShape();
  // Dry: multiply the wet section onto the paint, then clear it.
  if (steps % 34 === 0) {
    paint.blendMode(MULTIPLY); paint.tint(255, 255 * params.amount); paint.image(wet, 0, 0);
    paint.noTint(); paint.blendMode(BLEND); wet.clear();
    L = [L[L.length - 1]]; R = [R[R.length - 1]]; // next quad starts at the seam, no double layer
  }
}
`;
