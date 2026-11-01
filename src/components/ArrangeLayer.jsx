import { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useEngine } from '../useEngine.js';
import { SliderField, SelectField } from './Field.jsx';
import FontPicker from './FontPicker.jsx';
import { toArt } from '../../js/shared/layers.js';
import { cn } from '@/lib/utils';

// On-poster editing ("Arrange"): drag the artwork to pan it, scroll to zoom, drag text lines
// anywhere, move the pin, and click a line to style it on its own. Also draws the guides.
// Nothing here is ever exported.

export const GUIDES = ['None', 'Thirds', 'Centre', 'Golden ratio', 'Safe area'];

const LINE_NAMES = { title: 'Title', subtitle: 'Subtitle', date: 'Date', venue: 'Venue', footer: 'Footer' };
const COLOR_KEYS = [['bg', 'Background'], ['ink', 'Ink'], ['c1', 'Accent 1'], ['c2', 'Accent 2'], ['c3', 'Accent 3'], ['c4', 'Accent 4']];
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const SNAP_PX = 7;

// Safe-area margins (fractions of width, height) for the current format.
function safeArea(format) {
  if (format === '9:16 (Story)') return { l: 0.06, r: 0.06, t: 0.14, b: 0.2 }; // story UI top and bottom
  if (format === '4:5 (Instagram)' || format === '1:1 (Square)') return { l: 0.05, r: 0.05, t: 0.05, b: 0.05 };
  if (format === '16:9 (Landscape)') return { l: 0.05, r: 0.05, t: 0.08, b: 0.08 };
  return { l: 0.04, r: 0.04, t: 0.04, b: 0.04 }; // print: keep clear of trim and bleed
}

// Vertical and horizontal guide lines (fractions) for a guide set.
function guideLines(guides, format) {
  if (guides === 'Thirds') return { xs: [1 / 3, 2 / 3], ys: [1 / 3, 2 / 3] };
  if (guides === 'Centre') return { xs: [0.5], ys: [0.5] };
  if (guides === 'Golden ratio') return { xs: [0.382, 0.618], ys: [0.382, 0.618] };
  if (guides === 'Safe area') { const s = safeArea(format); return { xs: [s.l, 1 - s.r], ys: [s.t, 1 - s.b] }; }
  return { xs: [], ys: [] };
}

// Snaps a value (px) to the nearest line within SNAP_PX; returns the correction.
function snapDelta(values, lines) {
  let best = null;
  for (const v of values) for (const l of lines) {
    const d = l - v;
    if (Math.abs(d) <= SNAP_PX && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best ?? 0;
}

function LineStylePanel({ engine, lineKey, box, size, onClose }) {
  const { state } = engine;
  const st = state.text.styles[lineKey] || {};
  const isTitle = lineKey === 'title';
  const font = st.font || (isTitle ? state.text.font : state.text.bodyFont || state.text.font);
  const weight = st.weight || (isTitle ? state.text.weight : state.text.bodyWeight ?? 400);
  const tracking = st.tracking ?? (isTitle ? state.text.tracking : state.text.bodyTracking) ?? 0;
  // Sits under the line, or above it near the bottom, always inside the poster.
  const below = box.y + box.h + 8 + 300 < size.h;
  const left = Math.max(4, Math.min(size.w - 244, box.x));
  const top = below ? box.y + box.h + 8 : Math.max(4, box.y - 8 - 300);
  return (
    <div
      className="absolute z-20 w-[240px] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-medium">{LINE_NAMES[lineKey]}</span>
        <div className="flex items-center gap-0.5">
          <button type="button" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Reset this line's style and position"
            onClick={() => { engine.setTextStyle(lineKey, null); engine.setTextOffset(lineKey, null); }}>
            <RotateCcw className="size-3.5" />
          </button>
          <button type="button" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <FontPicker label="Font" value={font} onChange={(f) => engine.setTextStyle(lineKey, { font: f })} />
      <SelectField label="Weight" value={weight} options={WEIGHTS} onChange={(w) => engine.setTextStyle(lineKey, { weight: Number(w) })} />
      <SliderField label="Size" value={st.size || 1} min={0.3} max={4} step={0.01} unit="×" onChange={(v) => engine.setTextStyle(lineKey, { size: v })} />
      <SliderField label="Tracking" value={tracking} min={-100} max={400} step={1} onChange={(v) => engine.setTextStyle(lineKey, { tracking: v })} />
      <div className="flex items-center justify-between py-1.5">
        <span className="text-[12px] text-muted-foreground">Colour</span>
        <div className="flex gap-1">
          {COLOR_KEYS.map(([k, label]) => (
            <button key={k} type="button" title={label} aria-label={label} onClick={() => engine.setTextStyle(lineKey, { color: k })}
              className={cn('size-5 rounded-full ring-1 ring-border', st.color === k && 'ring-2 ring-foreground ring-offset-1 ring-offset-popover')}
              style={{ background: state.colors[k] }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ArrangeLayer() {
  const engine = useEngine();
  const { state } = engine;
  const ref = useRef(null);
  const drag = useRef(null);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const size = engine.size;
  const arranging = engine.arranging;
  const boxes = engine.textBoxes;
  const lines = guideLines(engine.guides, state.format);
  const gx = [0.5, ...lines.xs].map((f) => f * size.w), gy = [0.5, ...lines.ys].map((f) => f * size.h);

  useEffect(() => { if (!arranging) setSelected(null); }, [arranging]);

  // Scroll or pinch to zoom around the cursor (needs a non-passive listener).
  useEffect(() => {
    const el = ref.current;
    if (!el || !arranging) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      const v = engine.state.view;
      const z = Math.min(4, Math.max(1, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const a = toArt(v, px, py); // keep the point under the cursor in place
      engine.setView({ zoom: z, x: px - 0.5 - (a.x - 0.5) * z, y: py - 0.5 - (a.y - 0.5) * z });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [engine, arranging]);

  const local = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (p) => [...boxes].reverse().find((b) => p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4);
  const nearPin = (p) => state.pin.on && Math.hypot(p.x - state.pin.x * size.w, p.y - state.pin.y * size.h) < 14;

  const onPointerDown = (e) => {
    if (!arranging) return;
    const p = local(e);
    ref.current.setPointerCapture(e.pointerId);
    if (nearPin(p)) drag.current = { kind: 'pin', start: p, moved: false };
    else {
      const b = hit(p);
      if (b) drag.current = { kind: 'text', key: b.key, box: b, start: p, orig: state.text.offsets[b.key] || { x: 0, y: 0 }, moved: false };
      else drag.current = { kind: 'pan', start: p, orig: { ...state.view }, moved: false };
    }
  };
  const onPointerMove = (e) => {
    if (!arranging) return;
    const p = local(e);
    const d = drag.current;
    if (!d) { setHover(nearPin(p) ? 'pin' : hit(p)?.key || null); return; }
    let dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') {
      engine.setView({ x: d.orig.x + dx / size.w, y: d.orig.y + dy / size.h });
    } else if (d.kind === 'pin') {
      let x = p.x, y = p.y;
      x += snapDelta([x], gx); y += snapDelta([y], gy);
      engine.setPin({ x: x / size.w, y: y / size.h });
    } else {
      const b = d.box;
      dx += snapDelta([b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx], gx);
      dy += snapDelta([b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy], gy);
      engine.setTextOffset(d.key, { x: d.orig.x + dx / size.w, y: d.orig.y + dy / size.h });
      setSelected(null);
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    // A click (no drag) on a line opens its style panel.
    if (d.kind === 'text') setSelected(d.key);
    else setSelected(null);
  };
  const onDoubleClick = (e) => {
    if (!arranging) return;
    const b = hit(local(e));
    if (b) { engine.setTextOffset(b.key, null); setSelected(null); }
    else engine.resetView();
  };

  const selBox = selected && boxes.find((b) => b.key === selected);
  const viewMoved = state.view.zoom !== 1 || state.view.x || state.view.y;

  return (
    <div
      ref={ref}
      className={cn('absolute inset-0 z-10 select-none', arranging ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => !drag.current && setHover(null)}
      onDoubleClick={onDoubleClick}
    >
      {(engine.guides !== 'None' || arranging) && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          {lines.xs.map((x) => <line key={'x' + x} x1={x * size.w} x2={x * size.w} y1={0} y2={size.h} className="stroke-signal" strokeWidth={0.75} strokeDasharray="4 4" />)}
          {lines.ys.map((y) => <line key={'y' + y} y1={y * size.h} y2={y * size.h} x1={0} x2={size.w} className="stroke-signal" strokeWidth={0.75} strokeDasharray="4 4" />)}
          {arranging && boxes.map((b) => (
            <rect key={b.key} x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx={2} fill="none"
              className={hover === b.key || selected === b.key ? 'stroke-signal' : 'stroke-foreground/30'} strokeWidth={1} strokeDasharray={selected === b.key ? '' : '3 3'} />
          ))}
        </svg>
      )}
      {arranging && state.pin.on && (
        <div className="pointer-events-none absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-signal shadow-md"
          style={{ left: state.pin.x * size.w, top: state.pin.y * size.h }} title="Pin">
          <span className="size-1.5 rounded-full bg-white" />
        </div>
      )}
      {arranging && (
        <div className="pointer-events-none absolute inset-x-0 -top-9 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-full bg-foreground px-3 py-1 text-[11px] text-background shadow" onPointerDown={(e) => e.stopPropagation()}
            title="Drag the artwork, text or pin · scroll or pinch to zoom · click a line to style it · double-click to reset">
            <span className="hidden lg:inline">Drag to move · scroll to zoom · click text to style</span>
            <span className="lg:hidden">Drag · scroll · click text</span>
            {viewMoved && <button type="button" className="rounded-full bg-background/20 px-2 py-0.5 hover:bg-background/30" onClick={() => engine.resetView()}>Reset view</button>}
            <button type="button" className="rounded-full bg-background px-2 py-0.5 text-foreground" onClick={() => engine.setArranging(false)}>Done</button>
          </div>
        </div>
      )}
      {arranging && selBox && <LineStylePanel engine={engine} lineKey={selected} box={selBox} size={size} onClose={() => setSelected(null)} />}
    </div>
  );
}
