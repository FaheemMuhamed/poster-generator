// Redacted: the poster's own words set on a strict grid of rows, then censored. Most cells
// become solid blocks in the palette, some letters sit highlighted inside their box, some are
// blacked out, a few turn into ● and ◆ (refs: blue bars on black, red/grey/black index rows,
// and a column word list with highlight bars).
// The grid is built once into tokens with fixed positions; every frame each token derives its
// state from a hash of its id and its own slowly ticking epoch, so boxes reshuffle one by one.
import { createP5Stage } from '../../shared/p5Stage.js';
import { drawGrain } from '../../shared/bloom2d.js';
import { fontCss, bodyCss } from '../../shared/typeLayer.js';
import { makeRandom } from '../../shared/random.js';

const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);
const LINES = ['title', 'subtitle', 'date', 'venue', 'footer'];
const SYMBOLS = ['●', '◆'];

// Integer hash -> 0..1 (cheap, deterministic, for per-token decisions).
function hash2(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Relative luminance of '#rrggbb' (0..1), for picking readable letter colours on boxes.
function lum(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16) || 0;
  const f = (v) => { v /= 255; return v <= 0.04 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export default {
  id: 'redacted',
  name: 'Redacted',
  engine: 'p5',
  ownsText: true,
  hint: 'Hover to reveal or black out · click to redact again',
  params: {
    layout:     { value: 'Letter grid', options: ['Letter grid', 'Word columns'], label: 'Layout' },
    rows:       { value: 15, min: 6, max: 40, step: 1, label: 'Row count' },
    density:    { value: 0.72, min: 0, max: 1, step: 0.01, label: 'Box density' },
    redact:     { value: 0.22, min: 0, max: 1, step: 0.01, label: 'Redact amount' },
    gaps:       { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Gap amount' },
    symbols:    { value: 0.05, min: 0, max: 0.3, step: 0.01, label: 'Symbol amount' },
    outlines:   { value: true, label: 'Outlines' },
    speed:      { value: 1, min: 0, max: 4, step: 0.01, label: 'Speed' },
    lens:       { value: 1, min: 0.3, max: 2.5, step: 0.01, label: 'Lens size', unit: '×' },
    boxes:      { value: 'Duo', options: ['Mono', 'Duo', 'Mixed'], label: 'Box colours' },
    inverted:   { value: false, label: 'Inverted' },
    letterSize: { value: 1, min: 0.5, max: 1.3, step: 0.01, label: 'Letter size', unit: '×' },
  },
  controls: {
    essentials: ['layout', 'rows', 'density', 'redact'],
    form: ['gaps', 'symbols', 'outlines'],
    motion: ['speed'],
    interaction: ['lens'],
    colour: ['boxes', 'inverted'],
    type: ['letterSize'],
  },
  presets: {
    'Classified': { layout: 'Letter grid', inverted: true, boxes: 'Mono', density: 0.45, redact: 0.3, gaps: 0.7, outlines: false, rows: 18 },
    'Index cards': { layout: 'Letter grid', inverted: false, boxes: 'Duo', density: 0.95, redact: 0.15, gaps: 0.5, outlines: true, rows: 17 },
    'Word list': { layout: 'Word columns', inverted: false, boxes: 'Duo', density: 0.55, redact: 0.35, rows: 20 },
  },
  interactions: { hover: 'opens the boxes under the cursor and blacks out the plain letters', click: 'sweeps a fresh redaction outward from the click' },

  create(ctx) {
    const P = ctx.params;
    const baseSeed = ctx.rand.int(1, 1e9);

    const mc = document.createElement('canvas');
    const mg = mc.getContext('2d');
    let tokens = [];   // { x, y, w, h, ch, title, id, rate, ph, wide, bx, bw, faint, indent }
    let hov = new Float32Array(0);
    let fontSize = 12;
    let built = '';
    let dirty = true;
    let alive = true;
    // Click: tokens inside the growing wave use the new seed, the rest the old one.
    let seed = 0, prevSeed = 0, waveAt = { x: 0, y: 0, t: -1e9 };
    document.fonts?.ready.then(() => { if (alive) dirty = true; });

    // The poster's lines as one stream of characters (title first), repeated to fill the grid.
    function stream(T) {
      const out = [];
      for (const k of LINES) {
        const s = applyCase(String(T.lines[k] || ''), T.textCase).replace(/\s+/g, ' ').trim();
        if (!s) continue;
        for (const ch of s) out.push({ ch, title: k === 'title' });
        out.push({ ch: ' ', title: false }, { ch: ' ', title: false });
      }
      if (!out.length) out.push({ ch: '■', title: true });
      return out;
    }

    // ---- Letter grid: rows of letter cells and wide spacer boxes ----
    function buildGrid(W, H, r) {
      const T = ctx.state.text;
      const n = Math.round(P.rows);
      const rh = H / n;
      const fs = rh * 0.6 * P.letterSize;
      fontSize = fs;
      mg.font = fontCss(T, fs);
      const adv = new Map();
      const advOf = (ch) => { let a = adv.get(ch); if (a === undefined) { a = mg.measureText(ch).width; adv.set(ch, a); } return a; };
      const cw = Math.max(fs * 0.5, advOf('N'));
      const pad = fs * 0.2;
      const src = stream(T);
      let si = 0;
      const next = () => src[si++ % src.length];
      const out = [];
      let id = 1;
      for (let j = 0; j < n; j++) {
        let x = -r.range(0, 1.4) * cw;
        while (x < W) {
          let tk;
          if (r() < P.gaps * 0.32) {
            // A wide spacer box: empty, or one letter floating in the middle of a long bar.
            const s = r() < 0.6 ? next() : null;
            const w = cw * r.range(1.6, 9);
            tk = { x, w, ch: s && s.ch !== ' ' ? s.ch : null, title: !!s?.title, wide: true };
          } else {
            const s = next();
            const w = s.ch === ' ' ? cw * 0.75 : advOf(s.ch) + pad * 2;
            tk = { x, w, ch: s.ch === ' ' ? null : s.ch, title: s.title, wide: false };
          }
          tk.y = j * rh; tk.h = rh; tk.id = id++;
          tk.rate = r.range(0.04, 0.26); tk.ph = r();
          tk.bx = tk.x; tk.bw = tk.w;
          out.push(tk);
          x += tk.w;
        }
      }
      return out;
    }

    // ---- Word columns: vertical word lists in runs, with highlight bars ----
    function buildColumns(W, H, r) {
      const T = ctx.state.text;
      const n = Math.max(8, Math.round(P.rows * 2.6));
      const rh = H / n;
      const fs = rh * 0.78 * P.letterSize;
      fontSize = fs;
      // Words in the body face, title words in the title face (measured in their own face).
      const words = [];
      for (const k of LINES) {
        const s = applyCase(String(T.lines[k] || ''), T.textCase).trim();
        if (s) for (const w of s.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) words.push({ w, title: k === 'title' });
      }
      if (!words.length) words.push({ w: '■', title: true });
      const nCols = Math.max(2, Math.min(9, Math.round(W / Math.max(40, fs * 5.6))));
      const colW = W / nCols;
      const out = [];
      let id = 1, wi = r.int(0, words.length - 1);
      for (let c = 0; c < nCols; c++) {
        let j = r.int(0, Math.round(n * 0.25));
        while (j < n) {
          // A run of words, then a gap; each run is split into strong and faint stretches.
          const len = r.int(4, Math.round(n * 0.6));
          let faint = r() < 0.45;
          for (let k = 0; k < len && j < n; k++, j++) {
            if (r() < 0.12) faint = !faint;
            const word = words[wi++ % words.length];
            const indent = r() < 0.1 ? r.range(0.2, 0.55) * colW : 0;
            mg.font = word.title ? fontCss(T, fs) : bodyCss(T, fs);
            out.push({
              x: c * colW + fs * 0.12 + indent, y: j * rh, w: mg.measureText(word.w).width + fs * 0.24, h: rh,
              ch: word.w, title: word.title, id: id++, rate: r.range(0.04, 0.22), ph: r(), wide: false,
              bx: c * colW + indent, bw: colW - indent - 1, faint: word.title ? false : faint,
            });
          }
          j += r() < 0.5 ? r.int(1, Math.round(n * 0.25)) : 0;
        }
      }
      return out;
    }

    function build(W, H) {
      const r = makeRandom(baseSeed);
      tokens = P.layout === 'Word columns' ? buildColumns(W, H, r) : buildGrid(W, H, r);
      hov = new Float32Array(tokens.length);
      dirty = false;
    }
    const signature = (W, H) => [W, H, P.layout, P.rows, P.gaps, P.letterSize].join('|');

    // Kind of a token this frame: 0 plain, 1 box, 2 redacted, 3 highlight. Also its colour slot
    // and whether a symbol replaces the letter.
    function stateOf(tk, sd, t) {
      const ep = Math.floor(t * P.speed * tk.rate + tk.ph * 13);
      const k = tk.id * 7 + sd * 1013;
      const h0 = hash2(k, ep), h1 = hash2(k + 1, ep), h2 = hash2(k + 2, ep);
      const words = P.layout === 'Word columns';
      const dens = words ? P.density * 0.3 : tk.title ? P.density * 0.85 : P.density;
      let kind = 0;
      if (h0 < dens) {
        const red = P.redact * (tk.title ? 0.35 : 1);
        kind = h1 < red ? 2 : h1 > 1 - 0.12 - (tk.title ? 0.15 : 0) ? 3 : 1;
      }
      const sym = !words && !tk.title && tk.ch && h2 < P.symbols ? SYMBOLS[(h2 * 977) & 1] : null;
      return { kind, slot: (h2 * 1e4) | 0, sym };
    }

    const stage = createP5Stage(ctx, {
      setup(p) { p.noStroke(); },
      draw(p, t, dt) {
        const W = p.width, H = p.height, c = p.drawingContext;
        const pal = ctx.palette;
        const mouse = ctx.pointer;
        const mPow = ctx.state.motion.mouse;
        const T = ctx.state.text;
        const step = Math.min(dt, 1 / 30);
        const sig = signature(W, H);
        if (dirty || sig !== built) { build(W, H); built = sig; }
        const words = P.layout === 'Word columns';

        // ---- Colour roles, all from the palette ----
        const ground = P.inverted ? pal.ink : pal.bg;
        const fg = P.inverted ? pal.bg : pal.ink;
        const outline = lum(pal.bg) < lum(pal.ink) ? pal.bg : pal.ink;
        const acc = [pal.c1, pal.c2, pal.c3, pal.c4];
        const vsGround = acc.filter((a) => contrast(a, ground) > 1.25);
        const pool = vsGround.length ? vsGround : acc;
        const primary = contrast(pal.c1, ground) > 1.6 ? pal.c1 : pool.slice().sort((a, b) => contrast(b, ground) - contrast(a, ground))[0];
        const rest = acc.filter((a) => a !== primary);
        // Second box colour: the lightest remaining accent that still shows on the ground.
        const lightFirst = rest.slice().sort((a, b) => lum(b) - lum(a));
        const secondary = lightFirst.find((a) => contrast(a, ground) > 1.15) || lightFirst[0];
        // Highlight: a paper box (the ref's white cell), or an accent when paper is the ground.
        const highlight = P.inverted || P.outlines ? pal.bg : rest.filter((a) => a !== secondary).sort((a, b) => lum(b) - lum(a))[0] || secondary;
        const boxCols = P.boxes === 'Mono' ? [primary] : P.boxes === 'Duo' ? [primary, primary, secondary] : pool;
        const letterOn = (fill) => (contrast(fill, pal.bg) >= contrast(fill, pal.ink) ? pal.bg : pal.ink);

        // ---- Click: a new seed sweeps outward from the click ----
        const now = performance.now() / 1000;
        if (mouse.justPressed && mouse.inside) {
          prevSeed = seed; seed++;
          waveAt = { x: mouse.x * W, y: mouse.y * H, t: now };
        }
        const front = (now - waveAt.t) * Math.max(W, H) * 1.4;
        const band = Math.max(W, H) * 0.06;

        // ---- Hover lens: a soft memory per token, so the cursor leaves a short trail ----
        const lensOn = mouse.inside && mPow > 0;
        const mx = mouse.x * W, my = mouse.y * H;
        const R = Math.min(W, H) * 0.12 * P.lens * Math.min(1.6, 0.5 + 0.5 * mPow);
        const fade = step * 1.6;

        c.save();
        c.fillStyle = ground;
        c.fillRect(0, 0, W, H);

        const fills = new Map();        // colour -> Path2D of boxes
        const texts = [];               // [x, y, str, colour, alpha]
        const outlinePath = new Path2D();
        const addBox = (col, x, y, w, h) => { let pth = fills.get(col); if (!pth) { pth = new Path2D(); fills.set(col, pth); } pth.rect(x, y, w, h); };
        const inset = words ? Math.max(0.5, fontSize * 0.08) : 0;

        for (let i = 0; i < tokens.length; i++) {
          const tk = tokens[i];
          const cx = tk.bx + tk.bw / 2, cy = tk.y + tk.h / 2;
          // Which seed: inside the click wave the new one.
          const dw = Math.hypot(cx - waveAt.x, cy - waveAt.y);
          const st = stateOf(tk, dw < front ? seed : prevSeed, t);
          let kind = st.kind;
          // The wave front itself is a sweeping bar of redaction.
          if (dw < front && dw > front - band) kind = 2;

          if (lensOn) {
            const dx = Math.max(0, Math.abs(cx - mx) - tk.bw / 2), dy = Math.max(0, Math.abs(cy - my) - tk.h / 2);
            const pr = 1 - Math.hypot(dx, dy * 1.15) / R;
            hov[i] = Math.max(hov[i] - fade, pr > 0 ? Math.min(1, pr * 2.2) : 0);
          } else hov[i] = Math.max(0, hov[i] - fade);
          if (hov[i] > 0.5) kind = kind === 0 ? 2 : 3;

          const x = tk.bx, y = tk.y, w = tk.bw, h = tk.h;
          const label = st.sym || tk.ch;
          if (words) {
            // Word list: bars sit behind words; redaction is a bar with the word ghosted inside.
            if (kind === 1) { addBox(fg, x, y + inset, w, h - inset * 2); texts.push([tk.x, cy, label, ground, 1, tk.title]); }
            else if (kind === 2) { addBox(primary, x, y + inset, w, h - inset * 2); texts.push([tk.x, cy, label, letterOn(primary), 0.22, tk.title]); }
            else if (kind === 3) { addBox(highlight, x, y + inset, w, h - inset * 2); texts.push([tk.x, cy, label, letterOn(highlight), 1, tk.title]); }
            else texts.push([tk.x, cy, label, fg, tk.faint && hov[i] < 0.2 ? 0.3 : 1, tk.title]);
            continue;
          }
          if (kind === 0) { if (label) texts.push([x + w / 2, cy, label, fg, 1]); continue; }
          let fill;
          if (kind === 2) fill = fg;
          else if (kind === 3) fill = highlight;
          else fill = boxCols[st.slot % boxCols.length];
          addBox(fill, x, y, w, h);
          if (P.outlines) outlinePath.rect(x, y, w, h);
          if (kind !== 2 && label) texts.push([x + w / 2, cy, label, letterOn(fill), 1]);
        }

        for (const [col, pth] of fills) { c.fillStyle = col; c.fill(pth); }
        if (P.outlines && !words) {
          c.strokeStyle = outline;
          c.lineWidth = Math.max(1, (H / Math.round(P.rows)) * 0.03);
          c.stroke(outlinePath);
        }

        // ---- Letters ----
        const titleFont = fontCss(T, fontSize), bodyFont = words ? bodyCss(T, fontSize) : titleFont;
        c.font = titleFont;
        c.textAlign = words ? 'left' : 'center';
        c.textBaseline = 'middle';
        const yAdj = fontSize * 0.04;
        let lastCol = '', lastA = 1, lastF = titleFont;
        for (const [x, y, s, col, a, bold] of texts) {
          const f = bold === false ? bodyFont : titleFont;
          if (f !== lastF) { c.font = f; lastF = f; }
          if (col !== lastCol) { c.fillStyle = col; lastCol = col; }
          if (a !== lastA) { c.globalAlpha = a; lastA = a; }
          c.fillText(s, x, y + yAdj);
        }
        c.restore();

        drawGrain(c, W, H, ctx.state.grain);
      },
    });

    return {
      resize(w, h, dpr) { stage.resize(w, h, dpr); },
      frame: stage.frame,
      onParam(key) { if (key === 'text') dirty = true; },
      dispose() { alive = false; stage.dispose(); mc.width = mc.height = 0; },
    };
  },
};
