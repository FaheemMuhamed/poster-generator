// The shared text overlay. `drawType` is a pure function so it can draw onto the live
// overlay canvas, onto an export canvas at any resolution, or into a mode's own texture.
//
// Layouts are built on page grids from book and Swiss typography: each one defines a text
// block (margins), optional columns/rows, and places the five lines on that grid.
// With `showGrid`, the grid itself is drawn as hairline guides (never exported).

import { FONTS_LIBRARY, fontByName } from './fonts.js';

export const FONTS = FONTS_LIBRARY.map((f) => f.name);
export const LINE_KEYS = ['title', 'subtitle', 'date', 'venue', 'footer'];

// Layouts grouped for the picker. "Grid Systems" follows Josef Müller-Brockmann's
// book *Grid Systems in Graphic Design*: the page divided into fields (modules) separated
// by gutters, with every element hung from a field's top line and sized to whole fields.
export const LAYOUT_GROUPS = [
  { name: 'Grid Systems', layouts: {
    '8-field':        '2 × 4 fields, the simplest Brockmann grid',
    '12-field':       '3 × 4 fields, title across two columns',
    '20-field':       '4 × 5 fields, asymmetric title block',
    '32-field':       '4 × 8 fields, captions over a heavy foot',
    '3-column':       'Three text columns under a headline',
    'Swiss 6-column': '6 columns × 8 rows',
    'Stepped':        'Title words step down the fields',
    'Modular 4×4':    'Square modules, one idea each',
  } },
  { name: 'Book canons', layouts: {
    'Van de Graaf':   'Medieval canon, 1/9 margins',
    'Golden canon':   'Title on the golden section',
    'Manuscript':     'Centred, generous margins',
    'Asymmetric':     'Tschichold: narrow + wide column',
    'Two-column':     'Headline over two columns',
  } },
  { name: 'Free', layouts: {
    'Corners':        'Four corners, title top-left',
    'Index strip':    'Caption strip + huge title',
    'Big type':       'Title fills the width',
    'Vertical title': 'Title runs up the spine',
    'Split':          'Top half title, bottom details',
    'Stacked':        'Everything stacked bottom-left',
    'Centered':       'Symmetric, centred title',
    'Vertical edge':  'Captions along the edges',
    'Along curve':    'Title on a sine curve',
  } },
];
export const LAYOUT_INFO = Object.assign({}, ...LAYOUT_GROUPS.map((g) => g.layouts));
export const LAYOUTS = Object.keys(LAYOUT_INFO);

// CSS font shorthand for a font name at the closest weight that font actually has.
function faceCss(name, weight, sizePx) {
  const f = fontByName(name);
  const family = f?.family || name;
  const w = f ? f.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a)) : weight;
  return `${w} ${sizePx}px "${family}", Inter, sans-serif`;
}

// Title face (used by modes that draw their own text too). A weight override of 400 or less
// asks for the body face, so older callers keep working.
export function fontCss(text, sizePx, weightOverride) {
  if (weightOverride !== undefined && weightOverride <= 400) return bodyCss(text, sizePx);
  return faceCss(text.font, weightOverride ?? text.weight, sizePx);
}

export function bodyCss(text, sizePx) {
  return faceCss(text.bodyFont || text.font, text.bodyWeight ?? 400, sizePx);
}

// Ask the browser to load the chosen fonts; calls back once they can be drawn on canvas.
export function loadFont(text, onReady) {
  Promise.all([document.fonts.load(fontCss(text, 40)), document.fonts.load(bodyCss(text, 40))]).then(onReady, onReady);
}

const applyCase = (s, c) => (c === 'UPPERCASE' ? s.toUpperCase() : c === 'lowercase' ? s.toLowerCase() : s);

// ---------- Grid toolkit ----------
// A text block inside margins, divided into cols × rows with a gutter.
// `baseline` (px) adds a baseline grid to the guides.
function grid(w, h, { l, t, r, b, cols = 1, rows = 1, gutter = 0, baseline = 0 }) {
  const x = l, y = t, bw = w - l - r, bh = h - t - b;
  const cw = (bw - gutter * (cols - 1)) / cols;
  const rh = (bh - gutter * (rows - 1)) / rows;
  const g = {
    x, y, w: bw, h: bh, cols, rows, gutter, cw, rh, baseline,
    // A box spanning columns c..c+cs-1 and rows r..r+rs-1.
    cell(c, r0, cs = 1, rs = 1) {
      return { x: x + c * (cw + gutter), y: y + r0 * (rh + gutter), w: cs * cw + (cs - 1) * gutter, h: rs * rh + (rs - 1) * gutter };
    },
  };
  return g;
}

function drawGrid(ctx, g, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.75;
  ctx.setLineDash([]);
  ctx.strokeRect(g.x, g.y, g.w, g.h);
  ctx.globalAlpha = 0.08;
  for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) {
    const b = g.cell(c, r);
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.globalAlpha = 0.35;
  for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) {
    const b = g.cell(c, r);
    if (g.cols > 1 || g.rows > 1) ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  if (g.baseline > 2) {
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let y = g.y; y <= g.y + g.h; y += g.baseline) { ctx.moveTo(g.x, y); ctx.lineTo(g.x + g.w, y); }
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Text helpers ----------
// Calls that pass a weight are captions (body face); calls without one are the title.
// `info` (optional): { w, h, boxes, measure } collects where each line lands (for dragging
// and clearing behind text); with `measure`, nothing is painted.
function makeWriter(ctx, text, palette = {}, info = null) {
  const hasSpacing = 'letterSpacing' in ctx;
  // `st`: this line's own style (text.styles[key]) overriding the shared title/body settings.
  const set = (size, weight, st) => {
    const body = weight !== undefined;
    if (st?.font || st?.weight) {
      const face = st.font || (body ? text.bodyFont || text.font : text.font);
      ctx.font = faceCss(face, st.weight || (body ? text.bodyWeight ?? 400 : text.weight), size);
    } else ctx.font = body ? bodyCss(text, size) : fontCss(text, size);
    const tracking = st?.tracking ?? (body ? text.bodyTracking : text.tracking);
    if (hasSpacing) ctx.letterSpacing = `${(tracking || 0) / 1000 * size}px`;
    return body;
  };
  // Which of the five lines a string is (layouts pass the text itself; joined captions count as their first line).
  const keyOf = (str) => LINE_KEYS.find((k) => text.lines[k] && text.lines[k] === str)
    || LINE_KEYS.find((k) => text.lines[k] && String(str).startsWith(text.lines[k]));
  const base = info ? ctx.getTransform() : null;
  const split = (s) => applyCase(String(s || ''), text.textCase).split('\\n');
  const outline = text.titleStyle === 'Outline';
  // Optional solid shape behind each line ('Block' or 'Pill'). The text switches to the
  // background colour when it would otherwise disappear into the shape.
  const bgShape = text.background === 'Block' || text.background === 'Pill' ? text.background : null;
  const blockFill = palette[text.blockColor] || palette.ink;
  const backdrop = (str, x, y, size) => {
    if (!bgShape || !str.trim()) return;
    const tw = ctx.measureText(str).width;
    const left = ctx.textAlign === 'right' ? x - tw : ctx.textAlign === 'center' ? x - tw / 2 : x;
    const px = size * (bgShape === 'Pill' ? 0.34 : 0.2), py = size * 0.12;
    const bh = size * 1.02 + py * 2;
    const inked = ctx.fillStyle;
    ctx.save();
    ctx.fillStyle = blockFill;
    ctx.beginPath();
    ctx.roundRect(left - px, y - py, tw + px * 2, bh, bgShape === 'Pill' ? bh / 2 : size * 0.04);
    ctx.fill();
    ctx.restore();
    if (String(inked).toLowerCase() === String(blockFill).toLowerCase()) ctx.fillStyle = palette.bg;
    return inked;
  };
  const paint = (str, x, y, size, body) => {
    if (info?.measure) return;
    const restore = backdrop(str, x, y, size);
    if (restore) { draw(str, x, y, size, body); ctx.fillStyle = restore; return; }
    draw(str, x, y, size, body);
  };
  const draw = (str, x, y, size, body) => {
    if (outline && !body) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(0.6, size * 0.022);
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
      ctx.restore();
    } else ctx.fillText(str, x, y);
  };

  // Word-wraps `str` to `maxW`; respects typed "\n".
  const wrap = (str, maxW) => {
    const out = [];
    for (const para of split(str)) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const test = line ? line + ' ' + word : word;
        if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  };

  return {
    // Largest size ≤ maxSize at which the longest word fits `maxW`.
    fit(str, maxW, maxSize, weight) {
      set(maxSize, weight);
      const longest = Math.max(1, ...split(str).flatMap((p) => p.split(/\s+/)).map((wd) => ctx.measureText(wd).width));
      return Math.min(maxSize, maxSize * (maxW / longest));
    },
    // Size at which every line fits the width exactly (no wrapping).
    fill(str, maxW, weight) {
      set(100, weight);
      const widest = Math.max(1, ...split(str).map((p) => ctx.measureText(p).width));
      return 100 * (maxW / widest);
    },
    // Draws wrapped text in a box. valign: 'top' | 'bottom' | 'middle'. Returns height used.
    block(str, box, size, { align = 'left', valign = 'top', weight, leading = 1.08, wrapText = true } = {}) {
      if (!str) return 0;
      const key = keyOf(str);
      const st = key ? text.styles?.[key] : null;
      const off = key ? text.offsets?.[key] : null;
      const sz = size * (st?.size || 1);
      const body = set(sz, weight, st);
      const lines = wrapText ? wrap(str, box.w) : split(str);
      const lh = sz * leading * (text.leading || 1);
      // The layout's space is kept at the shared size, so other lines don't move.
      const total = lines.length * lh;
      let y = valign === 'bottom' ? box.y + box.h - total : valign === 'middle' ? box.y + (box.h - total) / 2 : box.y;
      const x = align === 'right' ? box.x + box.w : align === 'center' ? box.x + box.w / 2 : box.x;
      ctx.save();
      // A dragged line moves in page space, even inside rotated layouts.
      if (off && (off.x || off.y) && info) {
        const m = ctx.getTransform();
        ctx.setTransform(new DOMMatrix().translateSelf(off.x * info.w * base.a, off.y * info.h * base.d).multiplySelf(m));
      }
      if (st?.color && palette[st.color]) ctx.fillStyle = palette[st.color];
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      if (info && key) {
        // The block's box, mapped back to page coordinates.
        const widths = lines.map((ln) => ctx.measureText(ln).width);
        const bw = Math.max(0, ...widths);
        const left = align === 'right' ? x - bw : align === 'center' ? x - bw / 2 : x;
        const m = ctx.getTransform();
        const pts = [[left, y], [left + bw, y], [left, y + total], [left + bw, y + total]]
          .map(([px, py]) => new DOMPoint(px, py).matrixTransform(m)).map((p) => [p.x / base.a, p.y / base.d]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        info.boxes.push({ key, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), size: sz });
      }
      // `only` paints just one line (a mask); `skip` leaves one out (filled by a layer instead).
      const hidden = info && ((info.only && key !== info.only) || (info.skip && key === info.skip));
      if (!hidden) for (const ln of lines) { paint(ln, x, y + sz * 0.02, sz, body); y += lh; }
      ctx.restore();
      return total;
    },
    rule(x1, y1, x2, y2, weight = 1) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = weight;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    },
  };
}

// ---------- Layouts ----------
// Each receives (L = lines, T = writer, w, h, s = sizes) and returns the grid it used.
// Müller-Brockmann field grid: margins, gutter = one baseline unit, cols × rows fields.
function fields(w, h, s, cols, rows) {
  const unit = s.small * 1.35;
  return grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m * 1.4, cols, rows, gutter: unit, baseline: unit });
}
const cap = (s) => ({ size: s.small * 1.05, opts: { weight: 400, leading: 1.3 } });

const LAYOUT_FNS = {
  '8-field'(L, T, w, h, s) {
    const g = fields(w, h, s, 2, 4);
    const tb = g.cell(0, 0, 2, 1);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.5), { leading: 0.98 });
    const c = cap(s);
    T.block(L.subtitle, g.cell(0, 1), c.size * 1.2, c.opts);
    T.block(L.date, g.cell(0, 3), c.size, c.opts);
    T.block(L.venue, g.cell(1, 3), c.size, c.opts);
    T.block(L.footer, g.cell(1, 3), c.size * 0.85, { ...c.opts, valign: 'bottom' });
    return g;
  },

  '12-field'(L, T, w, h, s) {
    const g = fields(w, h, s, 3, 4);
    const tb = g.cell(0, 0, 2, 2);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.3), { leading: 0.98 });
    const c = cap(s);
    T.block(L.subtitle, g.cell(2, 0), c.size, c.opts);
    T.block(L.date, g.cell(0, 3), c.size, c.opts);
    T.block(L.venue, g.cell(1, 3), c.size, c.opts);
    T.block(L.footer, g.cell(2, 3), c.size, c.opts);
    return g;
  },

  '20-field'(L, T, w, h, s) {
    const g = fields(w, h, s, 4, 5);
    const tb = g.cell(1, 1, 3, 2);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.3), { leading: 0.98 });
    const c = cap(s);
    T.block(L.subtitle, g.cell(1, 0, 2, 1), c.size * 1.15, c.opts);
    T.block(L.date, g.cell(0, 4), c.size, c.opts);
    T.block(L.venue, g.cell(1, 4), c.size, c.opts);
    T.block(L.footer, g.cell(3, 4), c.size, c.opts);
    return g;
  },

  '32-field'(L, T, w, h, s) {
    const g = fields(w, h, s, 4, 8);
    const c = cap(s);
    [L.subtitle, L.date, L.venue, L.footer].forEach((str, i) => T.block(str, g.cell(i, 0), c.size * 0.95, c.opts));
    const tb = g.cell(0, 5, 4, 3);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 2), { valign: 'bottom', leading: 0.95 });
    return g;
  },

  '3-column'(L, T, w, h, s) {
    const g = fields(w, h, s, 3, 6);
    const tb = g.cell(0, 0, 3, 2);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.4), { leading: 0.98 });
    const c = cap(s);
    const y = g.cell(0, 3).y;
    T.rule(g.x, y - g.gutter / 2, g.x + g.w, y - g.gutter / 2, 0.75);
    T.block(L.subtitle, g.cell(0, 3, 1, 3), c.size, c.opts);
    T.block(L.date, g.cell(1, 3, 1, 3), c.size, c.opts);
    T.block([L.venue, L.footer].filter(Boolean).join('\\n'), g.cell(2, 3, 1, 3), c.size, c.opts);
    return g;
  },

  // Each title word drops one field down and one column across.
  'Stepped'(L, T, w, h, s) {
    const g = fields(w, h, s, 4, 6);
    const words = String(L.title || '').split(/\s+/).filter(Boolean);
    const size = Math.min(...words.map((wd) => T.fit(wd, g.cw * 2 + g.gutter, s.big * 1.2)), s.big * 1.2);
    words.forEach((wd, i) => {
      const box = g.cell(Math.min(i, 2), Math.min(i, 4), 2, 1);
      T.block(wd, box, size, { wrapText: false });
    });
    const c = cap(s);
    T.block(L.subtitle, g.cell(2, 0, 2, 1), c.size, c.opts);
    T.block(L.date, g.cell(0, 5), c.size, c.opts);
    T.block(L.venue, g.cell(1, 5), c.size, c.opts);
    T.block(L.footer, g.cell(3, 5), c.size, c.opts);
    return g;
  },

  'Corners'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 2, rows: 1, gutter: s.m });
    T.block(L.title, g.cell(0, 0), T.fit(L.title, g.cw, s.big));
    T.block(L.subtitle, g.cell(1, 0), s.small * 1.2, { align: 'right', weight: 400 });
    T.block(L.date, { ...g.cell(0, 0), h: g.h - s.small * 1.6 }, s.small * 1.2, { valign: 'bottom', weight: 400 });
    T.block(L.venue, { ...g.cell(1, 0), h: g.h - s.small * 1.6 }, s.small * 1.2, { align: 'right', valign: 'bottom', weight: 400 });
    T.block(L.footer, { x: g.x, y: g.y, w: g.w, h: g.h }, s.small * 0.9, { align: 'center', valign: 'bottom', weight: 400 });
    return g;
  },

  // Van de Graaf / Villard canon: margins of 1/9 (inner, top) and 2/9 (outer, bottom).
  'Van de Graaf'(L, T, w, h, s) {
    const g = grid(w, h, { l: w / 9, t: h / 9, r: (2 * w) / 9, b: (2 * h) / 9 });
    const ts = T.fit(L.title, g.w, s.big * 1.25);
    let y = g.y;
    y += T.block(L.title, { ...g, y }, ts) + ts * 0.35;
    T.block(L.subtitle, { ...g, y }, s.small * 1.5, { weight: 400 });
    T.block([L.date, L.venue].filter(Boolean).join('\\n'), g, s.small * 1.15, { valign: 'bottom', weight: 400, leading: 1.35 });
    T.block(L.footer, { x: g.x, y: g.y + g.h, w: g.w, h: h / 9 }, s.small * 0.9, { valign: 'middle', weight: 400 });
    return g;
  },

  // Margins in golden ratio steps; title hangs from the golden section of the block.
  'Golden canon'(L, T, w, h, s) {
    const u = w * 0.07, phi = 1.618;
    const g = grid(w, h, { l: u, t: u * phi, r: u * 2, b: u * phi * 2 });
    const goldY = g.y + g.h * 0.382;
    T.block(L.subtitle, g, s.small * 1.2, { weight: 400 });
    const ts = T.fit(L.title, g.w, s.big * 1.3);
    T.block(L.title, { ...g, y: goldY - ts }, ts);
    T.block([L.date, L.venue].filter(Boolean).join('\\n'), { ...g, y: goldY + ts * 1.6, h: g.h * 0.3 }, s.small * 1.15, { weight: 400, leading: 1.4 });
    T.block(L.footer, g, s.small * 0.9, { valign: 'bottom', weight: 400 });
    return g;
  },

  // Josef Müller-Brockmann style: 6 columns × 8 rows.
  'Swiss 6-column'(L, T, w, h, s) {
    const g = fields(w, h, s, 6, 8);
    const tb = g.cell(0, 0, 5, 3);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.4), { leading: 0.98 });
    T.block(L.subtitle, g.cell(0, 5, 2, 1), s.small * 1.05, { weight: 400 });
    T.block(L.date, g.cell(2, 5, 2, 1), s.small * 1.05, { weight: 400 });
    T.block(L.venue, g.cell(4, 5, 2, 1), s.small * 1.05, { weight: 400 });
    T.block(L.footer, g.cell(0, 7, 6, 1), s.small * 0.9, { valign: 'bottom', weight: 400 });
    return g;
  },

  'Modular 4×4'(L, T, w, h, s) {
    const g = fields(w, h, s, 4, 4);
    const tb = g.cell(0, 0, 3, 2);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.2));
    T.block(L.subtitle, g.cell(3, 0), s.small, { weight: 400 });
    T.block(L.date, g.cell(0, 3), s.small, { valign: 'bottom', weight: 400 });
    T.block(L.venue, g.cell(1, 3), s.small, { valign: 'bottom', weight: 400 });
    T.block(L.footer, g.cell(3, 3), s.small, { valign: 'bottom', weight: 400 });
    return g;
  },

  'Two-column'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 2, rows: 6, gutter: s.m * 0.6 });
    const tb = g.cell(0, 0, 2, 2);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.3));
    const left = g.cell(0, 4, 1, 2), right = g.cell(1, 4, 1, 2);
    T.rule(g.x, left.y - s.small * 0.6, g.x + g.w, left.y - s.small * 0.6, 1);
    T.block([L.subtitle, L.date].filter(Boolean).join('\\n'), left, s.small * 1.1, { weight: 400, leading: 1.35 });
    T.block([L.venue, L.footer].filter(Boolean).join('\\n'), right, s.small * 1.1, { weight: 400, leading: 1.35 });
    return g;
  },

  // Jan Tschichold's asymmetric typography: a narrow and a wide column.
  'Asymmetric'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 3, rows: 9, gutter: w * 0.03 });
    const tb = g.cell(1, 3, 2, 3);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.2));
    T.block(L.subtitle, g.cell(1, 2, 2, 1), s.small * 1.2, { valign: 'bottom', weight: 400 });
    T.block([L.date, L.venue].filter(Boolean).join('\\n'), g.cell(1, 6, 2, 2), s.small * 1.1, { weight: 400, leading: 1.4 });
    T.block(L.footer, g.cell(0, 8), s.small * 0.9, { valign: 'bottom', weight: 400 });
    return g;
  },

  'Manuscript'(L, T, w, h, s) {
    const g = grid(w, h, { l: w * 0.16, t: h * 0.14, r: w * 0.16, b: h * 0.14, rows: 3 });
    const ts = T.fit(L.title, g.w, s.big);
    T.block(L.subtitle, g.cell(0, 0), s.small * 1.2, { align: 'center', valign: 'bottom', weight: 400 });
    T.block(L.title, { ...g.cell(0, 1), y: g.cell(0, 1).y + ts * 0.3 }, ts, { align: 'center' });
    T.block([L.date, L.venue].filter(Boolean).join('\\n'), g.cell(0, 2), s.small * 1.1, { align: 'center', valign: 'bottom', weight: 400, leading: 1.5 });
    T.block(L.footer, { x: g.x, y: g.y + g.h, w: g.w, h: h * 0.14 }, s.small * 0.85, { align: 'center', valign: 'middle', weight: 400 });
    return g;
  },

  // A caption strip with hairline rule across the top, and a huge title at the foot.
  'Index strip'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 4, rows: 6, gutter: w * 0.02 });
    [L.subtitle, L.date, L.venue, L.footer].forEach((str, i) => T.block(str, g.cell(i, 0), s.small * 0.95, { weight: 400 }));
    const ry = g.y + s.small * 3.2;
    T.rule(g.x, ry, g.x + g.w, ry, 1);
    const tb = g.cell(0, 3, 4, 3);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 2), { valign: 'bottom', leading: 0.95 });
    return g;
  },

  // Each word of the title sized to fill the full measure.
  'Big type'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 3, rows: 1, gutter: w * 0.02 });
    [L.subtitle, L.date, L.venue].forEach((str, i) => T.block(str, g.cell(i, 0), s.small, { weight: 400, align: i === 2 ? 'right' : 'left' }));
    const words = String(L.title || '').split(/\s+/).filter(Boolean);
    let y = g.y + g.h - s.small * 2;
    for (let i = words.length - 1; i >= 0; i--) {
      const size = Math.min(T.fill(words[i], g.w), h * 0.4);
      y -= size * 0.92;
      T.block(words[i], { x: g.x, y, w: g.w, h: size }, size, { wrapText: false });
    }
    T.block(L.footer, g, s.small * 0.9, { valign: 'bottom', weight: 400 });
    return g;
  },

  'Vertical title'(L, T, w, h, s, ctx) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 4, rows: 4, gutter: w * 0.02 });
    const size = Math.min(T.fill(L.title, g.h), g.cw * 1.8);
    ctx.save();
    ctx.translate(g.x, g.y + g.h);
    ctx.rotate(-Math.PI / 2);
    T.block(L.title, { x: 0, y: 0, w: g.h, h: size }, size, { wrapText: false });
    ctx.restore();
    T.block(L.subtitle, g.cell(2, 0, 2, 1), s.small * 1.3, { weight: 400 });
    T.block([L.date, L.venue].filter(Boolean).join('\\n'), g.cell(2, 3, 2, 1), s.small * 1.1, { valign: 'bottom', weight: 400, leading: 1.4 });
    T.block(L.footer, g.cell(2, 2, 2, 1), s.small * 0.9, { valign: 'bottom', weight: 400 });
    return g;
  },

  'Split'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m, cols: 2, rows: 2, gutter: s.m });
    const tb = g.cell(0, 0, 2, 1);
    T.block(L.title, tb, T.fit(L.title, tb.w, s.big * 1.5), { valign: 'bottom', leading: 0.98 });
    const ry = g.y + g.rh + s.m / 2;
    T.rule(g.x, ry, g.x + g.w, ry, 1);
    T.block(L.subtitle, g.cell(0, 1), s.small * 1.3, { weight: 400 });
    T.block([L.date, L.venue, L.footer].filter(Boolean).join('\\n'), g.cell(1, 1), s.small * 1.1, { weight: 400, leading: 1.4 });
    return g;
  },

  'Stacked'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m });
    let bottom = g.y + g.h;
    for (const [str, size, wt] of [[L.footer, s.small, 400], [L.venue, s.small, 400], [L.date, s.small, 400], [L.subtitle, s.small * 1.5, 400], [L.title, T.fit(L.title, g.w, s.big), undefined]]) {
      if (!str) continue;
      bottom -= T.block(str, { ...g, h: bottom - g.y }, size, { valign: 'bottom', weight: wt }) + size * 0.15;
    }
    return g;
  },

  'Centered'(L, T, w, h, s) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m });
    const ts = T.fit(L.title, g.w, s.big * 1.2);
    T.block(L.subtitle, { ...g, y: h / 2 - ts * 1.3, h: ts }, s.small * 1.3, { align: 'center', valign: 'bottom', weight: 400 });
    T.block(L.title, { ...g, y: h / 2 - ts / 2, h: ts }, ts, { align: 'center' });
    T.block(L.date, { ...g, y: h / 2 + ts * 0.8 }, s.small * 1.3, { align: 'center', weight: 400 });
    T.block(L.venue, g, s.small, { valign: 'bottom', weight: 400 });
    T.block(L.footer, g, s.small, { align: 'right', valign: 'bottom', weight: 400 });
    return g;
  },

  'Vertical edge'(L, T, w, h, s, ctx) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m });
    T.block(L.title, g, T.fit(L.title, g.w * 0.8, s.big * 0.6), { align: 'center' });
    ctx.save(); ctx.translate(w - s.m, s.m * 3); ctx.rotate(Math.PI / 2);
    T.block(L.subtitle, { x: 0, y: 0, w: h, h: s.small * 2 }, s.small * 1.4, { weight: 400, wrapText: false });
    ctx.restore();
    ctx.save(); ctx.translate(s.m, h - s.m * 3); ctx.rotate(-Math.PI / 2);
    T.block([L.date, L.venue].filter(Boolean).join('   ·   '), { x: 0, y: 0, w: h, h: s.small * 2 }, s.small * 1.2, { weight: 400, wrapText: false });
    ctx.restore();
    T.block(L.footer, g, s.small, { align: 'center', valign: 'bottom', weight: 400 });
    return g;
  },

  'Along curve'(L, T, w, h, s, ctx, text) {
    const g = grid(w, h, { l: s.m, t: s.m, r: s.m, b: s.m });
    const str = applyCase(L.title || '', text.textCase);
    const size = s.big * 0.7;
    ctx.font = fontCss(text, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const amp = h * 0.08;
    let x = (w - ctx.measureText(str).width) / 2;
    for (const ch of str) {
      const cw = ctx.measureText(ch).width;
      const cx = x + cw / 2, t = (cx / w) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, h * 0.5 + Math.sin(t) * amp);
      ctx.rotate(Math.atan(Math.cos(t) * amp * (Math.PI * 2 / w)));
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += cw;
    }
    T.block(L.subtitle, g, s.small * 1.2, { weight: 400 });
    T.block(L.date, g, s.small * 1.2, { align: 'right', weight: 400 });
    T.block(L.venue, g, s.small, { valign: 'bottom', weight: 400 });
    T.block(L.footer, g, s.small, { align: 'right', valign: 'bottom', weight: 400 });
    return g;
  },
};

const luma = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };

// Colours for the poster text. Effects with a dark ground (mode.darkGround) swap ink and
// background, so the default ink text stays readable on them.
export function typeColors(state) {
  const c = state.colors;
  return state.darkGround && luma(c.ink) < luma(c.bg) ? { ...c, ink: c.bg, bg: c.ink } : c;
}

// A soft patch of the background colour behind each line ("Clear behind text"):
// a blurred shadow of a rectangle drawn off-canvas, so only its feathered shadow lands.
function clearBehind(ctx, boxes, amount, color) {
  const base = ctx.getTransform();
  ctx.save();
  ctx.setTransform(base);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  const far = 20000;
  for (let pass = 0; pass < (amount > 0.6 ? 2 : 1); pass++) {
    for (const b of boxes) {
      const pad = Math.max(4, b.size * (0.25 + amount * 0.5));
      ctx.shadowBlur = pad * 1.4 * base.a;
      ctx.shadowOffsetX = far * base.a;
      ctx.globalAlpha = 0.35 + amount * 0.65;
      ctx.fillRect(b.x - pad - far, b.y - pad * 0.6, b.w + pad * 2, b.h + pad * 1.2);
    }
  }
  ctx.restore();
}

// opts.showGrid draws the layout's grid as guides (used live, never in exports).
// Returns where each line was drawn: [{ key, x, y, w, h, size }] in page units.
export function drawType(ctx, w, h, text, palette, opts = {}) {
  const layout = LAYOUT_FNS[text.layout] || LAYOUT_FNS.Corners;
  const k = text.size;
  const sizes = { m: w * 0.05, big: w * 0.085 * k, small: w * 0.026 * k };
  const info = { w, h, boxes: [], measure: false, only: opts.only, skip: opts.skip };
  ctx.save();
  let g = null;
  if (text.show) {
    if (text.clear > 0 && !opts.noClear) {
      ctx.save();
      layout(text.lines, makeWriter(ctx, text, palette, { ...info, boxes: info.boxes, measure: true }), w, h, sizes, ctx, text);
      ctx.restore();
      clearBehind(ctx, info.boxes.filter((b) => b.key !== opts.skip), text.clear, palette.bg);
      info.boxes.length = 0;
    }
    ctx.fillStyle = palette[text.color] || palette.ink;
    g = layout(text.lines, makeWriter(ctx, text, palette, info), w, h, sizes, ctx, text);
  } else if (opts.showGrid) {
    // Still show the guides with text hidden, by laying out into an invisible pass.
    ctx.globalAlpha = 0;
    g = layout(text.lines, makeWriter(ctx, text), w, h, sizes, ctx, text);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (opts.showGrid && g) drawGrid(ctx, g, palette.c1 || '#ff3d4e');
  return info.boxes;
}

// The title alone as a black-on-transparent mask (for a layer masked to the title).
export function drawTextMask(ctx, w, h, text) {
  const black = { bg: '#000', ink: '#000', c1: '#000', c2: '#000', c3: '#000', c4: '#000' };
  return drawType(ctx, w, h, { ...text, show: true, clear: 0, background: 'None', titleStyle: 'Fill', styles: Object.fromEntries(Object.entries(text.styles || {}).map(([k, v]) => [k, { ...v, color: undefined }])) }, black, { only: 'title' });
}
