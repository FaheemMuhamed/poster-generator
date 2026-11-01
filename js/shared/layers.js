// Composition helpers shared by the live poster and exports: the artwork's view
// (pan and zoom inside the frame) and the second layer's blend and mask.

// ---------- View: pan and zoom ----------
// zoom ≥ 1, so the artwork always covers the frame. x, y move its centre, in poster fractions.
export const DEFAULT_VIEW = { x: 0, y: 0, zoom: 1 };

export function clampView(v = {}) {
  const zoom = Math.min(4, Math.max(1, Number(v.zoom) || 1));
  const m = (zoom - 1) / 2;
  const clamp = (n) => Math.min(m, Math.max(-m, Number(n) || 0));
  return { x: clamp(v.x), y: clamp(v.y), zoom };
}

// Where the artwork is drawn inside a W × H frame.
export function viewRect(view, W, H) {
  const z = view?.zoom || 1;
  const w = W * z, h = H * z;
  return { x: W * (0.5 + (view?.x || 0)) - w / 2, y: H * (0.5 + (view?.y || 0)) - h / 2, w, h };
}

// A point on the poster (0..1) → the same point on the artwork (0..1), for the pointer.
export function toArt(view, px, py) {
  const z = view?.zoom || 1;
  return { x: (px - 0.5 - (view?.x || 0)) / z + 0.5, y: (py - 0.5 - (view?.y || 0)) / z + 0.5 };
}

export const viewCss = (view) => {
  const v = view || DEFAULT_VIEW;
  return v.zoom === 1 && !v.x && !v.y ? '' : `translate(${v.x * 100}%, ${v.y * 100}%) scale(${v.zoom})`;
};

// ---------- Second layer ----------
export const LAYER_BLENDS = { Normal: 'source-over', Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay', Difference: 'difference' };
const BLEND_CSS = { Normal: 'normal', Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay', Difference: 'difference' };
// 'Inside title' makes the layer the title's fill; 'Outside title' cuts the title out of it.
export const LAYER_MASKS = ['Full', 'Top', 'Bottom', 'Left', 'Right', 'Circle', 'Inside title', 'Outside title'];
export const isTextMask = (mask) => mask === 'Inside title' || mask === 'Outside title';
export const fillsTitle = (layer) => layer?.mask === 'Inside title';

// Gradient stops for a mask's soft edge (percent): fully shown before `a`, hidden after `b`.
function edge(soft, centre = 50, spread = 40) {
  const s = Math.max(0.02, Math.min(1, soft ?? 0.3)) * spread;
  return [centre - s, centre + s];
}
const LINEAR_DIRS = { Top: 'to bottom', Bottom: 'to top', Left: 'to right', Right: 'to left' };

// Live preview: CSS on the layer's element.
export function layerStyle(layer, textMaskUrl) {
  if (!layer) return {};
  const style = { mixBlendMode: BLEND_CSS[layer.blend] || 'normal', opacity: String(layer.opacity ?? 1), maskImage: '', maskComposite: '' };
  const m = layer.mask;
  if (LINEAR_DIRS[m]) {
    const [a, b] = edge(layer.soft);
    style.maskImage = `linear-gradient(${LINEAR_DIRS[m]}, #000 ${a}%, transparent ${b}%)`;
  } else if (m === 'Circle') {
    const [a, b] = edge(layer.soft, 60, 40);
    style.maskImage = `radial-gradient(closest-side, #000 ${a}%, transparent ${b}%)`;
  } else if (isTextMask(m) && textMaskUrl) {
    style.maskImage = m === 'Inside title' ? `url(${textMaskUrl})` : `url(${textMaskUrl}), linear-gradient(#000, #000)`;
    if (m === 'Outside title') style.maskComposite = 'exclude';
  }
  return style;
}

// Exports: cut the layer canvas (W × H, already drawn) to its mask.
export function applyMask(c, W, H, layer, textMask) {
  const m = layer.mask;
  if (!m || m === 'Full') return;
  c.save();
  if (isTextMask(m)) {
    if (!textMask) { c.restore(); return; }
    c.globalCompositeOperation = m === 'Inside title' ? 'destination-in' : 'destination-out';
    c.drawImage(textMask, 0, 0, W, H);
    c.restore();
    return;
  }
  c.globalCompositeOperation = 'destination-in';
  let g;
  if (LINEAR_DIRS[m]) {
    const [a, b] = edge(layer.soft);
    const [x0, y0, x1, y1] = { Top: [0, 0, 0, H], Bottom: [0, H, 0, 0], Left: [0, 0, W, 0], Right: [W, 0, 0, 0] }[m];
    g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(Math.max(0, a / 100), '#000');
    g.addColorStop(Math.min(1, b / 100), 'rgba(0,0,0,0)');
  } else {
    const [a, b] = edge(layer.soft, 60, 40);
    const r = Math.min(W, H) / 2;
    g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
    g.addColorStop(Math.max(0, Math.min(1, a / 100)), '#000');
    g.addColorStop(Math.max(0, Math.min(1, b / 100)), 'rgba(0,0,0,0)');
  }
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.restore();
}

export const layerBlendOp = (layer) => LAYER_BLENDS[layer?.blend] || 'source-over';
