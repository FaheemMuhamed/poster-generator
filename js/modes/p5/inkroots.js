// Ink Roots: watercolour veins on squared paper (refs 36–38). Root tips wander through a
// noise field, branch, and now and then swell into round beads. Each step is painted as a
// faint wash plus a few fibrous strands whose outer edges are darker, like pooled pigment.
// Growth runs in map units (600 wide) and every painted step is kept as a list, so the
// accumulated layer can be replayed crisply at any export size.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

const UW = 600;
const STEP = 1.7;
const STRANDS = [-1, -0.62, -0.2, 0.22, 0.6, 0.98];

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
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export default {
  id: 'inkroots',
  name: 'Ink Roots',
  engine: 'p5',
  hint: 'Hover to draw the roots toward you · click to seed a new root',
  params: {
    roots:     { value: 6, min: 1, max: 14, step: 1, label: 'Root count', rebuild: true },
    branch:    { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Branch amount', rebuild: true },
    beads:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Bead size', rebuild: true },
    thickness: { value: 1, min: 0.3, max: 2.5, step: 0.01, label: 'Stroke thickness', rebuild: true },
    wander:    { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Wander amount', rebuild: true },
    growth:    { value: 1, min: 0.2, max: 2.5, step: 0.01, label: 'Growth amount', rebuild: true },
    grid:      { value: true, label: 'Grid' },
    speed:     { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    pull:      { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
  },
  controls: {
    essentials: ['roots', 'branch', 'beads', 'thickness'],
    form: ['wander', 'growth', 'grid'],
    motion: ['speed'],
    interaction: ['pull'],
    colour: [],
    type: [],
  },
  presets: {
    'Beaded': { beads: 2, branch: 0.6, roots: 4, thickness: 1.3 },
    'Capillaries': { branch: 2.2, beads: 0.4, thickness: 0.6, roots: 7, growth: 1.6 },
    'Single vein': { roots: 1, branch: 0.5, growth: 1.4, wander: 1.6 },
  },
  interactions: { hover: 'steers growing tips toward the cursor and sprouts new ones from roots nearby', click: 'seeds a new root that grows out from the cursor' },

  create(ctx) {
    const P = ctx.params;
    const seed = ctx.rand.int(1, 2 ** 30);
    const rng = makeRng(seed);
    const rf = (a, b) => a + (b - a) * rng();
    const noise = makeNoise(Math.floor(rng() * 1e6));
    let W = 100, H = 100, DPR = 1, S = 1, HU = 850;

    // Painted history: steps ('s') and beads ('b'), in order.
    const ops = [];
    let drawnTo = 0;
    const tips = [];
    const live = []; // beads still swelling
    let rootId = 0;
    const budget = Math.round(5200 * P.growth);
    const hardCap = budget * 2;
    let steps = 0;

    function newTip(x, y, a, w, col, gen, id = rootId++) {
      return { x, y, a, w, col, gen, id, s: rf(0, 100), len: 0, maxLen: rf(160, 420) * Math.pow(0.7, gen) * (0.6 + 0.4 * P.growth), nextBead: rf(12, 60), ink: rng() < 0.18, chain: 0 };
    }
    function seedRoot(x, y, col, born) {
      const a = rf(0, Math.PI * 2);
      const w = rf(2.4, 4.2) * P.thickness;
      const n = rng() < 0.6 ? 2 : 3;
      for (let k = 0; k < n; k++) tips.push(newTip(x, y, a + (k * Math.PI * 2) / n + rf(-0.4, 0.4), w * rf(0.75, 1), col, 0));
      if (P.beads > 0) addBead(x, y, w * rf(2.4, 4) * P.beads, col, born);
    }
    function addBead(x, y, r, col, born) {
      const b = { t: 'b', x, y, r, col, born };
      if (born < 0) ops.push(b); else live.push(b);
    }

    // One step of one tip. Returns false when it dies.
    function stepTip(tip, born, guide) {
      // Lean toward a slow flow field, plus a little jitter of its own.
      const fa = noise(tip.x * 0.0045 + tip.gen * 0.7, tip.y * 0.0045 + 3) * Math.PI * 4;
      let df = fa - tip.a; df = Math.atan2(Math.sin(df), Math.cos(df));
      tip.a += df * 0.025 * P.wander + (rng() - 0.5) * 0.22 * P.wander + (noise(tip.s * 0.04, tip.id) - 0.5) * 0.08 * P.wander;
      // Soft walls: turn back from the edges.
      const m = 30, cx = UW / 2, cy = HU / 2;
      if (tip.x < m || tip.x > UW - m || tip.y < m || tip.y > HU - m) {
        const to = Math.atan2(cy - tip.y, cx - tip.x);
        let d = to - tip.a; d = Math.atan2(Math.sin(d), Math.cos(d));
        tip.a += d * 0.12;
      }
      if (guide) {
        const dx = guide.x - tip.x, dy = guide.y - tip.y, dist = Math.hypot(dx, dy);
        // Steer in from afar; close to the cursor let the tip run on through.
        if (dist < guide.r && dist > 28) {
          let d = Math.atan2(dy, dx) - tip.a; d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) < 2.2) tip.a += d * 0.14 * guide.k * (1 - dist / guide.r);
        }
      }
      const x0 = tip.x, y0 = tip.y;
      const x1 = x0 + Math.cos(tip.a) * STEP, y1 = y0 + Math.sin(tip.a) * STEP;
      // Width breathes along the vein and thins toward the end.
      const s0 = tip.s, s1 = tip.s + STEP;
      const life = tip.len / tip.maxLen;
      const wAt = (s) => tip.w * (0.55 + 0.7 * noise(s * 0.03, tip.id * 1.3)) * (1 - 0.6 * life);
      ops.push({ t: 's', x0, y0, x1, y1, w0: wAt(s0), w1: wAt(s1), s0, s1, id: tip.id, col: tip.col, ink: tip.ink, born });
      tip.x = x1; tip.y = y1; tip.s = s1; tip.len += STEP;
      steps++;
      // Stray fibres off the edge of the vein.
      if (rng() < 0.07) {
        const side = rng() < 0.5 ? -1 : 1;
        ops.push({ t: 'f', x: x1 - Math.sin(tip.a) * side * tip.w * 0.8, y: y1 + Math.cos(tip.a) * side * tip.w * 0.8, a: tip.a + side * rf(0.5, 1.4), len: rf(3, 9) * Math.sqrt(P.thickness), bend: rf(-0.6, 0.6), col: tip.col, born });
      }
      // Beads: single, or a short chain of bulbs.
      if (P.beads > 0 && tip.len > tip.nextBead) {
        const r = tip.w * rf(1.6, 3.6) * P.beads * (tip.gen ? 0.8 : 1);
        addBead(x1 + Math.cos(tip.a) * r * 0.6, y1 + Math.sin(tip.a) * r * 0.6, r, tip.col, born);
        tip.x += Math.cos(tip.a) * r * 1.1; tip.y += Math.sin(tip.a) * r * 1.1;
        if (tip.chain < 2 && rng() < 0.45) { tip.chain++; tip.nextBead = tip.len + r * 0.4; }
        else { tip.chain = 0; tip.nextBead = tip.len + rf(30, 110) / Math.max(0.4, P.beads); }
      }
      // Branches.
      if (tip.gen < 5 && rng() < 0.012 * P.branch * (1.2 - life)) {
        const col = rng() < 0.82 ? tip.col : Math.floor(rng() * 5);
        const child = newTip(x1, y1, tip.a + (rng() < 0.5 ? -1 : 1) * rf(0.4, 1.3), tip.w * rf(0.5, 0.85), col, tip.gen + 1, rng() < 0.6 ? tip.id : rootId++);
        child.s = tip.s;
        tips.push(child);
      }
      return tip.len < tip.maxLen && tip.w * (1 - 0.6 * life) > 0.25;
    }
    function tick(born, guide) {
      const n = Math.min(tips.length, 80);
      for (let i = 0; i < n; i++) {
        const tip = tips.shift();
        if (stepTip(tip, born, guide)) tips.push(tip);
      }
    }

    // Seeds spread over the sheet, then pre-grow half of the budget so it never starts empty.
    let initialised = false;
    function init() {
      initialised = true;
      for (let i = 0; i < P.roots; i++) {
        const x = rf(0.15, 0.85) * UW, y = rf(0.15, 0.85) * HU;
        seedRoot(x, y, i % 5, -1);
      }
      while (steps < budget * 0.7 && tips.length) tick(-1, null);
    }

    // ---------- colours ----------
    let cols = null;
    function colours() {
      const pal = ctx.palette;
      const bg = hexRgb(pal.bg), ink = hexRgb(pal.ink);
      const light = lum(bg) >= lum(ink) ? bg : ink, dark = lum(bg) >= lum(ink) ? ink : bg;
      const acc = ['c1', 'c2', 'c3', 'c4'].map((k) => hexRgb(pal[k]));
      // Warm the paper slightly toward the warmest accent and the ink.
      let warm = acc[0], bw = -1e9;
      for (const a of acc) { const s = a[0] - a[2]; if (s > bw) { bw = s; warm = a; } }
      const paper = mix(mix(light, warm, 0.06), dark, 0.07);
      const pl = lum(paper);
      const fix = (c) => { let o = c; for (let k = 0; k < 8 && Math.abs(lum(o) - pl) < 0.18; k++) o = mix(o, dark, 0.12); return o; };
      const strokes = [...acc.map(fix), mix(dark, paper, 0.15)];
      return { paper, dark, strokes };
    }

    // ---------- painting ----------
    // Strand offsets wobble along the vein but are continuous from step to step.
    const off = (k, s, id) => STRANDS[k] + 0.22 * Math.sin(s * 0.21 + k * 2.1 + id) + 0.12 * Math.sin(s * 0.53 + k * 4.7);
    function paintStep(c, o) {
      const col = cols.strokes[o.col];
      const dx = o.x1 - o.x0, dy = o.y1 - o.y0, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      // Wash.
      c.strokeStyle = css(col, 0.1);
      c.lineWidth = (o.w0 + o.w1) * 1.15;
      c.beginPath(); c.moveTo(o.x0, o.y0); c.lineTo(o.x1, o.y1); c.stroke();
      // Strands: inner pale, outer dark (pooled edges).
      for (let k = 0; k < STRANDS.length; k++) {
        const edge = Math.abs(STRANDS[k]) > 0.8;
        const a0 = off(k, o.s0, o.id) * o.w0, a1 = off(k, o.s1, o.id) * o.w1;
        c.strokeStyle = css(edge ? mix(col, cols.dark, 0.2) : col, edge ? 0.45 : 0.17);
        c.lineWidth = edge ? 0.45 : 0.6;
        c.beginPath();
        c.moveTo(o.x0 + nx * a0, o.y0 + ny * a0);
        c.lineTo(o.x1 + nx * a1, o.y1 + ny * a1);
        c.stroke();
      }
      if (o.ink) {
        c.strokeStyle = css(cols.dark, 0.35);
        c.lineWidth = 0.3;
        const a0 = 0.3 * Math.sin(o.s0 * 0.11) * o.w0, a1 = 0.3 * Math.sin(o.s1 * 0.11) * o.w1;
        c.beginPath(); c.moveTo(o.x0 + nx * a0, o.y0 + ny * a0); c.lineTo(o.x1 + nx * a1, o.y1 + ny * a1); c.stroke();
      }
    }
    function paintBead(c, o, k = 1) {
      const col = cols.strokes[o.col];
      const r = o.r * k;
      if (r < 0.3) return;
      const g = c.createRadialGradient(o.x - r * 0.2, o.y - r * 0.25, 0, o.x, o.y, r);
      g.addColorStop(0, css(mix(col, cols.paper, 0.55), 0.35));
      g.addColorStop(0.7, css(col, 0.42));
      g.addColorStop(1, css(mix(col, cols.dark, 0.15), 0.6));
      c.fillStyle = g;
      c.beginPath(); c.arc(o.x, o.y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = css(mix(col, cols.dark, 0.25), 0.6);
      c.lineWidth = 0.6;
      c.stroke();
      c.strokeStyle = css(col, 0.3);
      c.lineWidth = 0.5;
      c.beginPath(); c.arc(o.x + r * 0.05, o.y + r * 0.04, r * 0.72, 0, Math.PI * 2); c.stroke();
      c.fillStyle = css(mix(col, cols.paper, 0.75), 0.4);
      c.beginPath(); c.arc(o.x - r * 0.18, o.y - r * 0.2, r * 0.22, 0, Math.PI * 2); c.fill();
    }
    function paintFibre(c, o) {
      const ex = o.x + Math.cos(o.a) * o.len, ey = o.y + Math.sin(o.a) * o.len;
      const mx = (o.x + ex) / 2 - Math.sin(o.a) * o.len * o.bend, my = (o.y + ey) / 2 + Math.cos(o.a) * o.len * o.bend;
      c.strokeStyle = css(cols.strokes[o.col], 0.3);
      c.lineWidth = 0.35;
      c.beginPath(); c.moveTo(o.x, o.y); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
    }
    function paintOp(c, o) { if (o.t === 's') paintStep(c, o); else if (o.t === 'f') paintFibre(c, o); else paintBead(c, o); }

    // Paper layer: mottled wash, grid with corner ticks, and a few faint construction lines.
    const paperBuf = document.createElement('canvas');
    const pc = paperBuf.getContext('2d');
    const inkBuf = document.createElement('canvas');
    const ic = inkBuf.getContext('2d');
    let layoutDirty = true;
    const lines = Array.from({ length: 14 }, () => [rng(), rng(), rng(), rng()]);
    function renderPaper() {
      paperBuf.width = Math.max(1, Math.round(W * DPR));
      paperBuf.height = Math.max(1, Math.round(H * DPR));
      const c = pc;
      c.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
      c.fillStyle = css(cols.paper);
      c.fillRect(-1, -1, UW + 2, HU + 2);
      // Mottling: a tiny noise image, smoothed by upscaling.
      const mw = 64, mh = Math.max(4, Math.round((64 * HU) / UW));
      const mc = document.createElement('canvas');
      mc.width = mw; mc.height = mh;
      const mx = mc.getContext('2d');
      const img = mx.createImageData(mw, mh);
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
        const v = noise(i * 0.18 + 40, j * 0.18 + 40) * 0.7 + noise(i * 0.5, j * 0.5 + 9) * 0.3;
        const o = (j * mw + i) * 4;
        img.data[o] = cols.dark[0]; img.data[o + 1] = cols.dark[1]; img.data[o + 2] = cols.dark[2];
        img.data[o + 3] = Math.max(0, (v - 0.35)) * 16;
      }
      mx.putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(mc, 0, 0, UW, HU);
      if (P.grid) {
        const m = 18, gs = (UW - 2 * m) / 9;
        c.strokeStyle = css(cols.dark, 0.1);
        c.lineWidth = 0.45;
        c.beginPath();
        for (let x = m; x <= UW - m + 0.1; x += gs) { c.moveTo(x, m * 0.5); c.lineTo(x, HU - m * 0.5); }
        const rows = Math.round((HU - 2 * m) / gs);
        const gy = (HU - 2 * m) / rows;
        for (let k = 0; k <= rows; k++) { const y = m + k * gy; c.moveTo(m * 0.5, y); c.lineTo(UW - m * 0.5, y); }
        c.stroke();
        c.strokeStyle = css(cols.dark, 0.06);
        c.beginPath();
        for (const [a, b, d, e] of lines) { c.moveTo(a * UW, b * HU); c.lineTo(d * UW, e * HU); }
        c.stroke();
        // Corner ticks.
        c.strokeStyle = css(cols.dark, 0.3);
        c.lineWidth = 0.5;
        c.beginPath();
        for (const [x, y] of [[m, m], [UW - m, m], [m, HU - m], [UW - m, HU - m]]) { c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); }
        c.stroke();
      }
    }
    function renderInk(from) {
      if (from === 0) {
        inkBuf.width = Math.max(1, Math.round(W * DPR));
        inkBuf.height = Math.max(1, Math.round(H * DPR));
      }
      ic.setTransform(S * DPR, 0, 0, S * DPR, 0, 0);
      ic.lineCap = 'round';
      for (let i = from; i < ops.length; i++) paintOp(ic, ops[i]);
      drawnTo = ops.length;
    }

    // ---------- frame ----------
    let palSig = '';
    const guide = { x: 0, y: 0, r: 120, k: 0 };
    let sproutT = 0, acc = 0;
    const stage = createP5Stage(ctx, {
      setup() {},
      draw(p, t, dt) {
        const c = p.drawingContext;
        const pal = ctx.palette;
        const sig = pal.bg + pal.ink + pal.c1 + pal.c2 + pal.c3 + pal.c4 + P.grid;
        if (sig !== palSig) { palSig = sig; layoutDirty = true; }
        if (!initialised) init();
        if (layoutDirty) { layoutDirty = false; cols = colours(); renderPaper(); renderInk(0); }

        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse * P.pull;
        const ux = ptr.x * UW, uy = ptr.y * HU;
        const on = ptr.inside && mPow > 0;
        guide.x = ux; guide.y = uy; guide.r = 130; guide.k += ((on ? mPow : 0) - guide.k) * Math.min(1, dt * 4);

        if (ptr.justPressed && ptr.inside && ctx.state.motion.mouse > 0 && steps < hardCap) {
          seedRoot(ux, uy, Math.floor(rng() * 5), t);
        }
        // Hover sprouts: a new tip from a recent step near the cursor, heading toward it.
        if (on && dt > 0 && steps < hardCap) {
          sproutT -= dt;
          if (sproutT <= 0) {
            sproutT = 0.35 / Math.max(0.2, mPow);
            let best = null, bd = 1e9;
            for (let i = ops.length - 1, n = 0; i >= 0 && n < 4000; i -= 3, n++) {
              const o = ops[i];
              if (o.t !== 's') continue;
              const d = Math.hypot(o.x1 - ux, o.y1 - uy);
              if (d < bd && d > 15) { bd = d; best = o; }
            }
            if (best && bd < 160 && tips.length < 60) {
              const tip = newTip(best.x1, best.y1, Math.atan2(uy - best.y1, ux - best.x1), Math.max(0.5, (best.w0 || 1) * 0.8), best.col, 2, best.id);
              tip.maxLen = bd + rf(20, 80);
              tips.push(tip);
            }
          }
        }
        // Growth: ticks per second scale with Speed.
        if (dt > 0 && tips.length && steps < hardCap) {
          acc += dt * 30 * P.speed;
          let n = Math.min(4, Math.floor(acc));
          acc -= n;
          if (steps >= budget && guide.k < 0.05) n = 0;
          while (n-- > 0) tick(t, guide.k > 0.01 ? guide : null);
        }
        if (drawnTo < ops.length) renderInk(drawnTo);
        // Swelling beads join the history once fully grown.
        for (let i = live.length - 1; i >= 0; i--) {
          if (t - live[i].born > 0.9 || dt === 0) { ops.push(live[i]); live.splice(i, 1); }
        }
        if (drawnTo < ops.length) renderInk(drawnTo);

        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(paperBuf, 0, 0, c.canvas.width, c.canvas.height);
        c.drawImage(inkBuf, 0, 0, c.canvas.width, c.canvas.height);
        c.restore();

        c.save();
        c.scale(S, S);
        for (const b of live) {
          const k = Math.min(1, (t - b.born) / 0.9);
          paintBead(c, b, 1 - Math.pow(1 - k, 3));
        }
        // Wet tips: a small dark drop at every growing end.
        if (dt > 0) {
          for (const tip of tips) {
            c.fillStyle = css(mix(cols.strokes[tip.col], cols.dark, 0.2), 0.45);
            c.beginPath(); c.arc(tip.x, tip.y, Math.max(0.5, tip.w * 0.55), 0, Math.PI * 2); c.fill();
          }
        }
        c.restore();
        drawGrain(c, W, H, ctx.state.grain * 0.6);
      },
    });

    return {
      resize(w, h, dpr) {
        W = w; H = h; DPR = dpr; S = w / UW;
        // Growth lives in map units, so a new pixel size only rescales it; a new aspect starts over.
        const hu = (UW * h) / w;
        if (initialised && Math.abs(hu - HU) > 0.5) {
          initialised = false;
          ops.length = 0; tips.length = 0; live.length = 0; steps = 0; drawnTo = 0;
        }
        HU = hu;
        stage.resize(w, h, dpr);
        layoutDirty = true;
      },
      frame: stage.frame,
      onParam(key) { if (key === 'palette') layoutDirty = true; },
      dispose() { stage.dispose(); paperBuf.width = paperBuf.height = inkBuf.width = inkBuf.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'inkroots', name: 'Ink Roots', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (no paper texture or grain).
const SKETCH = String.raw`
// Ink Roots
// Root tips wander through a noise field, branch now and then, and swell into round beads.
// Nothing is cleared between frames: every step adds a faint wash and a few thin strands,
// and the strands at the edges are darker, so pigment seems to pool along the veins.
// Move the mouse to steer the tips; click to seed a new root.

let tips = [];
const pigments = [colors.c1, colors.c2, colors.c3, colors.c4, colors.ink];

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  background(colors.bg);
  // Faint grid.
  stroke(colors.ink + '18'); strokeWeight(0.5);
  for (let x = 0; x < width; x += width / 9) line(x, 0, x, height);
  for (let y = 0; y < height; y += width / 9) line(0, y, width, y);
  for (let i = 0; i < params.roots; i++) seed(random(width * 0.15, width * 0.85), random(height * 0.15, height * 0.85));
}

function seed(x, y) {
  const col = random(pigments), a = random(TWO_PI);
  for (let k = 0; k < 3; k++) tips.push({ x, y, a: a + k * TWO_PI / 3, w: random(1.5, 3) * params.thickness, col, len: 0, max: random(200, 500), bead: random(20, 80) });
  bead(x, y, 8 * params.beads, col);
}
function mousePressed() { seed(mouseX, mouseY); }

// A watercolour bead: translucent fill, darker rim, a lighter ring inside.
function bead(x, y, r, col) {
  const c = color(col);
  noStroke(); c.setAlpha(90); fill(c); circle(x, y, r * 2);
  noFill(); c.setAlpha(150); stroke(c); strokeWeight(0.8); circle(x, y, r * 2);
  c.setAlpha(60); stroke(c); circle(x, y, r * 1.4);
}

function draw() {
  for (let n = 0; n < 3; n++) for (let i = tips.length - 1; i >= 0; i--) {
    const t = tips[i];
    // Wander with noise, lean toward the mouse when it is close.
    t.a += (noise(t.x * 0.01, t.y * 0.01) - 0.5) * 0.6 * params.wander;
    const d = dist(t.x, t.y, mouseX, mouseY);
    if (d < 150 && d > 25 && (mouseX || mouseY)) t.a += sin(atan2(mouseY - t.y, mouseX - t.x) - t.a) * 0.12;
    const nx = t.x + cos(t.a) * 2, ny = t.y + sin(t.a) * 2;
    const w = t.w * (0.6 + 0.8 * noise(t.len * 0.03, i)) * (1 - 0.6 * t.len / t.max);
    const c = color(t.col);
    // Wash, then strands; outer strands darker.
    c.setAlpha(25); stroke(c); strokeWeight(w * 2.3); line(t.x, t.y, nx, ny);
    for (const o of [-0.9, -0.35, 0.35, 0.9]) {
      c.setAlpha(abs(o) > 0.6 ? 110 : 50); stroke(c); strokeWeight(0.6);
      const px = -sin(t.a) * o * w, py = cos(t.a) * o * w;
      line(t.x + px, t.y + py, nx + px, ny + py);
    }
    t.x = nx; t.y = ny; t.len += 2;
    if (t.len > t.bead) { bead(t.x, t.y, w * random(2, 4) * params.beads, t.col); t.bead += random(30, 110); }
    if (random() < 0.012 * params.branch) tips.push({ ...t, a: t.a + random([-1, 1]) * random(0.4, 1.2), w: t.w * 0.7, len: 0, max: t.max * 0.7 });
    if (t.len > t.max || nx < 0 || ny < 0 || nx > width || ny > height) tips.splice(i, 1);
  }
}
`;
