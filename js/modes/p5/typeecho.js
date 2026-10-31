// Type Echo: the title repeated until it becomes a pattern. "Rows" stacks tilted bands of the
// word in two colours, big and small in turn, each band scrolling its own way (ref: MOSCOW).
// "Radial" sends the word out along rays from a small central triangle, every letter scaled
// with its distance so the words zoom out of the centre (ref: a radiating tunnel of type).
// Rows are rotated, clipped rectangles filled with a repeated string; Radial walks each ray in
// log-radius, so letters grow geometrically and the stream loops seamlessly.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { fontCss, bodyCss } from '../../shared/typeLayer.js';

const TAU = Math.PI * 2;
const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export default {
  id: 'typeecho',
  name: 'Type Echo',
  engine: 'p5',
  ownsText: true,
  hint: 'Hover to bend the bands · click to flip the direction',
  params: {
    layout:   { value: 'Rows', options: ['Rows', 'Radial'], label: 'Layout' },
    count:    { value: 11, min: 3, max: 30, step: 1, label: 'Band count' },
    tilt:     { value: 28, min: -60, max: 60, step: 1, label: 'Tilt amount', unit: '°' },
    contrast: { value: 0.65, min: 0, max: 1, step: 0.01, label: 'Size contrast' },
    condense: { value: 0.35, min: 0, max: 0.8, step: 0.01, label: 'Condense amount' },
    spacing:  { value: 0.25, min: 0, max: 1.5, step: 0.01, label: 'Word spacing' },
    speed:    { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    bend:     { value: 1, min: 0, max: 2.5, step: 0.01, label: 'Bend strength' },
    colours:  { value: 'Accents', options: ['Accents', 'Ink & paper', 'All accents'], label: 'Colour pair' },
    details:  { value: true, label: 'Small text' },
  },
  controls: {
    essentials: ['layout', 'count', 'tilt', 'contrast'],
    form: ['spacing'],
    motion: ['speed'],
    interaction: ['bend'],
    colour: ['colours'],
    type: ['condense', 'details'],
  },
  presets: {
    'Poster bands': { layout: 'Rows', count: 11, tilt: 30, contrast: 0.7, condense: 0.4, colours: 'Accents' },
    'Vortex': { layout: 'Radial', count: 9, condense: 0.25, spacing: 0.15, colours: 'Accents' },
    'Quiet stripes': { layout: 'Rows', count: 16, tilt: 0, contrast: 0.2, condense: 0.2, speed: 0.4, colours: 'Ink & paper' },
  },
  interactions: { hover: 'tilts the nearest bands toward the cursor (Radial: twists the rays into a spiral and pulls the centre)', click: 'flips the tilt and the scroll direction' },

  create(ctx) {
    const P = ctx.params;
    const r = ctx.rand;

    // ---- Measurements of the current font, cached until the text or font changes ----
    const mc = document.createElement('canvas');
    const mg = mc.getContext('2d');
    let metrics = null; // { cap, adv: Map(ch -> width at 100px) }
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) metrics = null; });
    function measure() {
      const T = ctx.state.text;
      mg.font = fontCss(T, 100);
      const m = mg.measureText('H');
      const cap = m.actualBoundingBoxAscent > 1 ? m.actualBoundingBoxAscent : 70;
      metrics = { cap, adv: new Map() };
    }
    const advOf = (ch) => {
      let a = metrics.adv.get(ch);
      if (a === undefined) { a = mg.measureText(ch).width; metrics.adv.set(ch, a); }
      return a;
    };

    // ---- Motion state ----
    const scroll = new Float64Array(64);                 // per band, px along the band
    const bandSpeed = Array.from({ length: 64 }, () => r.range(0.6, 1.4));
    const bandBend = new Float32Array(64);               // eased hover tilt per band
    let dir = 1, dirTarget = 1;                          // click flip, eased
    let radialPhase = 0, spin = 0, twist = 0;
    const centre = { x: 0.5, y: 0.5 };

    function colourPair(pal) {
      if (P.colours === 'Ink & paper') return { a: pal.bg, b: pal.ink, cycle: [pal.ink, pal.ink] };
      if (P.colours === 'All accents') return { a: pal.c1, b: pal.c3, cycle: [pal.c1, pal.c2, pal.c3, pal.c4] };
      return { a: pal.c1, b: pal.c3, cycle: [pal.c1, pal.c2] };
    }

    // ---- Rows: tilted bands of the repeated word ----
    function drawRows(c, W, H, t, step) {
      const T = ctx.state.text;
      const pal = ctx.palette;
      const mouse = ctx.pointer;
      const mPow = ctx.state.motion.mouse;
      const title = applyCase(String(T.lines.title || ''), T.textCase).trim() || ' ';
      const others = ['subtitle', 'date', 'venue', 'footer'].map((k) => applyCase(String(T.lines[k] || ''), T.textCase).trim()).filter(Boolean);
      const { a: colA, b: colB } = colourPair(pal);
      const n = Math.max(2, Math.round(P.count));
      const unit = H / n;
      const big = unit * (1 + P.contrast * 0.62), small = unit * (1 - P.contrast * 0.62);
      const len = Math.hypot(W, H) * 1.3;
      const cond = 1 - P.condense * 0.6;
      const tilt = (P.tilt * Math.PI) / 180;
      const hov = mouse.inside && mPow > 0;
      const mx = mouse.x * W, my = mouse.y * H;

      c.fillStyle = colA;
      c.fillRect(0, 0, W, H);
      let y = 0;
      for (let i = 0; i < n + 1 && y < H + big; i++) {
        const isBig = i % 2 === 0;
        const hb = Math.max(4, isBig ? big : small);
        const yc = y + hb / 2;
        y += hb;
        // Tilt profile: flat at the top and bottom, tilted through the middle (like the ref).
        const v = yc / H;
        const prof = smooth(0.08, 0.3, v) * smooth(0.92, 0.7, v);
        // Hover: the band under the cursor leans toward it.
        let target = 0;
        if (hov) {
          const prox = Math.max(0, 1 - Math.abs(yc - my) / (H * 0.22));
          target = prox * prox * 0.45 * Math.min(2, mPow) * P.bend * ((mx / W - 0.5) * 2);
        }
        bandBend[i] += (target - bandBend[i]) * (1 - Math.exp(-step * 5));
        const ang = tilt * prof * dir + bandBend[i];

        // Band colours swap each band.
        const bg = i % 2 ? colA : colB, fg = i % 2 ? colB : colA;
        const str = !isBig && P.details && others.length ? others[(i >> 1) % others.length] : title;
        const size = (hb * (isBig ? 0.94 : 0.8)) / (metrics.cap / 100);
        c.save();
        c.translate(W / 2, yc);
        c.rotate(ang);
        c.beginPath();
        c.rect(-len / 2, -hb / 2, len, hb);
        c.fillStyle = bg;
        c.fill();
        c.clip();
        c.font = fontCss(T, size);
        c.fillStyle = fg;
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.scale(cond, 1);
        const gap = size * (0.18 + P.spacing * 0.5) + (str === title ? 0 : size * 0.3);
        const ww = c.measureText(str).width + gap;
        // Scroll: alternate bands run opposite ways; the flip reverses them all.
        scroll[i] += step * P.speed * bandSpeed[i] * (i % 2 ? -1 : 1) * dir * unit * 1.1;
        const half = len / 2 / cond;
        let x = -half - (((scroll[i] / cond) % ww) + ww) % ww;
        const base = (metrics.cap / 100) * size * 0.5;
        while (x < half) { c.fillText(str, x, base); x += ww; }
        c.restore();
      }
    }

    // ---- Radial: the word streaming out along rays from a centre triangle ----
    function drawRadial(c, W, H, t, step) {
      const T = ctx.state.text;
      const pal = ctx.palette;
      const mouse = ctx.pointer;
      const mPow = ctx.state.motion.mouse;
      const title = applyCase(String(T.lines.title || ''), T.textCase).trim() || ' ';
      const { cycle } = colourPair(pal);
      const ground = P.colours === 'Ink & paper' ? pal.bg : pal.ink;
      const n = Math.max(3, Math.round(P.count));
      const pitch = TAU / n;
      const cond = 1 - P.condense * 0.6;
      const capK = metrics.cap / 100;

      // Hover pulls the centre a little and twists the rays into a spiral.
      const hov = mouse.inside && mPow > 0;
      const tx = hov ? 0.5 + (mouse.x - 0.5) * 0.35 * Math.min(1.5, mPow) : 0.5;
      const ty = hov ? 0.5 + (mouse.y - 0.5) * 0.35 * Math.min(1.5, mPow) : 0.5;
      const e = 1 - Math.exp(-step * 3);
      centre.x += (tx - centre.x) * e; centre.y += (ty - centre.y) * e;
      const twT = hov ? (mouse.x - 0.5) * 0.9 * Math.min(2, mPow) * P.bend : 0;
      twist += (twT - twist) * e;
      const Cx = centre.x * W, Cy = centre.y * H;

      // Letter cap height fills 80% of the ray's angular width; advance is relative to radius.
      const fill = 0.88;
      const chars = [...(title + ' '.repeat(Math.max(1, Math.round(P.spacing * 3))))];
      const steps = chars.map((ch) => {
        const adv = (ch === ' ' ? advOf('n') * 0.6 : advOf(ch)) / 100;
        return Math.log(1 + (adv * cond * pitch * fill) / capK);
      });
      const cycleLen = steps.reduce((a, b) => a + b, 0) || 1;
      radialPhase += step * P.speed * 0.12 * dir;
      spin += step * P.speed * 0.03 * dir;

      const rMin = Math.min(W, H) * 0.075;
      const rMax = Math.hypot(W, H) * 1.05;
      const lo = Math.log(rMin * 0.8), hi = Math.log(rMax);

      c.fillStyle = ground;
      c.fillRect(0, 0, W, H);
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      c.font = fontCss(T, 100);
      const dpr = c.getTransform().a;
      for (let j = 0; j < n; j++) {
        const col = cycle[j % cycle.length];
        c.fillStyle = col;
        const ph = (((radialPhase + j * 0.37 * cycleLen) % cycleLen) + cycleLen) % cycleLen;
        let u = lo - cycleLen + ph;
        let k = 0;
        while (u < hi) {
          const s = steps[k];
          const ch = chars[k];
          k = (k + 1) % chars.length;
          if (ch !== ' ' && u + s > lo) {
            const r0 = Math.exp(u);
            const capH = r0 * pitch * fill;
            const size = capH / capK;
            const th = spin + j * pitch + twist * Math.log(Math.max(1, r0 / rMin));
            // One font at 100px, scaled per letter (setting a new font size per letter is slow).
            const k100 = size / 100;
            const co = Math.cos(th), si = Math.sin(th);
            c.setTransform(dpr * co * cond * k100, dpr * si * cond * k100, -dpr * si * k100, dpr * co * k100,
              dpr * (Cx + co * r0), dpr * (Cy + si * r0));
            c.fillText(ch, 0, capK * 50);
          }
          u += s;
        }
      }

      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Centre: a paper triangle with the first letter inside.
      const tri = rMin * 1.05;
      const ta = -Math.PI / 2 + spin * 0.5;
      c.fillStyle = ground;
      c.beginPath();
      c.arc(Cx, Cy, rMin * 1.18, 0, TAU);
      c.fill();
      c.fillStyle = P.colours === 'Ink & paper' ? pal.ink : pal.bg;
      c.beginPath();
      for (let q = 0; q < 3; q++) {
        const a = ta + (q * TAU) / 3;
        const px = Cx + Math.cos(a) * tri, py = Cy + Math.sin(a) * tri;
        if (q) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
      c.fill();
      c.fillStyle = ground;
      c.font = fontCss(T, tri * 0.55);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText([...title][0] || '', Cx, Cy + tri * 0.12);
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const T = ctx.state.text;
        const step = Math.min(dt, 1 / 30);
        if (!metrics) measure();
        else mg.font = fontCss(T, 100);

        // Click: flip the direction (eased, so the tilt swings through flat).
        if (mouse.justPressed && mouse.inside) dirTarget = -dirTarget;
        dir += (dirTarget - dir) * (1 - Math.exp(-step * 4));
        if (step === 0) dir = dirTarget;

        c.save();
        if (P.layout === 'Radial') drawRadial(c, W, H, t, step);
        else drawRows(c, W, H, t, step);

        // Radial: the other lines small in the corners.
        if (P.layout === 'Radial' && P.details && T.show) {
          const L = T.lines;
          const fs = Math.max(9, Math.min(W, H) * 0.024);
          const m = Math.min(W, H) * 0.05;
          c.font = bodyCss(T, fs);
          c.fillStyle = P.colours === 'Ink & paper' ? pal.ink : pal.bg;
          c.textBaseline = 'alphabetic';
          const put = (s, x, y, align) => { s = applyCase(String(s || ''), T.textCase); if (s) { c.textAlign = align; c.fillText(s, x, y); } };
          put(L.subtitle, m, m + fs, 'left');
          put(L.date, W - m, m + fs, 'right');
          put(L.venue, m, H - m, 'left');
          put(L.footer, W - m, H - m, 'right');
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize: stage.resize,
      frame: stage.frame,
      onParam(key) { if (key === 'text') metrics = null; },
      dispose() { alive = false; stage.dispose(); },
    };
  },
};
