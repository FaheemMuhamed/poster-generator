// Peak Lines: a mountain engraved from stacked ridgelines, printed in two colours (refs 43, 44).
// Each ridge is a bundle of near-parallel lines hanging under a noisy crest. Ridges are drawn
// back to front and each is filled with paper first, so it hides the lines behind it. A
// precomputed foam mask breaks the lines into white streaks in the troughs; the sky is a
// halftone tint inside a thin frame. Cursor and clicks only add to the crest heights.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { p5Sketch } from '../../shared/codegen.js';

// Seeded 2D value noise.
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
const lum = (hex) => { const c = hexRgb(hex); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };
const rgba = (hex, a) => { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

export default {
  id: 'peaklines',
  name: 'Peak Lines',
  engine: 'p5',
  hint: 'Hover to raise a peak under the cursor · click to send a wave through the ridges',
  params: {
    ridges:    { value: 14, min: 6, max: 26, step: 1, label: 'Ridge count', rebuild: true },
    lines:     { value: 24, min: 6, max: 40, step: 1, label: 'Line density', rebuild: true },
    peak:      { value: 1, min: 0, max: 1.6, step: 0.01, label: 'Peak size', rebuild: true },
    foam:      { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Foam amount', rebuild: true },
    detail:    { value: 1, min: 0, max: 2, step: 0.01, label: 'Detail', rebuild: true },
    thickness: { value: 1, min: 0.3, max: 2.5, step: 0.01, label: 'Line thickness' },
    border:    { value: true, label: 'Border' },
    speed:     { value: 0.4, min: 0, max: 2, step: 0.01, label: 'Speed' },
    raise:     { value: 1, min: 0, max: 2, step: 0.01, label: 'Hover strength' },
    ink:       { value: 'Accent', options: ['Accent', 'Ink'], label: 'Print colour' },
    sky:       { value: true, label: 'Sky dots' },
  },
  controls: {
    essentials: ['ridges', 'lines', 'peak', 'foam'],
    form: ['detail', 'thickness', 'border'],
    motion: ['speed'],
    interaction: ['raise'],
    colour: ['ink', 'sky'],
    type: [],
  },
  presets: {
    'Summit': { peak: 1.5, foam: 0.35, ridges: 12, lines: 28 },
    'Rough sea': { peak: 0.25, detail: 1.8, foam: 0.9, speed: 1.2, ridges: 18 },
    'Fine engraving': { lines: 38, thickness: 0.55, ridges: 16, foam: 0.45 },
  },
  interactions: { hover: 'raises a local peak with a ripple in the ridges under the cursor', click: 'sends a wave rolling out through the ridges' },

  create(ctx) {
    const P = ctx.params;
    const r = ctx.rand;
    const noise = makeNoise(r.int(1, 1e6));
    const R = P.ridges, M = P.lines;

    // Ridges in normalised units: u across the inner frame (0..1), v down it (0..1).
    // The main peak sits on a spine that drifts sideways as the ridges come forward.
    const side = r() < 0.5 ? -1 : 1;
    const peakU = r.range(0.42, 0.58);
    const dv = 0.68 / (R - 1);
    const ridges = [];
    for (let k = 0; k < R; k++) {
      const d = k / (R - 1);
      const hills = [];
      for (let i = r.int(2, 4); i > 0; i--) {
        hills.push({ c: r.range(-0.1, 1.1), w: r.range(0.05, 0.16), a: r.range(0.008, 0.05) * (0.5 + d) });
      }
      ridges.push({
        d,
        vb: 0.34 + 0.68 * Math.pow(d, 0.92),
        amp: (0.27 * Math.pow(1 - d, 1.25) + 0.015) * P.peak,
        w: 0.1 + 0.16 * d + r.range(0, 0.03),
        spine: peakU + side * 0.22 * Math.pow(d, 1.2) + (noise(k * 0.4, 7.3) - 0.5) * 0.06,
        hills,
        specks: [],
      });
    }

    // Static shape and foam mask, sampled once (the sample count only depends on CSS size).
    let NS = 0, hs = [], mask = [], shade = [];
    function build(iw) {
      NS = Math.max(60, Math.min(260, Math.round(iw / 3))) + 1;
      hs = []; mask = []; shade = [];
      for (let k = 0; k < R; k++) {
        const rg = ridges[k];
        const h = new Float32Array(NS);
        let lo = Infinity, hi = -Infinity;
        for (let s = 0; s < NS; s++) {
          const u = s / (NS - 1);
          let v = rg.amp * Math.exp(-Math.abs(u - rg.spine) / rg.w);
          for (const b of rg.hills) v += b.a * Math.exp(-(((u - b.c) / b.w) ** 2));
          v += (noise(u * 5 + k * 1.7, k * 0.37) - 0.5) * 0.06 * P.detail;
          v += (noise(u * 17 + k * 3.1, k * 1.9 + 4) - 0.5) * 0.016 * P.detail;
          v += (noise(u * 43 + k * 7.7, k * 2.3 + 9) - 0.5) * 0.005 * P.detail;
          h[s] = v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        hs.push(h);
        // Shadow side: flanks falling away to the right get heavier lines.
        const sh = new Uint8Array(NS);
        for (let s = 1; s < NS - 1; s++) sh[s] = (h[s - 1] - h[s + 1]) * (NS - 1) * 0.5 > 0.12 ? 1 : 0;
        shade.push(sh);
        // Foam: blotchy streaks that span a few lines, more in troughs and just under the crest.
        const mk = [];
        for (let j = 0; j < M; j++) {
          const m = new Uint8Array(NS);
          const crestBand = j >= 1 && j <= 3 ? 0.2 : j === 0 ? -0.25 : 0;
          for (let s = 0; s < NS; s++) {
            const u = s / (NS - 1);
            const trough = 1 - (h[s] - lo) / (hi - lo || 1);
            const f = noise(u * 11 + k * 13.1, j * 0.16 + k * 5.7) * 0.6 + noise(u * 38 + k * 3, j * 0.5 + 2) * 0.4;
            const thr = 0.84 - P.foam * (0.14 + 0.32 * trough * trough + crestBand);
            m[s] = f > thr ? 1 : 0;
          }
          mk.push(m);
        }
        mask.push(mk);
        // Foam specks: mostly paper-coloured, a few ink.
        rg.specks = [];
        const n = Math.round(P.foam * 30);
        for (let i = 0; i < n; i++) {
          rg.specks.push({ s: r.int(0, NS - 1), j: r.range(0, M * 0.6), r: r.range(0.5, 1.7), paper: r() < 0.8 });
        }
      }
    }

    // Offscreen sky: paper, halftone tint and frame margin. Rebuilt on resize or palette change.
    const sky = document.createElement('canvas');
    const sc = sky.getContext('2d');
    let skyKey = '';
    function renderSky(sc, W, H, d, box, paper, ink) {
      sc.setTransform(d, 0, 0, d, 0, 0);
      sc.fillStyle = paper;
      sc.fillRect(0, 0, W, H);
      const { x, y, w, h } = box;
      const g = sc.createLinearGradient(0, y, 0, y + h * 0.65);
      g.addColorStop(0, rgba(ink, 0.2));
      g.addColorStop(1, rgba(ink, 0));
      sc.fillStyle = g;
      sc.fillRect(x, y, w, h);
      if (P.sky) {
        const sp = Math.max(2.4, w / 190);
        sc.fillStyle = rgba(ink, 0.4);
        sc.beginPath();
        for (let yy = y + sp / 2; yy < y + h * 0.7; yy += sp) {
          const k = 1 - (yy - y) / (h * 0.7);
          const rr = sp * 0.32 * Math.sqrt(k);
          if (rr < 0.12) continue;
          const off = (Math.round((yy - y) / sp) % 2) * sp * 0.5;
          for (let xx = x + off; xx < x + w; xx += sp) { sc.moveTo(xx + rr, yy); sc.arc(xx, yy, rr, 0, Math.PI * 2); }
        }
        sc.fill();
      }
    }

    function printInk(pal) {
      if (P.ink === 'Ink') return pal.ink;
      const lb = lum(pal.bg);
      let best = pal.ink, bd = -1;
      for (const k of ['c1', 'c2', 'c3', 'c4']) { const dd = Math.abs(lum(pal[k]) - lb); if (dd > bd) { bd = dd; best = pal[k]; } }
      return bd > 0.3 ? best : pal.ink;
    }

    const waves = [];
    const mouse = { u: 0.5, v: 0.4, amt: 0 };
    let extra = new Float32Array(0), ys = new Float32Array(0);
    let lastIw = -1;

    const stage = createP5Stage(ctx, {
      setup() {},
      draw(p, t, dt) {
        const c = p.drawingContext;
        const W = p.width, H = p.height, d = p.pixelDensity();
        const pal = ctx.palette;
        const paper = pal.bg, ink = printInk(pal);
        const m = P.border ? Math.round(Math.min(W, H) * 0.04) : 0;
        const box = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
        const sc0 = box.w / 600;
        if (box.w !== lastIw) { lastIw = box.w; build(box.w); extra = new Float32Array(NS); ys = new Float32Array(NS); }

        // The sky is cached at screen sizes; large exports draw it straight in (saves a full-size buffer).
        if (d > 3) {
          c.save(); renderSky(c, W, H, d, box, paper, ink); c.restore();
          skyKey = '';
        } else {
          const key = [W, H, d, paper, ink, P.sky, P.border].join('|');
          if (key !== skyKey) {
            skyKey = key;
            sky.width = Math.round(W * d); sky.height = Math.round(H * d);
            renderSky(sc, W, H, d, box, paper, ink);
          }
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.drawImage(sky, 0, 0);
          c.restore();
        }

        // Pointer, eased, in inner-frame units.
        const ptr = ctx.pointer;
        const mPow = ctx.state.motion.mouse * P.raise;
        const pu = (ptr.x * W - box.x) / box.w, pv = (ptr.y * H - box.y) / box.h;
        const on = ptr.inside && mPow > 0;
        const ke = 1 - Math.pow(0.002, Math.max(dt, 0));
        if (on) { mouse.u += (pu - mouse.u) * Math.min(1, ke * 2); mouse.v += (pv - mouse.v) * Math.min(1, ke * 2); }
        mouse.amt += ((on ? mPow : 0) - mouse.amt) * ke;
        if (ptr.justPressed && ptr.inside && ctx.state.motion.mouse > 0) {
          waves.push({ u: pu, v: pv, age: 0 });
          if (waves.length > 6) waves.shift();
        }
        for (let i = waves.length - 1; i >= 0; i--) { waves[i].age += dt; if (waves[i].age > 6) waves.splice(i, 1); }

        const asp = box.w / box.h;
        const ms = Math.max(0, Math.min(NS - 1, Math.round(mouse.u * (NS - 1))));
        const lwLine = 0.68 * P.thickness * sc0;
        const lwCrest = 1.7 * P.thickness * sc0;
        const X = (s) => box.x + (s / (NS - 1)) * box.w;
        const Y = (v) => box.y + v * box.h;

        c.save();
        c.beginPath();
        c.rect(box.x, box.y, box.w, box.h);
        c.clip();
        c.lineJoin = 'round';
        c.lineCap = 'round';

        for (let k = 0; k < R; k++) {
          const rg = ridges[k];
          const h = hs[k];
          // Moving part of the height: idle swell, hover peak, click waves.
          const crestAtMouse = rg.vb - h[ms];
          const g = mouse.amt > 0.001 ? Math.exp(-(((crestAtMouse - mouse.v - 0.02) / 0.13) ** 2)) * mouse.amt : 0;
          for (let s = 0; s < NS; s++) {
            const u = s / (NS - 1);
            let e = 0.007 * rg.d * Math.sin(u * 11 + k * 0.9 - t * P.speed * 1.5);
            if (g > 0.002) {
              const du = Math.abs(u - mouse.u) * asp;
              e += g * (0.15 * Math.exp(-du / 0.065) + 0.012 * Math.sin(du * 70 - t * 7) * Math.exp(-du / 0.14));
            }
            for (const wv of waves) {
              const dist = Math.hypot((u - wv.u) * asp, rg.vb - h[s] - wv.v);
              const front = wv.age * 0.45;
              e += 0.06 * Math.exp(-wv.age * 0.6) * Math.exp(-(((dist - front) / 0.05) ** 2));
            }
            extra[s] = e;
          }

          // Paper fill under the crest hides everything behind this ridge.
          c.fillStyle = paper;
          c.beginPath();
          for (let s = 0; s < NS; s++) {
            const v = rg.vb - h[s] - extra[s];
            ys[s] = v;
            s ? c.lineTo(X(s), Y(v)) : c.moveTo(X(s), Y(v));
          }
          c.lineTo(box.x + box.w, box.y + box.h + 2);
          c.lineTo(box.x, box.y + box.h + 2);
          c.closePath();
          c.fill();

          // The bundle: each line flattens a little as it hangs further under the crest.
          // Two passes: lit flanks, then the heavier shadow flanks.
          c.strokeStyle = ink;
          const mk = mask[k], sh = shade[k];
          for (let pass = 0; pass < 2; pass++) {
            c.lineWidth = pass ? lwLine * 1.75 : lwLine;
            c.beginPath();
            for (let j = 1; j < M; j++) {
              const tt = j / (M - 1);
              const fl = 1 - 0.6 * tt, fe = 1 - 0.3 * tt;
              const off = tt * dv * 1.9;
              let pen = false;
              const mj = mk[j];
              for (let s = 0; s < NS; s++) {
                if (mj[s] || sh[s] !== pass) { pen = false; continue; }
                const v = rg.vb - h[s] * fl - extra[s] * fe + off;
                if (pen) c.lineTo(X(s), Y(v));
                else {
                  // Start from the previous sample so the two passes join up.
                  const s0 = s > 0 && !mj[s - 1] ? s - 1 : s;
                  c.moveTo(X(s0), Y(rg.vb - h[s0] * fl - extra[s0] * fe + off));
                  if (s0 !== s) c.lineTo(X(s), Y(v));
                  pen = true;
                }
              }
            }
            c.stroke();
          }

          // Crest line, heavier.
          c.lineWidth = lwCrest;
          c.beginPath();
          let pen = false;
          const m0 = mk[0];
          for (let s = 0; s < NS; s++) {
            if (m0[s]) { pen = false; continue; }
            if (pen) c.lineTo(X(s), Y(ys[s])); else { c.moveTo(X(s), Y(ys[s])); pen = true; }
          }
          c.stroke();

          // Foam specks.
          for (const sp of rg.specks) {
            const tt = sp.j / (M - 1);
            const v = rg.vb - h[sp.s] * (1 - 0.6 * tt) - extra[sp.s] * (1 - 0.3 * tt) + tt * dv * 1.9;
            c.fillStyle = sp.paper ? paper : ink;
            c.beginPath();
            c.arc(X(sp.s), Y(v), sp.r * sc0 * (sp.paper ? 1.3 : 0.7), 0, Math.PI * 2);
            c.fill();
          }
        }
        c.restore();

        if (P.border) {
          c.strokeStyle = ink;
          c.lineWidth = Math.max(1, 1.6 * sc0);
          c.strokeRect(box.x, box.y, box.w, box.h);
        }
        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize: stage.resize,
      frame: stage.frame,
      onParam(key) { if (key === 'palette' || key === 'ink' || key === 'sky') skyKey = ''; },
      dispose() { stage.dispose(); sky.width = sky.height = 0; },
    };
  },

  code: (values, colors, seed) => p5Sketch({ id: 'peaklines', name: 'Peak Lines', values, colors, seed, sketch: SKETCH }),
};

// Standalone p5.js version for the Code tab (no halftone sky, specks or grain).
const SKETCH = String.raw`
// Peak Lines
// A mountain engraved from stacked ridgelines. Every ridge is a bundle of lines hanging under
// a noisy crest. Ridges are drawn from back to front, and each one is filled with paper first,
// so it hides whatever lies behind it. Noise breaks the lines into white foam in the troughs.
// Move the mouse to raise a peak; click to send a wave.

let ridges = [], waves = [];
const N = 200; // samples across the width

function setup() {
  createCanvas(windowWidth, windowHeight);
  randomSeed(SEED); noiseSeed(SEED);
  const R = params.ridges, side = random() < 0.5 ? -1 : 1, peakU = random(0.42, 0.58);
  for (let k = 0; k < R; k++) {
    const d = k / (R - 1);
    const hills = [];
    for (let i = 0; i < 3; i++) hills.push({ c: random(-0.1, 1.1), w: random(0.05, 0.16), a: random(0.008, 0.05) * (0.5 + d) });
    ridges.push({
      d, hills,
      vb: 0.34 + 0.68 * pow(d, 0.92),                          // where the ridge sits
      amp: (0.27 * pow(1 - d, 1.25) + 0.015) * params.peak,     // how tall its peak is
      w: 0.1 + 0.16 * d,
      spine: peakU + side * 0.22 * pow(d, 1.2),                 // the peak drifts as ridges come forward
    });
  }
}

// Height of ridge k at u (0..1 across), before interaction.
function heightAt(rg, k, u) {
  let v = rg.amp * exp(-abs(u - rg.spine) / rg.w);
  for (const b of rg.hills) v += b.a * exp(-sq((u - b.c) / b.w));
  return v + (noise(u * 5 + k * 1.7, k * 0.37) - 0.5) * 0.05 * params.detail;
}

function mousePressed() { waves.push({ u: mouseX / width, v: mouseY / height, t: millis() / 1000 }); }

function draw() {
  const t = millis() / 1000, paper = colors.bg;
  const ink = params.ink === 'Ink' ? colors.ink : printAccent();
  background(paper);
  const R = ridges.length, M = params.lines, dv = 0.68 / (R - 1);
  const mu = mouseX / width, mv = mouseY / height;

  for (let k = 0; k < R; k++) {
    const rg = ridges[k];
    // Height of every sample: static shape + swell + hover peak + click waves.
    const h = [];
    for (let s = 0; s < N; s++) {
      const u = s / (N - 1);
      const base = heightAt(rg, k, u);
      let e = 0.007 * rg.d * sin(u * 11 + k - t * params.speed * 1.5);
      const g = exp(-sq((rg.vb - base - mv) / 0.09));
      const du = abs(u - mu) * width / height;
      e += g * (0.1 * exp(-du / 0.06) + 0.01 * sin(du * 70 - t * 7) * exp(-du / 0.12));
      for (const w of waves) {
        const age = t - w.t, dist = dist2(u * width / height, rg.vb - base, w.u * width / height, w.v);
        e += 0.045 * exp(-age * 0.7) * exp(-sq((dist - age * 0.45) / 0.045));
      }
      h.push([base, e]);
    }

    // Paper first: hides the ridges behind.
    noStroke(); fill(paper);
    beginShape();
    for (let s = 0; s < N; s++) vertex(s / (N - 1) * width, (rg.vb - h[s][0] - h[s][1]) * height);
    vertex(width, height); vertex(0, height);
    endShape(CLOSE);

    // Then the bundle of lines, broken where the foam noise is high.
    noFill(); stroke(ink);
    for (let j = 0; j < M; j++) {
      const tt = j / (M - 1);
      strokeWeight(j === 0 ? 1.8 * params.thickness : 0.65 * params.thickness);
      let open = false;
      for (let s = 0; s < N; s++) {
        const u = s / (N - 1);
        const foam = noise(u * 16 + k * 13.1, j * 0.24 + k * 5.7);
        const gap = j > 0 && foam > 0.78 - params.foam * 0.25;
        const v = rg.vb - h[s][0] * (1 - 0.6 * tt) - h[s][1] * (1 - 0.3 * tt) + tt * dv * 1.6;
        if (gap) { if (open) { endShape(); open = false; } continue; }
        if (!open) { beginShape(); open = true; }
        vertex(u * width, v * height);
      }
      if (open) endShape();
    }
  }
  waves = waves.filter((w) => t - w.t < 6);
}

const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// The accent that stands out most from the paper.
function printAccent() {
  const b = brightness(colors.bg);
  return ['c1', 'c2', 'c3', 'c4'].map((k) => colors[k]).sort((p, q) => abs(brightness(q) - b) - abs(brightness(p) - b))[0];
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
`;
