// Score Lines: groups of five hand-drawn staff lines running across a dark page like a music score,
// gently undulating, splashed with organic blots of colour, droplets and specks (ref 66).
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
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const easeOutBack = (t) => { const k = 1.70158; return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const NCOL = 6; // c1..c4, grey, light

// One blot: a lumpy outline (smooth noise + a few splash arms), droplets around it,
// sometimes a second colour on top or a dotted texture. All in poster units (height = 1).
function makeSplat(r, x, y, size) {
  const lobes = Array.from({ length: r.int(1, 4) }, () => [r.range(0, Math.PI * 2), r.range(0.25, 0.9), r.range(0.25, 0.6)]);
  const sd = r.int(1, 1e5);
  const N = 30;
  const shape = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let k = 1 + noise1(a * 1.3, sd) * 0.28 + noise1(a * 4, sd + 1) * 0.08;
    for (const [la, amp, w] of lobes) { let d = Math.abs(a - la); d = Math.min(d, Math.PI * 2 - d); k += amp * Math.exp(-(d * d) / (w * w * 0.2)); }
    shape.push([Math.cos(a) * k, Math.sin(a) * k * r.range(0.85, 1)]);
  }
  const drops = Array.from({ length: r.int(1, 7) }, () => {
    const a = r.range(0, Math.PI * 2), d = r.range(1.3, 3);
    return [Math.cos(a) * d, Math.sin(a) * d, r.range(0.06, 0.22)];
  });
  return {
    x, y, r: size, rot: r.range(0, Math.PI * 2), shape, drops,
    col: r() < 0.14 ? 4 : r() < 0.04 ? 5 : r.int(0, 3),
    second: r() < 0.22 ? { col: r.int(0, 5), dx: r.range(-0.5, 0.5), dy: r.range(-0.5, 0.5), s: r.range(0.35, 0.7) } : null,
    dotted: r() < 0.2,
  };
}

export default {
  id: 'scorelines',
  name: 'Score Lines',
  engine: 'p5',
  hint: 'Hover to bend the staff · click to splash a new blot',
  darkGround: (p) => p.darkGround, // the poster text switches to the light colour
  params: {
    staves:    { value: 9, min: 3, max: 16, step: 1, label: 'Staff count' },
    splats:    { value: 90, min: 0, max: 260, step: 1, label: 'Splat count', rebuild: true },
    splatSize: { value: 1, min: 0.4, max: 2.2, step: 0.01, label: 'Splat size', unit: '×' },
    wave:      { value: 1, min: 0, max: 3, step: 0.01, label: 'Wave amount' },
    spacing:   { value: 1, min: 0.5, max: 2, step: 0.01, label: 'Line spacing', unit: '×' },
    thickness: { value: 1, min: 0.4, max: 3, step: 0.01, label: 'Line thickness', unit: '×' },
    specks:    { value: 1, min: 0, max: 2, step: 0.01, label: 'Speck density' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    hover:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Bend strength' },
    darkGround:{ value: true, label: 'Dark ground' },
  },
  controls: {
    essentials: ['staves', 'splats', 'wave', 'splatSize'],
    form: ['spacing', 'thickness', 'specks'],
    motion: ['speed'],
    interaction: ['hover'],
    colour: ['darkGround'],
  },
  presets: {
    'Calm': { wave: 0.4, splats: 40, speed: 0.5 },
    'Splattered': { splats: 210, splatSize: 1.3, specks: 1.8 },
    'Fine score': { staves: 14, spacing: 0.7, thickness: 0.7, splatSize: 0.7 },
  },
  interactions: { hover: 'bends the staff lines apart around the cursor', click: 'splashes a new blot with droplets' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 1e6);
    const rnd = mulberry(seed);
    let clock = 0;

    // Seeded blots: mostly small, a few large (power curve), anywhere on the page.
    const splats = [];
    for (let i = 0; i < P.splats; i++) splats.push(makeSplat(rnd, rnd.range(0.03, 0.97), rnd.range(0.04, 0.97), 0.006 + Math.pow(rnd(), 2.4) * 0.03));
    const specks = Array.from({ length: 700 }, () => [rnd(), rnd(), rnd.range(0.0012, 0.0035), rnd.int(0, NCOL - 1)]);
    // Per-staff marks: bar lines and little note dashes.
    const marks = Array.from({ length: 16 }, () => ({
      bars: Array.from({ length: rnd.int(2, 6) }, () => [rnd.range(0.08, 0.95), rnd.range(-0.15, 0.15)]),
      notes: Array.from({ length: rnd.int(0, 5) }, () => [rnd.range(0.06, 0.95), rnd.int(0, 4), rnd() < 0.5]),
      x0: rnd.range(0.025, 0.06), x1: rnd.range(0.94, 0.975), ph: rnd.range(0, 100), tilt: rnd.range(-0.02, 0.02),
    }));
    const fresh = []; // clicked splats that are still growing

    // Colours.
    let palKey = '', cols = [], groundCss = '#000', lineCss = '#fff', dotCss = [];
    function buildColours() {
      const pal = ctx.palette;
      const key = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.darkGround;
      if (key === palKey) return false;
      palKey = key;
      const bg = rgb(pal.bg), ink = rgb(pal.ink);
      const ground = P.darkGround ? (lum(bg) < lum(ink) ? bg : ink) : bg;
      const fg = ground === bg ? ink : bg;
      groundCss = css(ground);
      lineCss = css(mix(fg, ground, 0.08));
      const acc = [pal.c1, pal.c2, pal.c3, pal.c4].map(rgb).map((c) => (Math.abs(lum(c) - lum(ground)) < 0.15 ? mix(c, fg, 0.4) : c));
      const all = [...acc, mix(fg, ground, 0.45), fg];
      cols = all.map(css);
      dotCss = all.map((c) => css(mix(c, lum(c) > 0.5 ? ground : fg, 0.4)));
      return true;
    }

    // Static blots are baked into an offscreen layer (redrawn on resize / palette / size change).
    const layer = document.createElement('canvas');
    const lc = layer.getContext('2d');
    let layerKey = '';

    function drawSplat(c, s, W, H, grow = 1, spread = 1) {
      const R = s.r * H * P.splatSize * grow;
      if (R < 0.2) return;
      const cx = s.x * W, cy = s.y * H;
      const cos = Math.cos(s.rot), sin = Math.sin(s.rot);
      const tr = (x, y, k = R) => [cx + (x * cos - y * sin) * k, cy + (x * sin + y * cos) * k];
      const blob = (k, ox = 0, oy = 0) => {
        c.beginPath();
        const n = s.shape.length;
        for (let i = 0; i <= n; i++) {
          const a = s.shape[i % n], b = s.shape[(i + 1) % n];
          const [mx, my] = tr((a[0] + b[0]) / 2 * k + ox, (a[1] + b[1]) / 2 * k + oy);
          if (i === 0) c.moveTo(mx, my);
          else { const [px, py] = tr(a[0] * k + ox, a[1] * k + oy); c.quadraticCurveTo(px, py, mx, my); }
        }
        c.closePath();
      };
      c.fillStyle = cols[s.col];
      blob(1); c.fill();
      if (s.dotted) {
        // Dotted texture, clipped to the blot.
        c.save(); blob(1); c.clip();
        c.fillStyle = dotCss[s.col];
        const st = Math.max(2.5, R * 0.22), rr = st * 0.28;
        c.beginPath();
        for (let y = cy - R * 2; y < cy + R * 2; y += st) for (let x = cx - R * 2 + ((y / st) % 2) * st * 0.5; x < cx + R * 2; x += st) { c.moveTo(x + rr, y); c.arc(x, y, rr, 0, Math.PI * 2); }
        c.fill();
        c.restore();
      }
      if (s.second) { c.fillStyle = cols[s.second.col]; blob(s.second.s, s.second.dx, s.second.dy); c.fill(); }
      c.fillStyle = cols[s.col];
      c.beginPath();
      for (const [dx, dy, dr] of s.drops) { const [x, y] = tr(dx * spread, dy * spread); c.moveTo(x + dr * R, y); c.arc(x, y, dr * R, 0, Math.PI * 2); }
      c.fill();
    }

    function bakeLayer(W, H, d) {
      if (layer.width !== Math.round(W * d) || layer.height !== Math.round(H * d)) { layer.width = Math.round(W * d); layer.height = Math.round(H * d); }
      lc.setTransform(d, 0, 0, d, 0, 0);
      lc.clearRect(0, 0, W, H);
      // Specks first, one path per colour.
      const n = Math.floor(specks.length * Math.min(1, P.specks / 2));
      for (let q = 0; q < NCOL; q++) {
        lc.fillStyle = cols[q];
        lc.beginPath();
        for (let i = 0; i < n; i++) {
          const s = specks[i];
          if (s[3] !== q) continue;
          const rr = s[2] * H * Math.max(0.7, P.specks * 0.7 + 0.3);
          lc.moveTo(s[0] * W + rr, s[1] * H); lc.arc(s[0] * W, s[1] * H, rr, 0, Math.PI * 2);
        }
        lc.fill();
      }
      for (const s of splats) drawSplat(lc, s, W, H);
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const d = p.pixelDensity();
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const palChanged = buildColours();
        clock += dt;
        const tt = clock * P.speed;
        c.fillStyle = groundCss;
        c.fillRect(0, 0, W, H);

        // Click: a new blot that splashes out of the cursor, then joins the baked layer.
        if (mouse.justPressed && mouse.inside) {
          const r = mulberry(Math.floor(Math.random() * 1e9));
          const s = makeSplat(r, mouse.x, mouse.y, r.range(0.018, 0.04));
          s.drops.push(...Array.from({ length: 8 }, () => { const a = r.range(0, Math.PI * 2), dd = r.range(1.6, 4.5); return [Math.cos(a) * dd, Math.sin(a) * dd, r.range(0.05, 0.16)]; }));
          s.born = clock;
          fresh.push(s);
        }

        // ---- Staff lines ----
        const nS = P.staves;
        const top = 0.07, bottom = 0.95;
        const slot = (bottom - top) / nS;
        const gap = Math.min(slot * 0.16, 0.013) * P.spacing; // distance between the five lines
        const amp = 0.012 * P.wave;
        const hov = mouse.inside ? mPow * P.hover : 0;
        const mx = mouse.x, my = mouse.y, asp = W / H;
        c.strokeStyle = lineCss;
        c.lineWidth = Math.max(0.6, H * 0.0017 * P.thickness);
        c.lineJoin = 'round';
        c.lineCap = 'round';
        const steps = 90;
        const ys = new Float32Array(steps + 1);
        c.beginPath();
        for (let k = 0; k < nS; k++) {
          const m = marks[k % marks.length];
          const yc = top + slot * (k + 0.5);
          const x0 = m.x0, x1 = m.x1;
          for (let ln = 0; ln < 5; ln++) {
            const off = (ln - 2) * gap;
            for (let i = 0; i <= steps; i++) {
              const u = i / steps;
              const x = x0 + (x1 - x0) * u;
              // Shared staff wave + a small wobble of each line + hand-drawn jitter.
              let y = yc + off + (u - 0.5) * m.tilt
                + amp * (Math.sin(u * 7 + m.ph + tt * 0.35) * 0.6 + noise1(u * 4 + tt * 0.12, k * 7 + 3) * 0.6)
                + amp * 0.18 * noise1(u * 9 + m.ph + tt * 0.2, k * 31 + ln)
                + (hash(k * 5 + ln, i, seed) - 0.5) * 0.0012;
              // Hover: the lines part around the cursor like a lens.
              if (hov > 0) {
                const dx = (x - mx) * asp, dy = y - my;
                const f = Math.exp(-(dx * dx) / 0.012 - (dy * dy) / 0.004) * hov;
                y += Math.sign(dy || 1) * f * 0.03 + dy * f * 0.6;
              }
              ys[i] = y;
            }
            // Draw, leaving the odd small break like a dry pen.
            let pen = false;
            for (let i = 0; i <= steps; i++) {
              const x = (x0 + (x1 - x0) * (i / steps)) * W, y = ys[i] * H;
              const brk = hash(k * 5 + ln, i, seed + 9) < 0.025;
              if (!pen || brk) { c.moveTo(x, y); pen = !brk; } else c.lineTo(x, y);
            }
            if (ln === 0) { m.yTop = m.yTop || new Float32Array(steps + 1); m.yTop.set(ys); }
          }
          // Bar lines at the ends and across the staff, and short note dashes.
          const yAt = (u, ln) => {
            const i = Math.min(steps, Math.max(0, Math.round(u * steps)));
            return m.yTop[i] + ln * gap;
          };
          const ends = [[0, 0], [1, 0], ...m.bars];
          for (const [u0, lean] of ends) {
            const u = u0 === 0 ? 0 : u0 === 1 ? 1 : (u0 - x0) / (x1 - x0);
            if (u < 0 || u > 1) continue;
            const x = (x0 + (x1 - x0) * u) * W;
            c.moveTo(x - lean * gap * H, yAt(u, 0) * H - gap * H * 0.3);
            c.lineTo(x + lean * gap * H, yAt(u, 4) * H + gap * H * 0.3);
          }
          for (const [u0, ln, up] of m.notes) {
            const u = (u0 - x0) / (x1 - x0);
            if (u < 0 || u > 1) continue;
            const x = (x0 + (x1 - x0) * u) * W, y = yAt(u, ln) * H;
            c.moveTo(x, y); c.lineTo(x + gap * H * 0.5, y + (up ? -1 : 1) * gap * H * 2.4);
          }
        }
        c.stroke();

        // ---- Blots: baked layer, plus any that are still splashing ----
        const lk = `${W}|${H}|${d}|${P.splatSize}|${P.specks}|${palKey}`;
        if (lk !== layerKey || palChanged) { layerKey = lk; bakeLayer(W, H, d); }
        c.drawImage(layer, 0, 0, W, H);
        for (let i = fresh.length - 1; i >= 0; i--) {
          const s = fresh[i];
          const age = (clock - s.born) / 0.6;
          if (age >= 1) {
            fresh.splice(i, 1);
            splats.push(s);
            if (splats.length > P.splats + 60) splats.splice(P.splats, 1);
            layerKey = ''; // re-bake next frame with the new blot
            drawSplat(c, s, W, H);
            continue;
          }
          drawSplat(c, s, W, H, easeOutBack(Math.max(0, age)), 0.3 + easeOut(Math.max(0, age)) * 0.7);
        }
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return { resize: stage.resize, frame: stage.frame, dispose: stage.dispose };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'scorelines', name: 'Score Lines', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab.
const SKETCH = String.raw`
// Score Lines
// Staves of five hand-drawn lines. Each staff shares one slow wave (sine + Perlin noise),
// and every line adds its own small wobble, so they drift like ink on a score.
// Blots are lumpy circles (radius bent by noise) with droplets around them.
// Hover parts the lines around the cursor; click splashes a new blot.

let splats = [];
const pal = () => [colors.c1, colors.c2, colors.c3, colors.c4];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  for (let i = 0; i < params.splats; i++) splats.push(makeSplat(random(width), random(height), 0.006 + pow(random(), 2.4) * 0.03));
}

function mousePressed() { splats.push(makeSplat(mouseX, mouseY, random(0.018, 0.04))); }

function makeSplat(x, y, r) {
  const drops = [];
  for (let i = 0; i < random(1, 7); i++) drops.push(p5.Vector.fromAngle(random(TWO_PI), random(1.3, 3)));
  return { x, y, r, col: random(pal()), seed: random(1000), drops };
}

function draw() {
  const ground = params.darkGround ? colors.ink : colors.bg;
  const ink = params.darkGround ? colors.bg : colors.ink;
  background(ground);
  const t = millis() / 1000 * params.speed;
  const slot = 0.88 / params.staves, gap = min(slot * 0.16, 0.013) * params.spacing;

  // Staff lines
  noFill(); stroke(ink); strokeWeight(max(0.6, height * 0.0017 * params.thickness));
  for (let k = 0; k < params.staves; k++) {
    const yc = 0.07 + slot * (k + 0.5);
    for (let ln = 0; ln < 5; ln++) {
      beginShape();
      for (let u = 0; u <= 1.001; u += 1 / 90) {
        let y = yc + (ln - 2) * gap
          + 0.012 * params.wave * (sin(u * 7 + k + t * 0.35) * 0.6 + (noise(u * 4 + t * 0.12, k) - 0.5) * 1.2)
          + 0.002 * params.wave * (noise(u * 9, k, ln + t * 0.2) - 0.5);
        const x = (0.04 + u * 0.92) * width;
        const f = exp(-sq(x - mouseX) / sq(width * 0.11) - sq(y * height - mouseY) / sq(height * 0.063)) * params.hover;
        y += Math.sign(y * height - mouseY) * f * 0.03;                 // part around the mouse
        vertex(x, y * height);
      }
      endShape();
    }
  }

  // Blots
  noStroke();
  for (const s of splats) {
    fill(s.col);
    const R = s.r * height * params.splatSize;
    beginShape();
    for (let a = 0; a < TWO_PI; a += TWO_PI / 30) {
      const k = 1 + (noise(s.seed + cos(a) * 1.3, s.seed + sin(a) * 1.3) - 0.5) * 0.9;
      curveVertex(s.x + cos(a) * R * k, s.y + sin(a) * R * k);
    }
    endShape(CLOSE);
    for (const d of s.drops) circle(s.x + d.x * R, s.y + d.y * R, R * 0.25);
  }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
