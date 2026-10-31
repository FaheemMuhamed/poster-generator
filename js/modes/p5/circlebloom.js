// Circle Bloom: clusters of overlapping translucent circles with outlined rings, tiny numbers
// and labels, hairline arcs and connecting lines, and spray dots, in the layered late-90s
// Designers Republic / Joshua Davis manner (refs 64, 67).
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawBloom, drawGrain, hexA } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

// ---- small helpers (kept local so the mode is self-contained) ----
function mulberry(a) {
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.gauss = () => (f() + f() + f() - 1.5) * 2; // cheap bell curve, spread about ±1
  return f;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const easeOutBack = (t) => { const k = 1.7; return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };

// Tiny annotation strings, like the reference's map scales and codes.
function label(r) {
  const d = () => r.int(0, 9);
  switch (r.int(0, 8)) {
    case 0: return `${r.int(10, 99)}`;
    case 1: return `${r.int(10, 99)}_b${d()}`;
    case 2: return `0${d()}m`;
    case 3: return `${d()} ${r.int(100, 999)}`;
    case 4: return `x ${r.int(10, 99)}`;
    case 5: return `_0${d()} _y${d()}`;
    case 6: return `${r.int(10, 99)}m`;
    case 7: return r.pick(['N', 'm', 'kl', '1 mile', 'Scale 1:40']);
    default: return `${d()}${d()}.${d()}`;
  }
}

export default {
  id: 'circlebloom',
  name: 'Circle Bloom',
  engine: 'p5',
  hint: 'Hover to inflate the circles · click to burst a new cluster',
  darkGround: (p) => p.darkGround, // the poster text switches to the light colour
  params: {
    count:     { value: 150, min: 30, max: 400, step: 5, label: 'Circle count', rebuild: true },
    clusters:  { value: 4, min: 1, max: 8, step: 1, label: 'Cluster count', rebuild: true },
    size:      { value: 1, min: 0.4, max: 2, step: 0.01, label: 'Circle size', unit: '×' },
    fill:      { value: 0.82, min: 0.2, max: 1, step: 0.01, label: 'Fill amount' },
    detail:    { value: 1, min: 0, max: 2, step: 0.01, label: 'Detail' },
    spray:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Spray amount' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    hover:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    darkGround:{ value: false, label: 'Dark ground' },
  },
  controls: {
    essentials: ['count', 'size', 'detail', 'clusters'],
    form: ['fill', 'spray'],
    motion: ['speed'],
    interaction: ['hover'],
    colour: ['darkGround'],
  },
  presets: {
    'Night': { darkGround: true, detail: 1.4, fill: 0.9 },
    'Sparse': { count: 70, clusters: 2, detail: 0.6, size: 1.3 },
    'Dense': { count: 320, size: 0.8, spray: 1.7, detail: 1.5 },
  },
  interactions: { hover: 'inflates the circles near the cursor', click: 'bursts a new cluster of circles, labels and spray' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 1e6);
    let clock = 0;
    const bursts = [];

    // Everything lives in poster units: x, y in 0..1, sizes in units of min(W, H).
    // A "group" is one cluster's worth of circles, marks, labels and spray.
    function makeGroup(r, cx, cy, n, spread, born = -1) {
      const g = { circles: [], arcs: [], links: [], labels: [], marks: [], spray: [], dots: [], born };
      for (let i = 0; i < n; i++) {
        const big = Math.pow(r(), 2.3);
        const rad = 0.007 + big * 0.15;
        // Big circles sit near the middle of the cluster, small ones fly further out.
        const sp = spread * (1.3 - big * 0.8);
        const kind = r() < 0.05 ? 'dark' : r() < 0.16 ? 'ring' : r() < 0.13 ? 'outline' : 'fill';
        g.circles.push({
          x: cx + r.gauss() * sp, y: cy + r.gauss() * sp * 1.15, r: rad, kind,
          col: r.int(0, 5), alpha: r.range(0.72, 1), edge: r() < 0.45,
          inner: r() < 0.22 ? r.range(0.18, 0.55) : 0, innerCol: r.int(0, 5),
          ph: r.range(0, 100), sp: r.range(0.3, 1), delay: r() * 0.6, lw: r.range(0.03, 0.1),
        });
      }
      g.circles.sort((a, b) => b.r - a.r);
      const pickC = () => g.circles[Math.floor(Math.pow(r(), 0.7) * g.circles.length)];
      for (let i = 0; i < n * 0.22; i++) { const c = pickC(); g.arcs.push({ c, k: r.range(1.05, 1.7), a0: r.range(0, 6.28), len: r.range(0.6, 3.6), spin: r.range(-0.15, 0.15), dash: r() < 0.3 }); }
      for (let i = 0; i < n * 0.16; i++) g.links.push({ a: pickC(), b: pickC(), bend: r.range(-0.15, 0.15), dot: r() < 0.5 });
      for (let i = 0; i < n * 0.22; i++) {
        const c = pickC();
        const a = r.range(0, 6.28), d = c.r * r.range(0.2, 1.3);
        g.labels.push({ c, dx: Math.cos(a) * d, dy: Math.sin(a) * d, text: label(r), size: r() < 0.08 ? r.range(0.035, 0.06) : r.range(0.011, 0.02), flip: r() < 0.25, col: r.int(0, 6) });
      }
      for (let i = 0; i < n * 0.45; i++) g.marks.push({ x: cx + r.gauss() * spread * 2, y: cy + r.gauss() * spread * 2.2, kind: r.int(0, 3), s: r.range(0.004, 0.009), col: r.int(0, 6) });
      // Spray: soft bell-shaped bursts of tiny dots.
      for (let i = 0; i < Math.max(2, n * 0.08); i++) {
        const sx = cx + r.gauss() * spread * 1.6, sy = cy + r.gauss() * spread * 1.8, rad = r.range(0.03, 0.12), col = r.int(0, 4);
        for (let k = 0; k < 70; k++) {
          const a = r.range(0, 6.28), d = Math.pow(r(), 1.8) * rad;
          g.spray.push(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 1.1, r.range(0.0012, 0.005) * (1 - d / rad * 0.6), col);
        }
      }
      // Dotted lines: rows of evenly spaced dots.
      for (let i = 0; i < Math.max(1, n * 0.03); i++) {
        g.dots.push({ x: cx + r.gauss() * spread * 1.5, y: cy + r.gauss() * spread * 1.5, a: r.range(-0.4, 0.4), len: r.range(0.1, 0.35), n: r.int(14, 40), col: r.int(0, 4) });
      }
      return g;
    }

    // Seeded clusters, spread out so they read as separate blooms but still overlap.
    const rnd = mulberry(seed);
    const groups = [];
    const centres = [];
    for (let i = 0; i < P.clusters; i++) {
      let x, y, tries = 0;
      do { x = rnd.range(0.22, 0.78); y = rnd.range(0.22, 0.8); tries++; }
      while (tries < 30 && centres.some((c) => Math.hypot(c[0] - x, c[1] - y) < 0.55 / Math.sqrt(P.clusters)));
      centres.push([x, y]);
    }
    centres.forEach(([x, y], i) => groups.push(makeGroup(rnd, x, y, Math.round(P.count / P.clusters * (i === 0 ? 1.3 : 0.9)), 0.085 + 0.05 / P.clusters)));
    // A few long hairline curves sweeping across the whole page.
    const sweeps = Array.from({ length: 9 }, () => ({ x0: rnd.range(-0.1, 1.1), y0: rnd.range(0.1, 0.9), x1: rnd.range(-0.1, 1.1), y1: rnd.range(0.1, 0.9), bx: rnd.range(-0.4, 0.4), by: rnd.range(-0.4, 0.4), col: rnd.int(0, 6) }));

    // Palette: four accents, two paler versions of them, plus ink.
    let palKey = '', fills = [], ground = '#fff', line = '#000';
    function buildColours() {
      const pal = ctx.palette;
      const key = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.darkGround;
      if (key === palKey) return;
      palKey = key;
      const bg = rgb(pal.bg), ink = rgb(pal.ink);
      const dark = P.darkGround ? (lum(bg) < lum(ink) ? bg : ink) : bg;
      const g = P.darkGround ? dark : bg;
      const fg = g === bg ? ink : bg;
      ground = toHex(g); line = toHex(fg);
      const acc = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb);
      const light = lum(bg) > lum(ink) ? bg : ink; // pale tones always lean toward the lighter colour
      fills = [...acc, mix(acc[3], light, 0.45), mix(acc[0], light, 0.5), fg].map(toHex);
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        buildColours();
        clock += dt;
        const tt = clock * P.speed;
        const U = Math.min(W, H);
        if (P.darkGround) { c.fillStyle = ground; c.fillRect(0, 0, W, H); }
        else drawBloom(c, W, H, { palette: ctx.palette, seed: ctx.state.seed, time: t, amount: ctx.state.bloom.amount * 0.45, count: ctx.state.bloom.count });

        // Click: a new burst cluster grows out of the cursor.
        if (mouse.justPressed && mouse.inside) {
          const br = mulberry(Math.floor(Math.random() * 1e9));
          bursts.push(makeGroup(br, mouse.x, mouse.y, 26, 0.07, clock));
          if (bursts.length > 5) bursts.shift();
        }

        const hov = mouse.inside ? mPow * P.hover : 0;
        const mx = mouse.x * W, my = mouse.y * H;
        const sig2 = (U * 0.16) ** 2;
        const det = P.detail;

        // Live circle geometry (drift, breathe, hover swell, burst growth).
        const place = (q, grow) => {
          let x = (q.x + Math.sin(tt * 0.07 * q.sp + q.ph) * 0.006) * W;
          let y = (q.y + Math.cos(tt * 0.06 * q.sp + q.ph * 1.3) * 0.006) * H;
          let rr = q.r * U * P.size * (1 + Math.sin(tt * 0.4 * q.sp + q.ph) * 0.03) * grow;
          if (hov > 0) {
            const dx = x - mx, dy = y - my;
            const f = Math.exp(-(dx * dx + dy * dy) / sig2) * hov;
            rr *= 1 + f * 0.85;
            x += dx * f * 0.12; y += dy * f * 0.12;
          }
          q.X = x; q.Y = y; q.R = Math.max(0, rr);
        };

        // Draws one group, in layers: spray and sweeps under, circles, then the fine annotation on top.
        const drawGroup = (g) => {
          const age = g.born < 0 ? 99 : clock - g.born;
          for (const q of g.circles) place(q, g.born < 0 ? 1 : easeOutBack(Math.min(1, Math.max(0, (age - q.delay) / 0.7))));
          const show = Math.min(1, age / 0.8);

          // Spray dots, one path per colour.
          if (P.spray > 0) {
            const n = Math.floor(g.spray.length / 4 * Math.min(1, P.spray));
            for (let col = 0; col < 4; col++) {
              c.fillStyle = fills[col];
              c.globalAlpha = 0.85 * show;
              c.beginPath();
              for (let i = 0; i < n; i++) {
                const o = i * 4;
                if (g.spray[o + 3] !== col) continue;
                const rr = g.spray[o + 2] * U * Math.max(0.6, P.spray);
                const x = g.spray[o] * W, y = g.spray[o + 1] * H;
                c.moveTo(x + rr, y); c.arc(x, y, rr, 0, Math.PI * 2);
              }
              c.fill();
            }
          }

          // Circles.
          for (const q of g.circles) {
            if (q.R < 0.3) continue;
            c.beginPath();
            c.arc(q.X, q.Y, q.R, 0, Math.PI * 2);
            if (q.kind === 'fill' || q.kind === 'dark') {
              c.globalAlpha = (q.kind === 'dark' ? 0.95 : q.alpha * P.fill);
              c.fillStyle = q.kind === 'dark' ? line : fills[q.col];
              c.fill();
              if (q.edge) { c.globalAlpha = 0.7; c.strokeStyle = line; c.lineWidth = Math.max(0.5, U * 0.0011); c.stroke(); }
              if (q.inner) {
                c.globalAlpha = 0.9;
                c.fillStyle = fills[q.innerCol];
                c.beginPath(); c.arc(q.X + q.R * 0.18, q.Y - q.R * 0.12, q.R * q.inner, 0, Math.PI * 2); c.fill();
              }
            } else if (q.kind === 'ring') {
              c.globalAlpha = 0.95;
              c.strokeStyle = fills[q.col];
              c.lineWidth = Math.max(1, Math.min(U * 0.012, q.R * q.lw));
              c.stroke();
            } else {
              c.globalAlpha = 0.75;
              c.strokeStyle = line;
              c.lineWidth = Math.max(0.5, U * 0.0012);
              c.stroke();
            }
          }
          c.globalAlpha = 1;
          if (det <= 0) return;

          // Hairline arcs orbiting some circles, and links between circle centres.
          c.lineWidth = Math.max(0.4, U * 0.0009);
          c.strokeStyle = line;
          c.globalAlpha = 0.55 * show;
          const nArcs = Math.floor(g.arcs.length * Math.min(1, det));
          c.beginPath();
          for (let i = 0; i < nArcs; i++) {
            const a = g.arcs[i];
            if (a.dash) continue;
            const R = a.c.R * a.k, a0 = a.a0 + tt * a.spin;
            c.moveTo(a.c.X + Math.cos(a0) * R, a.c.Y + Math.sin(a0) * R);
            c.arc(a.c.X, a.c.Y, R, a0, a0 + a.len);
          }
          const nLinks = Math.floor(g.links.length * Math.min(1, det));
          for (let i = 0; i < nLinks; i++) {
            const l = g.links[i];
            const mxp = (l.a.X + l.b.X) / 2 - (l.b.Y - l.a.Y) * l.bend, myp = (l.a.Y + l.b.Y) / 2 + (l.b.X - l.a.X) * l.bend;
            c.moveTo(l.a.X, l.a.Y); c.quadraticCurveTo(mxp, myp, l.b.X, l.b.Y);
          }
          c.stroke();
          // Dashed arcs in colour.
          c.setLineDash([U * 0.004, U * 0.006]);
          c.lineWidth = Math.max(0.6, U * 0.0018);
          for (let i = 0; i < nArcs; i++) {
            const a = g.arcs[i];
            if (!a.dash) continue;
            c.strokeStyle = fills[a.c.col % 4 === a.c.col ? (a.c.col + 1) % 4 : 0];
            const R = a.c.R * a.k, a0 = a.a0 - tt * a.spin;
            c.beginPath(); c.arc(a.c.X, a.c.Y, R, a0, a0 + a.len); c.stroke();
          }
          c.setLineDash([]);
          // Dots at the link ends.
          c.fillStyle = line;
          c.beginPath();
          for (let i = 0; i < nLinks; i++) {
            const l = g.links[i];
            if (!l.dot) continue;
            const rr = Math.max(1, U * 0.0028);
            c.moveTo(l.b.X + rr, l.b.Y); c.arc(l.b.X, l.b.Y, rr, 0, Math.PI * 2);
          }
          c.fill();

          // Dotted lines.
          for (const d of g.dots) {
            c.fillStyle = fills[d.col];
            c.beginPath();
            const rr = Math.max(0.8, U * 0.0022);
            for (let k = 0; k < d.n; k++) {
              const s = (k / d.n) * d.len * U;
              const x = d.x * W + Math.cos(d.a) * s, y = d.y * H + Math.sin(d.a) * s;
              c.moveTo(x + rr, y); c.arc(x, y, rr, 0, Math.PI * 2);
            }
            c.fill();
          }

          // Small marks: crosses, plus signs, squares, rings.
          const nMarks = Math.floor(g.marks.length * Math.min(1, det));
          c.lineWidth = Math.max(0.6, U * 0.0016);
          for (let i = 0; i < nMarks; i++) {
            const m = g.marks[i];
            const x = m.x * W, y = m.y * H, s = m.s * U;
            c.strokeStyle = c.fillStyle = fills[m.col];
            c.beginPath();
            if (m.kind === 0) { c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke(); }
            else if (m.kind === 1) { c.moveTo(x - s, y); c.lineTo(x + s, y); c.moveTo(x, y - s); c.lineTo(x, y + s); c.stroke(); }
            else if (m.kind === 2) { c.fillRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 1.2); }
            else { c.arc(x, y, s, 0, Math.PI * 2); c.stroke(); }
          }

          // Tiny labels (some upside down, like the reference's mirrored type).
          const nLab = Math.floor(g.labels.length * Math.min(1, det * 0.8));
          c.textBaseline = 'middle';
          c.textAlign = 'center';
          for (let i = 0; i < nLab; i++) {
            const l = g.labels[i];
            const size = l.size * U * (det > 1 ? 1 + (det - 1) * 0.3 : 1);
            c.fillStyle = fills[l.col];
            c.font = `${l.size > 0.03 ? 500 : 400} ${size.toFixed(1)}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
            c.save();
            c.translate(l.c.X + l.dx * U * P.size, l.c.Y + l.dy * U * P.size);
            if (l.flip) c.rotate(Math.PI);
            c.fillText(l.text, 0, 0);
            c.restore();
          }
        };

        // Long sweeping hairlines first, under everything.
        if (det > 0) {
          c.lineWidth = Math.max(0.4, U * 0.0009);
          for (let i = 0; i < Math.round(sweeps.length * Math.min(1, det)); i++) {
            const s = sweeps[i];
            c.strokeStyle = hexA(fills[s.col], 0.55);
            c.beginPath();
            c.moveTo(s.x0 * W, s.y0 * H);
            c.quadraticCurveTo((0.5 + s.bx + Math.sin(tt * 0.05 + i) * 0.03) * W, (0.5 + s.by) * H, s.x1 * W, s.y1 * H);
            c.stroke();
          }
        }
        for (const g of groups) drawGroup(g);
        for (const g of bursts) drawGroup(g);
        c.globalAlpha = 1;
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'circlebloom', name: 'Circle Bloom', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Circle Bloom
// Clusters of circles: a few big ones in the middle, many small ones flung outward
// (sizes follow a power curve). Layered with transparency, then annotated with hairline
// arcs, links, tiny labels and spray dots. Hover inflates circles; click adds a burst.

let circles = [], spray = [];
const pal = () => [colors.c1, colors.c2, colors.c3, colors.c4];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED);
  for (let k = 0; k < params.clusters; k++) {
    addCluster(random(0.22, 0.78), random(0.22, 0.8), params.count / params.clusters, 0.13);
  }
}

function mousePressed() { addCluster(mouseX / width, mouseY / height, 26, 0.07); }

function addCluster(cx, cy, n, spread) {
  for (let i = 0; i < n; i++) {
    const big = pow(random(), 2.6);            // mostly small, a few large
    const sp = spread * (1.3 - big * 0.8);    // large ones stay near the centre
    circles.push({
      x: cx + randomGaussian() * sp * 0.6, y: cy + randomGaussian() * sp * 0.7,
      r: 0.008 + big * 0.2, col: floor(random(4)), ring: random() < 0.15,
      label: random() < 0.2 ? str(floor(random(10, 99))) + (random() < 0.4 ? '_b' + floor(random(9)) : '') : '',
      arc: random() < 0.25 ? random(TWO_PI) : -1,
    });
  }
  for (let i = 0; i < n * 3; i++) spray.push({ x: cx + randomGaussian() * spread, y: cy + randomGaussian() * spread, c: floor(random(4)) });
  circles.sort((a, b) => b.r - a.r);
}

function draw() {
  background(params.darkGround ? colors.ink : colors.bg);
  const U = min(width, height), t = millis() / 1000 * params.speed;
  const line = params.darkGround ? colors.bg : colors.ink;

  noStroke();                                       // spray
  for (const s of spray) { fill(pal()[s.c]); circle(s.x * width, s.y * height, U * 0.003 * params.spray); }

  for (const c of circles) {
    const x = c.x * width, y = c.y * height;
    let r = c.r * U * params.size;
    r *= 1 + exp(-sq(dist(x, y, mouseX, mouseY)) / sq(U * 0.16)) * 0.85 * params.hover; // hover swell
    const col = color(pal()[c.col]);
    if (c.ring) { noFill(); stroke(col); strokeWeight(max(1, r * 0.12)); }
    else { col.setAlpha(255 * params.fill); fill(col); stroke(line); strokeWeight(0.6); }
    circle(x, y, r * 2);
    if (c.arc >= 0 && params.detail > 0) {          // hairline arc orbiting the circle
      noFill(); stroke(line); strokeWeight(0.6);
      arc(x, y, r * 2.8, r * 2.8, c.arc + t * 0.1, c.arc + t * 0.1 + 2);
    }
    if (c.label && params.detail > 0) {             // tiny label
      noStroke(); fill(line); textSize(U * 0.015); textAlign(CENTER, CENTER);
      text(c.label, x + r * 0.6, y - r * 0.4);
    }
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
