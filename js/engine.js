// The poster engine: holds all settings ("state"), runs the animation loop, swaps poster
// modes, and exposes actions the interface calls. It knows nothing about React; the UI
// subscribes to changes and calls the methods below.
import { MODES, loadMode } from './modes/index.js';
import { PALETTES } from './shared/palettes.js';
import { drawType, drawTextMask, loadFont, typeColors, LINE_KEYS } from './shared/typeLayer.js';
import { DEFAULT_VIEW, clampView, toArt, viewCss, layerStyle, isTextMask, fillsTitle, LAYER_BLENDS, LAYER_MASKS } from './shared/layers.js';
import { FX_DEFAULTS } from './shared/postfx.js';
import {
  EXPORT_SIZES, exportPNG, copyPNG, startRecording, encodeState, decodeState,
  settingsOf, embedCode, downloadStandaloneHTML, BLEND_CSS,
} from './shared/export.js';
import { makeRandom } from './shared/random.js';
import { loadUserFonts, userFonts } from './shared/userFonts.js';
import { fontByName } from './shared/fonts.js';
import { createSource, SAMPLES, DEFAULT_SAMPLE } from './shared/sources.js';
import { encodeShort, decodeShort, isShortHash, exampleFromHash, readValue } from './shared/shortlink.js';

export { MODES, PALETTES, EXPORT_SIZES, SAMPLES };

export const FORMATS = {
  'A-series (portrait)': 1 / Math.SQRT2,
  '4:5 (Instagram)': 0.8,
  '9:16 (Story)': 9 / 16,
  '1:1 (Square)': 1,
  '16:9 (Landscape)': 16 / 9,
  Custom: null, // uses state.frame (width : height)
};

// The poster's width / height.
export function aspectOf(state) {
  if (state.format === 'Custom') {
    const { w, h } = state.frame || {};
    return w > 0 && h > 0 ? Math.min(8, Math.max(1 / 8, w / h)) : 1;
  }
  return FORMATS[state.format] || FORMATS['A-series (portrait)'];
}

export const DEFAULT_STATE = {
  mode: 'pills',
  seed: 2026,
  format: 'A-series (portrait)',
  frame: { w: 3, h: 4 },          // used when format is 'Custom'
  source: { sample: DEFAULT_SAMPLE }, // the picture image effects start from
  palette: 'Chromatography',
  colors: { ...PALETTES['Chromatography'] },
  bloom: { amount: 0.7, count: 3 },
  grain: 0.25,
  fx: { ...FX_DEFAULTS },
  motion: { speed: 1, mouse: 1, paused: false },
  view: { ...DEFAULT_VIEW },        // pan and zoom of the artwork inside the frame
  pin: { on: false, x: 0.5, y: 0.5 }, // holds the effect's hover reaction at a point
  layer2: null,                     // { mode, seed, params, blend, opacity, mask, soft }
  ui: { ambient: true, locks: {} }, // viewer preferences, not part of a poster's link
  text: {
    show: true,
    lines: { title: 'Sleepwalker', subtitle: 'Release Party', date: '03.26.26', venue: 'Plot Gallery', footer: 'Los Angeles · 7–10 PM' },
    // font/weight = title face; bodyFont/bodyWeight = everything else.
    font: 'Inter', weight: 600, bodyFont: 'Inter', bodyWeight: 400,
    size: 1, layout: '12-field', color: 'ink', grid: false,
    tracking: 0, bodyTracking: 0,   // in 1/1000 em
    leading: 1,                     // multiplier on each layout's line spacing
    textCase: 'As typed',           // 'As typed' | 'UPPERCASE' | 'lowercase'
    titleStyle: 'Fill',             // 'Fill' | 'Outline'
    blend: 'Normal',                // 'Normal' | 'Difference' | 'Multiply'
    background: 'None',             // 'None' | 'Block' | 'Pill': a solid shape behind each line
    blockColor: 'ink',              // palette key for that shape
    clear: 0,                       // 0–1: soft background patch behind each line
    offsets: {},                    // line key → { x, y } nudge from the layout, in poster fractions
    styles: {},                     // line key → { size, weight, tracking, color, font } overrides
  },
  params: {},
};

// Upgrades settings saved by older versions (share links, HTML files, examples).
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const t = raw.text;
  if (t && t.font && !t.bodyFont) { t.bodyFont = t.font; t.bodyWeight = 400; }
  return raw;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const d = base[k];
    // Settings can come from a link, so a value must keep the type of its default.
    if (d != null && v != null && typeof d !== typeof v) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' ? merge(d, v) : v;
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

// Settings from a link or a pasted file end up in exported code and embeds, so the
// values that are written there as-is must be what they claim to be.
export function sanitize(state) {
  state.seed = Number.isFinite(state.seed) ? Math.trunc(state.seed) : DEFAULT_STATE.seed;
  if (!MODES.some((m) => m.id === state.mode)) state.mode = DEFAULT_STATE.mode;
  const fallback = PALETTES[state.palette] || DEFAULT_STATE.colors;
  state.colors = Object.fromEntries(Object.keys(DEFAULT_STATE.colors).map((k) => [k, HEX.test(state.colors?.[k]) ? state.colors[k] : fallback[k]]));
  state.view = clampView(state.view);
  const p = state.pin || {};
  state.pin = { on: !!p.on, x: clamp(p.x, 0, 1, 0.5), y: clamp(p.y, 0, 1, 0.5) };
  state.layer2 = sanitizeLayer(state.layer2);
  const t = state.text;
  t.clear = clamp(t.clear, 0, 1, 0);
  t.offsets = Object.fromEntries(LINE_KEYS.filter((k) => t.offsets?.[k]).map((k) => [k, { x: clamp(t.offsets[k].x, -1, 1, 0), y: clamp(t.offsets[k].y, -1, 1, 0) }]));
  t.styles = Object.fromEntries(LINE_KEYS.filter((k) => t.styles?.[k] && typeof t.styles[k] === 'object').map((k) => [k, cleanStyle(t.styles[k])]));
  return state;
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

const COLOR_KEYS = Object.keys(DEFAULT_STATE.colors);
function cleanStyle(st) {
  const out = {};
  if (st.size != null) out.size = clamp(st.size, 0.3, 4, 1);
  if (st.weight != null) out.weight = Math.round(clamp(st.weight, 100, 900, 400));
  if (st.tracking != null) out.tracking = clamp(st.tracking, -200, 800, 0);
  if (COLOR_KEYS.includes(st.color)) out.color = st.color;
  if (typeof st.font === 'string' && st.font.length <= 80) out.font = st.font;
  return out;
}

function sanitizeLayer(L) {
  if (!L || typeof L !== 'object' || !MODES.some((m) => m.id === L.mode)) return null;
  return {
    mode: L.mode,
    seed: Number.isFinite(L.seed) ? Math.trunc(L.seed) : 1,
    params: L.params && typeof L.params === 'object' && !Array.isArray(L.params) ? { ...L.params } : {},
    blend: L.blend in LAYER_BLENDS ? L.blend : 'Normal',
    opacity: clamp(L.opacity, 0, 1, 1),
    mask: LAYER_MASKS.includes(L.mask) ? L.mask : { 'Inside text': 'Inside title', 'Outside text': 'Outside title' }[L.mask] || 'Full',
    soft: clamp(L.soft, 0, 1, 0.3),
  };
}

// Types saved values (which may be text, from a link) by each param's default; drops unknown keys.
function typedParams(def, saved = {}) {
  return Object.fromEntries(Object.entries(def.params || {}).map(([k, p]) =>
    [k, k in saved ? (typeof p.value === 'string' && p.options && !p.options.includes(saved[k]) ? p.value : readValue(saved[k], p.value)) : p.value]));
}

export const isLocal = () =>
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Any link format: short (#terrain/123?…), or the older long base64 one.
function readHash(hash) {
  if (!hash || hash.length < 2) return null;
  if (exampleFromHash(hash) != null) return null;
  if (isShortHash(hash)) { try { return decodeShort(hash, DEFAULT_STATE); } catch { return null; } }
  return decodeState(hash);
}

// `els`: { viewport, stage, scene, typeCanvas }. `notify(msg)` shows a toast. `embed`: poster only.
export function createEngine({ els, notify = () => {}, embed = false }) {
  // Settings come from (in order): the link, a downloaded HTML file's baked-in settings, defaults.
  const state = sanitize(merge(structuredClone(DEFAULT_STATE), migrate(readHash(location.hash) || window.POSTER_STATE)));
  state.textHidden = false;

  // ---------- Change notifications for the UI ----------
  const listeners = new Set();
  let version = 0;
  const emit = () => { version++; listeners.forEach((fn) => fn()); };
  let active = true;
  // An untouched poster opened from Explore keeps its short #example/<id> link.
  let fromExample = null;
  // Short readable links can't hold layers, pins, views or moved text; those use the full format.
  const hasExtras = () => !!(state.layer2 || state.pin.on || state.view.zoom !== 1 || state.view.x || state.view.y || state.text.clear
    || Object.keys(state.text.offsets).length || Object.keys(state.text.styles).length);
  const toHash = () => (fromExample != null ? `example/${fromExample}` : mode && !hasExtras() ? encodeShort(state, mode, DEFAULT_STATE) : encodeState(state));
  const saveUrlNow = () => { if (!embed && active && !preview) history.replaceState(null, '', '#' + toHash()); };
  const saveUrl = debounce(saveUrlNow, 300);
  const changed = () => { fromExample = null; typeDirty = true; emit(); saveUrl(); recordSoon(); };

  // ---------- Undo history ----------
  // Snapshots of the settings, taken once edits settle (so a slider drag is one step).
  const past = [];
  let at = -1;
  const snapshot = () => JSON.stringify(settingsOf({ ...state, ui: undefined }));
  function record() {
    if (preview) return;
    const snap = snapshot();
    if (past[at] === snap) return;
    past.splice(at + 1);
    past.push(snap);
    if (past.length > 100) past.shift();
    at = past.length - 1;
    emit();
  }
  const recordSoon = debounce(record, 400);

  // Hover previews keep a copy of what they changed and put it back afterwards.
  let preview = null;
  function beginPreview() {
    if (!preview) preview = { fx: { ...state.fx }, colors: { ...state.colors }, params: mode ? { ...state.params[mode.id] } : null, modeId: mode?.id };
  }
  function endPreview() {
    if (!preview) return;
    const p = preview;
    preview = null;
    Object.assign(state.fx, p.fx);
    const paletteChanged = Object.keys(p.colors).some((k) => p.colors[k] !== state.colors[k]);
    Object.assign(state.colors, p.colors);
    if (paletteChanged) { typeDirty = true; instance?.onParam?.('palette'); }
    if (p.params && mode?.id === p.modeId) restoreParams(p.params);
    emit();
  }

  // Puts param values back (used by previews); rebuilds once if a structural param changed.
  function restoreParams(values) {
    const cur = state.params[mode.id];
    const changedKeys = Object.keys(values).filter((k) => cur[k] !== values[k]);
    if (!changedKeys.length) return;
    Object.assign(cur, values);
    if (changedKeys.some((k) => mode.params[k]?.rebuild)) rebuildSoon();
    changedKeys.forEach((k) => instance?.onParam?.(k));
  }

  // A random value within a param's range (respecting its step and options).
  function randomValue(def) {
    const r = Math.random();
    if (def.options) return def.options[Math.floor(r * def.options.length)];
    if (typeof def.value === 'boolean') return r > 0.5;
    if (typeof def.value === 'number' && def.min !== undefined) {
      const v = def.min + r * (def.max - def.min);
      return def.step ? Math.round(v / def.step) * def.step : v;
    }
    return def.value;
  }
  const locked = (key) => !!state.ui.locks?.[mode?.id]?.includes(key);

  // ---------- Pointer (shared with modes) ----------
  // x, y are 0..1 across the poster (y down). vx, vy is the movement since last frame.
  const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, down: false, inside: false, justPressed: false, justReleased: false };
  // Effects see the pointer on the artwork, so a panned or zoomed view still lines up.
  let hovering = false;
  const setPointer = (e) => {
    const r = els.stage.getBoundingClientRect();
    const a = toArt(state.view, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    pointer.x = a.x;
    pointer.y = a.y;
  };
  // All listeners are removed together on destroy().
  const life = new AbortController();
  const on = { signal: life.signal };
  let destroyed = false;
  els.scene.addEventListener('pointermove', (e) => { setPointer(e); pointer.inside = hovering = true; }, on);
  els.scene.addEventListener('pointerenter', () => { pointer.inside = hovering = true; }, on);
  els.scene.addEventListener('pointerleave', () => { pointer.inside = hovering = false; pointer.down = false; }, on);
  els.scene.addEventListener('pointerdown', (e) => { setPointer(e); pointer.down = true; pointer.justPressed = true; }, on);
  window.addEventListener('pointerup', () => { if (pointer.down) pointer.justReleased = true; pointer.down = false; }, on);

  // ---------- Stage sizing ----------
  let size = { w: 400, h: 566, dpr: 1 };
  let typeDirty = true;
  function fitStage() {
    const r = els.viewport.getBoundingClientRect();
    const pad = embed ? 0 : r.width < 600 ? 16 : 48;
    const aw = r.width - pad * 2, ah = r.height - pad * 2;
    const aspect = aspectOf(state);
    let w = aw, h = aw / aspect;
    if (h > ah) { h = ah; w = ah * aspect; }
    w = Math.max(80, Math.floor(w)); h = Math.max(80, Math.floor(h));
    size = { w, h, dpr: Math.min(window.devicePixelRatio || 1, 2) };
    els.stage.style.width = w + 'px';
    els.stage.style.height = h + 'px';
    els.typeCanvas.width = w * size.dpr;
    els.typeCanvas.height = h * size.dpr;
    typeDirty = true;
    instance?.resize(w, h, size.dpr);
    layer?.instance?.resize(w, h, size.dpr);
  }
  function applyView() {
    const t = viewCss(state.view);
    els.scene.style.transform = t;
    if (els.scene2) els.scene2.style.transform = t;
  }
  const ro = new ResizeObserver(() => fitStage());
  ro.observe(els.viewport);

  function drawTypeLayer() {
    const c = els.typeCanvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, els.typeCanvas.width, els.typeCanvas.height);
    els.typeCanvas.style.mixBlendMode = BLEND_CSS[state.text.blend] || 'normal';
    if (state.textHidden && !state.text.grid) { textBoxes = []; styleLayer(); return; }
    c.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    // Modes that draw their own text still get the grid guides.
    const text = state.textHidden ? { ...state.text, show: false } : state.text;
    // Not saved in links (see settingsOf); exports read it from here.
    state.darkGround = !!mode?.darkGround?.(state.params[mode.id] || {}, state.colors);
    textBoxes = drawType(c, size.w, size.h, text, typeColors(state), { showGrid: state.text.grid && !embed, skip: fillsTitle(state.layer2) && layer.instance ? 'title' : undefined }) || [];
    styleLayer();
    if (arranging) emit(); // the on-poster outlines follow the text
  }
  let textBoxes = [];
  let arranging = false, guides = 'None';

  // ---------- Image source (for image effects) ----------
  // Uploads and the webcam stay on this device; links only remember the sample.
  const source = createSource(state.source?.sample || DEFAULT_SAMPLE);
  const sourceChanged = () => { instance?.onParam?.('source'); emit(); };

  // ---------- Modes ----------
  let mode = null;      // the mode definition (params, create…)
  let instance = null;  // the running poster

  function makeCtx() {
    const id = mode.id;
    return {
      container: els.scene,
      state,
      pointer,
      source,
      get params() { return state.params[id]; },
      get palette() { return state.colors; },
      rand: makeRandom(state.seed),
      get time() { return time; },
      markTypeDirty: () => { typeDirty = true; },
    };
  }

  function buildInstance() {
    if (instance) { try { instance.dispose(); } catch (e) { console.warn(e); } }
    els.scene.innerHTML = '';
    instance = mode.create(makeCtx());
    instance.resize(size.w, size.h, size.dpr);
    state.textHidden = !!mode.ownsText;
    typeDirty = true;
  }
  const rebuildSoon = debounce(() => { if (!destroyed && mode) buildInstance(); }, 120);

  let switching = null;
  async function setMode(id) {
    const token = (switching = Symbol());
    let def;
    try { def = await loadMode(id); }
    catch (e) {
      console.error(e);
      notify(`Couldn't load "${MODES.find((m) => m.id === id)?.name || id}"`);
      return;
    }
    if (token !== switching || destroyed) return;
    mode = def;
    state.mode = def.id;
    // Saved values may be text (from a short link): type each by its default, drop unknown keys.
    state.params[def.id] = typedParams(def, state.params[def.id]);
    buildInstance();
    // Loading a mode isn't an edit, so an example keeps its short link.
    typeDirty = true; emit(); saveUrl();
    if (at < 0) record(); // the starting point of the undo history
  }

  // ---------- Second layer ----------
  // Another effect on top of the first, with a blend, opacity and a simple mask. It runs in
  // its own element (#scene2) and shares the palette, pointer, time and finish.
  const layer = { def: null, instance: null, token: null, maskUrl: '', maskKey: '' };
  const layerCanvas = () => els.scene2?.querySelector('canvas');
  function disposeLayer() {
    if (layer.instance) { try { layer.instance.dispose(); } catch (e) { console.warn(e); } }
    layer.instance = null;
    layer.def = null;
    typeDirty = true;
    if (els.scene2) els.scene2.innerHTML = '';
  }
  async function syncLayer() {
    const L = state.layer2;
    if (!els.scene2) return;
    if (!L) { layer.token = null; disposeLayer(); styleLayer(); return; }
    if (layer.def?.id === L.mode && layer.instance) { styleLayer(); return; }
    const token = (layer.token = Symbol());
    let def;
    try { def = await loadMode(L.mode); }
    catch (e) { console.error(e); notify("Couldn't load that layer"); return; }
    if (token !== layer.token || destroyed || state.layer2?.mode !== def.id) return;
    disposeLayer();
    layer.def = def;
    L.params = typedParams(def, L.params);
    buildLayer();
  }
  function buildLayer() {
    const L = state.layer2;
    if (!L || !layer.def) return;
    if (layer.instance) { try { layer.instance.dispose(); } catch (e) { console.warn(e); } }
    els.scene2.innerHTML = '';
    try {
      layer.instance = layer.def.create({
        container: els.scene2,
        state,
        pointer,
        source,
        get params() { return state.layer2?.params || {}; },
        get palette() { return state.colors; },
        rand: makeRandom(L.seed),
        get time() { return time; },
        markTypeDirty: () => { typeDirty = true; },
      });
      layer.instance.resize(size.w, size.h, size.dpr);
    } catch (e) {
      console.error(e);
      notify("This device couldn't run both effects at once, so the layer was removed");
      state.layer2 = null;
      disposeLayer();
    }
    applyView();
    styleLayer();
    typeDirty = true;
    emit();
  }
  const rebuildLayerSoon = debounce(() => { if (!destroyed && layer.def) buildLayer(); }, 120);
  // Blend, opacity and mask on the live layer (exports do the same in composite()).
  function styleLayer() {
    const el = els.scene2;
    if (!el) return;
    const L = state.layer2;
    if (L && isTextMask(L.mask)) {
      const key = JSON.stringify([state.text, size.w, size.h]);
      if (key !== layer.maskKey) {
        const m = document.createElement('canvas');
        m.width = size.w; m.height = size.h;
        drawTextMask(m.getContext('2d'), size.w, size.h, state.text);
        layer.maskUrl = m.toDataURL();
        layer.maskKey = key;
      }
    }
    const st = layerStyle(L, layer.maskUrl);
    el.style.mixBlendMode = st.mixBlendMode || '';
    el.style.opacity = st.opacity ?? '';
    el.style.maskImage = el.style.webkitMaskImage = st.maskImage || '';
    el.style.maskSize = el.style.webkitMaskSize = '100% 100%';
    el.style.maskComposite = st.maskComposite || '';
    el.style.webkitMaskComposite = st.maskComposite === 'exclude' ? 'xor' : '';
    el.style.display = L ? '' : 'none';
  }

  // ---------- Ambient glow ----------
  // A tiny copy of the poster that CSS blurs and scales into a glow around it
  // (like a TV's ambient light). Never part of exports.
  let frameCount = 0;
  function drawAmbient() {
    const a = els.ambient;
    if (!a || embed) return;
    a.style.opacity = state.ui.ambient ? '' : '0';
    if (!state.ui.ambient) return;
    const w = 32, h = Math.max(8, Math.round(32 * size.h / size.w));
    if (a.width !== w || a.height !== h) { a.width = w; a.height = h; }
    const c = a.getContext('2d');
    const sc = sceneCanvas();
    try {
      c.fillStyle = state.colors.bg;
      c.fillRect(0, 0, w, h);
      if (sc) c.drawImage(sc, 0, 0, w, h);
      const lc = layer.instance && layerCanvas();
      if (lc) c.drawImage(lc, 0, 0, w, h);
      c.drawImage(els.typeCanvas, 0, 0, w, h);
    } catch { /* canvas not ready yet */ }
  }

  // ---------- Animation loop ----------
  let time = 0, last = performance.now(), recorder = null, raf = 0;
  const sceneCanvas = () => els.scene.querySelector('canvas');
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const step = state.motion.paused ? 0 : dt * state.motion.speed;
    time += step;
    // A pin holds the hover reaction in place while the real cursor is elsewhere.
    if (!hovering) {
      if (state.pin.on) {
        const a = toArt(state.view, state.pin.x, state.pin.y);
        pointer.x = a.x; pointer.y = a.y; pointer.inside = true;
      } else pointer.inside = false;
    }
    pointer.vx = pointer.vx * 0.6 + (pointer.x - pointer.px) * 0.4;
    pointer.vy = pointer.vy * 0.6 + (pointer.y - pointer.py) * 0.4;
    pointer.px = pointer.x; pointer.py = pointer.y;

    source.tick();
    if (instance) {
      try { instance.frame(time, step); }
      catch (e) { console.error(e); notify('This mode hit an error, see console'); instance = null; }
    }
    if (layer.instance) {
      try { layer.instance.frame(time, step); }
      catch (e) { console.error(e); notify('The layer hit an error, so it was removed'); state.layer2 = null; disposeLayer(); styleLayer(); emit(); }
    }
    if (typeDirty) { drawTypeLayer(); typeDirty = false; }
    if (++frameCount % 4 === 0) drawAmbient();
    if (recorder) {
      recorder.tick({ base: sceneCanvas(), layer: layer.instance ? layerCanvas() : null }, size.w, size.h, size.dpr);
      if (!recorder.active) { recorder = null; emit(); }
    }
    pointer.justPressed = pointer.justReleased = false;
    raf = requestAnimationFrame(loop);
  }

  // Puts a saved snapshot back (undo/redo). Same effect and seed: updated in place, so
  // simulations keep running; otherwise it loads like any other poster.
  function applySnapshot(json) {
    endPreview();
    const next = sanitize(merge(structuredClone(DEFAULT_STATE), migrate(JSON.parse(json))));
    if (!mode || next.mode !== state.mode || next.seed !== state.seed) { api.load(next, { record: false }); return; }
    restoreParams(typedParams(mode, next.params[mode.id]));
    for (const [id, v] of Object.entries(next.params)) if (id !== mode.id) state.params[id] = v;
    const paletteChanged = state.palette !== next.palette || Object.keys(next.colors).some((k) => next.colors[k] !== state.colors[k]);
    const layoutChanged = state.format !== next.format || state.frame.w !== next.frame.w || state.frame.h !== next.frame.h;
    const fontChanged = ['font', 'weight', 'bodyFont', 'bodyWeight'].some((k) => state.text[k] !== next.text[k]);
    const oldLayer = state.layer2;
    for (const k of ['palette', 'colors', 'bloom', 'grain', 'fx', 'motion', 'text', 'view', 'pin', 'format', 'frame', 'source', 'layer2']) state[k] = next[k];
    if (paletteChanged) instance?.onParam?.('palette');
    instance?.onParam?.('text');
    if (fontChanged) loadFont(state.text, () => { typeDirty = true; });
    if (layoutChanged) fitStage();
    // The layer: rebuilt only if its effect or seed changed.
    const L = state.layer2;
    if (L && oldLayer && L.mode === oldLayer.mode && layer.def) {
      L.params = typedParams(layer.def, L.params);
      if (L.seed !== oldLayer.seed || Object.keys(L.params).some((k) => layer.def.params[k]?.rebuild && L.params[k] !== oldLayer.params?.[k])) buildLayer();
      else Object.keys(L.params).forEach((k) => layer.instance?.onParam?.(k));
    } else syncLayer();
    applyView();
    styleLayer();
    fromExample = null;
    typeDirty = true;
    emit();
    saveUrl();
  }
  const flushHistory = () => record(); // take any unsaved edit first, so undo returns to the step before it

  // ---------- Public API ----------
  const api = {
    state,
    get mode() { return mode; },
    get recording() { return !!recorder; },
    get layerMode() { return layer.def; },
    // Arrange mode (drag on the poster to place things) and on-screen guides: editor only, never saved.
    get arranging() { return arranging; },
    setArranging(on) { arranging = !!on; emit(); },
    get guides() { return guides; },
    setGuides(g) { guides = g; emit(); },
    get layerInstance() { return layer.instance; },
    get textBoxes() { return textBoxes; },
    get size() { return size; },

    // Undo and redo.
    get canUndo() { return at > 0; },
    get canRedo() { return at < past.length - 1; },
    undo() { flushHistory(); if (at > 0) { at--; applySnapshot(past[at]); } },
    redo() { flushHistory(); if (at < past.length - 1) { at++; applySnapshot(past[at]); } },

    // Pan and zoom the artwork inside the frame.
    setView(v) { state.view = clampView({ ...state.view, ...v }); applyView(); changed(); },
    resetView() { state.view = { ...DEFAULT_VIEW }; applyView(); changed(); },

    // Free text placement and per-line style.
    setTextOffset(key, off) {
      if (!LINE_KEYS.includes(key)) return;
      if (off) state.text.offsets[key] = { x: Math.max(-1, Math.min(1, off.x)), y: Math.max(-1, Math.min(1, off.y)) };
      else delete state.text.offsets[key];
      instance?.onParam?.('text');
      changed();
    },
    resetTextPlacement() { state.text.offsets = {}; instance?.onParam?.('text'); changed(); },
    setTextStyle(key, patch) {
      if (!LINE_KEYS.includes(key)) return;
      if (patch === null) delete state.text.styles[key];
      else {
        const st = cleanStyle({ ...state.text.styles[key], ...patch });
        if (Object.keys(st).length) state.text.styles[key] = st; else delete state.text.styles[key];
      }
      if (patch?.font || patch?.weight) loadFont({ ...state.text, font: patch.font || state.text.font, weight: patch.weight || state.text.weight }, () => { typeDirty = true; });
      instance?.onParam?.('text');
      changed();
    },

    // The pin: holds the hover reaction at a point (poster fractions).
    setPin(patch) {
      const p = { ...state.pin, ...patch };
      state.pin = { on: !!p.on, x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
      changed();
    },

    // The second layer.
    setLayerMode(id) {
      if (!MODES.some((m) => m.id === id)) return;
      const L = state.layer2;
      state.layer2 = { mode: id, seed: Math.floor(Math.random() * 99999), params: {}, blend: L?.blend || 'Screen', opacity: L?.opacity ?? 1, mask: L?.mask || 'Full', soft: L?.soft ?? 0.3 };
      syncLayer();
      changed();
    },
    removeLayer() { state.layer2 = null; syncLayer(); changed(); },
    setLayer(key, v) {
      const L = state.layer2;
      if (!L || !['blend', 'opacity', 'mask', 'soft'].includes(key)) return;
      L[key] = v;
      styleLayer();
      changed(); // also redraws the text: 'Inside title' hides the title the layer now fills
    },
    setLayerParam(key, value) {
      const L = state.layer2;
      if (!L || !layer.def) return;
      L.params[key] = value;
      if (layer.def.params[key]?.rebuild) rebuildLayerSoon();
      layer.instance?.onParam?.(key);
      changed();
    },
    resetLayerParams(keys) {
      const L = state.layer2;
      if (!L || !layer.def) return;
      for (const k of keys || Object.keys(layer.def.params)) { L.params[k] = layer.def.params[k].value; layer.instance?.onParam?.(k); }
      rebuildLayerSoon();
      changed();
    },
    shuffleLayer() { if (state.layer2) { state.layer2.seed = Math.floor(Math.random() * 99999); buildLayer(); changed(); } },
    get instance() { return instance; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getVersion: () => version,

    // Picking a mode yourself is an edit (unlike loading a link or example).
    setMode(id) { fromExample = null; return setMode(id); },
    stepMode(dir) {
      const i = MODES.findIndex((m) => m.id === state.mode);
      fromExample = null;
      setMode(MODES[(i + dir + MODES.length) % MODES.length].id);
    },

    setParam(key, value) {
      if (!mode) return;
      state.params[mode.id][key] = value;
      const def = mode.params[key];
      if (def?.rebuild) rebuildSoon();
      instance?.onParam?.(key);
      changed();
    },
    // Section tools: reset or shuffle just some params; locks protect params from shuffles.
    resetParams(keys) {
      if (!mode) return;
      const defs = mode.params;
      const ks = keys || Object.keys(defs);
      restoreParams(Object.fromEntries(ks.map((k) => [k, defs[k].value])));
      changed();
    },
    randomiseParams(keys) {
      if (!mode) return;
      const defs = mode.params;
      const next = {};
      for (const k of keys) if (!locked(k) && !defs[k].noShuffle && !(typeof defs[k].value === 'string' && !defs[k].options)) next[k] = randomValue(defs[k]);
      restoreParams(next);
      changed();
    },
    isLocked: (key) => locked(key),
    toggleLock(key) {
      if (!mode) return;
      const locks = (state.ui.locks ||= {});
      const list = new Set(locks[mode.id] || []);
      list.has(key) ? list.delete(key) : list.add(key);
      locks[mode.id] = [...list];
      emit();
    },
    // One-click looks for the current effect (mode.presets), with hover previews.
    previewPreset(values) { if (!mode) return; beginPreview(); restoreParams(values); emit(); },
    applyPreset(values) { if (!mode) return; preview = null; restoreParams(values); changed(); },

    setSeed(seed) { state.seed = seed; rebuildSoon(); changed(); },
    randomise() { state.seed = Math.floor(Math.random() * 99999); if (mode) buildInstance(); changed(); },
    surprise() {
      if (!mode) return;
      const r = Math.random;
      const pals = Object.keys(PALETTES);
      state.palette = pals[Math.floor(r() * pals.length)];
      Object.assign(state.colors, PALETTES[state.palette]);
      const values = state.params[mode.id];
      for (const [k, def] of Object.entries(mode.params || {})) {
        if (def.noShuffle || locked(k) || typeof def.value === 'string' && !def.options) continue;
        values[k] = randomValue(def);
      }
      state.seed = Math.floor(r() * 99999);
      buildInstance();
      changed();
    },

    setPalette(name) {
      preview = null; // clicking commits whatever is being previewed
      state.palette = name;
      Object.assign(state.colors, PALETTES[name]);
      typeDirty = true;
      instance?.onParam?.('palette');
      changed();
    },
    // A saved palette: exact colours under its own name.
    setColors(name, colors) {
      preview = null;
      state.palette = String(name).slice(0, 60);
      for (const k of Object.keys(state.colors)) if (HEX.test(colors?.[k])) state.colors[k] = colors[k];
      typeDirty = true;
      instance?.onParam?.('palette');
      changed();
    },
    setColor(key, hex) {
      state.colors[key] = hex;
      typeDirty = true;
      instance?.onParam?.('palette');
      changed();
    },
    setBloom(key, v) { state.bloom[key] = v; changed(); },
    setGrain(v) { state.grain = v; changed(); },
    setFx(key, v) { state.fx[key] = v; changed(); },
    applyFx(values) { preview = null; Object.assign(state.fx, values); changed(); },
    setMotion(key, v) { state.motion[key] = v; changed(); },
    togglePause() { state.motion.paused = !state.motion.paused; changed(); },
    // Sleep while another view (Explore) covers the editor.
    setActive(on) {
      if (on === active || destroyed) return;
      active = on;
      cancelAnimationFrame(raf);
      if (on) { last = performance.now(); raf = requestAnimationFrame(loop); saveUrlNow(); }
    },
    saveUrlNow,
    toHash,

    // Replace all settings (e.g. opening an example from Explore).
    load(settings, { exampleId = null, record: rec = true } = {}) {
      endPreview();
      fromExample = exampleId;
      // Stop the running poster first: its settings are about to be replaced.
      // Clearing `mode` too tells the UI there's nothing to show until the new mode loads.
      if (instance) { try { instance.dispose(); } catch (e) { console.warn(e); } instance = null; }
      mode = null;
      const next = sanitize(merge(structuredClone(DEFAULT_STATE), migrate(structuredClone(settings))));
      for (const k of Object.keys(state)) if (!(k in next)) delete state[k];
      // The ambient-glow switch is the viewer's preference, not part of a poster.
      Object.assign(state, next, { textHidden: false, ui: state.ui });
      loadFont(state.text, () => { typeDirty = true; });
      if (source.kind === 'sample' && state.source?.sample !== source.sample) source.setSample(state.source?.sample || DEFAULT_SAMPLE);
      fitStage();
      applyView();
      disposeLayer();
      syncLayer();
      setMode(state.mode).then(() => { if (rec) recordSoon(); });
    },

    // Load whatever poster a link describes (used by browser Back/Forward).
    loadFromHash(hash) {
      const exampleId = exampleFromHash(hash);
      if (exampleId == null) { const s = readHash(hash); if (s) api.load(s); return; }
      fetch(`${import.meta.env.BASE_URL}examples/examples.json`).then((r) => r.json())
        .then((d) => { const ex = d.examples.find((e) => e.id === exampleId); if (ex && !destroyed) api.load(ex.settings, { exampleId }); })
        .catch(() => notify("Couldn't load that example"));
    },

    // Hover previews: try a look on the live poster without committing it.
    previewFx(values) { beginPreview(); Object.assign(state.fx, values); emit(); },
    previewPalette(name) {
      beginPreview();
      Object.assign(state.colors, PALETTES[name]);
      typeDirty = true;
      instance?.onParam?.('palette');
      emit();
    },
    endPreview,

    toggleAmbient() { state.ui.ambient = !state.ui.ambient; drawAmbient(); changed(); },
    setFormat(f) { state.format = f; fitStage(); changed(); },
    setFrame(w, h) { state.frame = { w, h }; if (state.format === 'Custom') fitStage(); changed(); },

    get source() { return source; },
    setSourceSample(name) { state.source = { sample: name }; source.setSample(name); sourceChanged(); saveUrl(); },
    async setSourceFile(file) {
      try { await source.setFile(file); sourceChanged(); notify(`Using ${source.name}`); }
      catch (e) { notify(e.message || "Couldn't open that image"); }
    },
    async startWebcam() {
      try { await source.startWebcam(); sourceChanged(); }
      catch { notify('The webcam is blocked or unavailable. Check your browser permissions.'); }
    },
    stopWebcam() { source.stopWebcam(); sourceChanged(); },

    setText(key, v) {
      if (key in state.text.lines) state.text.lines[key] = v;
      else state.text[key] = v;
      fromExample = null;
      const redraw = () => { typeDirty = true; instance?.onParam?.('text'); emit(); };
      if (['font', 'weight', 'bodyFont', 'bodyWeight'].includes(key)) loadFont(state.text, redraw);
      redraw();
      saveUrl();
      recordSoon();
    },

    // ---------- Export ----------
    async savePNG(sizeName) {
      if (!instance) return;
      notify('Rendering PNG…');
      await new Promise((r) => setTimeout(r, 30));
      try {
        const out = await exportPNG({ instance, sceneCanvas, size, state, time, longEdge: EXPORT_SIZES[sizeName], layer: layer.instance && { instance: layer.instance, canvas: layerCanvas } });
        notify(`Saved ${out.width} × ${out.height} PNG`);
      } catch (e) { console.error(e); notify('PNG export failed'); }
    },
    async copyImage(sizeName) {
      if (!instance) return;
      try {
        const out = await copyPNG({ instance, sceneCanvas, size, state, time, longEdge: EXPORT_SIZES[sizeName], layer: layer.instance && { instance: layer.instance, canvas: layerCanvas } });
        notify(`Image copied (${out.width} × ${out.height})`);
      } catch (e) { console.error(e); notify('Copy failed, use Save PNG instead'); }
    },
    recordVideo(seconds) {
      if (recorder) return;
      try {
        recorder = startRecording({ seconds, state, onDone: () => notify('Video saved') });
        notify(`Recording ${seconds} seconds… keep interacting!`);
        emit();
      } catch (e) { notify(e.message); }
    },
    async copyLink() {
      history.replaceState(null, '', '#' + toHash());
      await copyText(location.href, 'Share link copied');
    },
    copyEmbed() {
      copyText(embedCode(toHash(), aspectOf(state)),
        isLocal() ? 'Embed code copied. It works on other sites once published' : 'Embed code copied');
    },
    async downloadHTML() {
      try {
        await downloadStandaloneHTML(state);
        notify(isLocal() ? 'HTML saved. It loads from this computer until published' : 'HTML file saved');
      } catch (e) { console.error(e); notify('HTML export failed'); }
    },
    copySettings() { copyText(JSON.stringify(settingsOf(state), null, 2), 'Settings JSON copied'); },
    async pasteSettings() {
      let text;
      try { text = await navigator.clipboard.readText(); }
      catch { text = window.prompt('Paste settings JSON:'); }
      if (!text) return;
      try {
        const loaded = sanitize(merge(structuredClone(DEFAULT_STATE), JSON.parse(text)));
        location.hash = encodeState(loaded);
        location.reload();
      } catch { notify("That doesn't look like settings JSON"); }
    },

    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      life.abort();
      try { instance?.dispose(); } catch (e) { console.warn(e); }
      instance = null;
      disposeLayer();
      source.dispose();
      els.scene.innerHTML = '';
    },
  };

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); notify(msg); }
    catch { window.prompt('Copy this:', text); }
  }

  // ---------- Start ----------
  fitStage();
  applyView();
  loadFont(state.text, () => { typeDirty = true; });
  document.fonts.ready.then(() => { typeDirty = true; });
  // Fonts uploaded on this browser; a link may name one this viewer doesn't have.
  loadUserFonts().then(() => {
    typeDirty = true;
    const t = state.text;
    const missing = [t.font, t.bodyFont, ...Object.values(t.styles).map((st) => st.font)].filter((f) => f && !fontByName(f) && !userFonts.includes(f));
    if (missing.length && !embed) notify(`"${missing[0]}" isn't on this browser, so a default font is shown`);
  });
  setMode(state.mode);
  syncLayer();
  raf = requestAnimationFrame(loop);

  // #example/<id> needs the examples file, so it loads a moment later.
  if (exampleFromHash(location.hash) != null) api.loadFromHash(location.hash);

  // Handy for debugging in the browser console.
  window.poster = api;
  return api;
}
