// Short, readable share links:  #<mode>/<seed>?<only what differs from the defaults>
//   e.g.  #terrain/82758?t=Afterglow&tf=Bluu+Next&l=8-field&p.height=1.58
// Values are written as plain text and read back using the type of the default,
// so the link stays short and human-readable. Untouched Explore posters use #example/<id>.
import { PALETTES } from './palettes.js';

// setting path → short code (keep codes stable: changing one breaks old links)
const CODES = [
  ['palette', 'pal'], ['format', 'fmt'],
  ['colors.bg', 'bg'], ['colors.ink', 'ink'], ['colors.c1', 'c1'], ['colors.c2', 'c2'], ['colors.c3', 'c3'], ['colors.c4', 'c4'],
  ['bloom.amount', 'ba'], ['bloom.count', 'bc'], ['grain', 'gr'],
  ['motion.speed', 'sp'], ['motion.mouse', 'ms'], ['motion.paused', 'pz'],
  ['text.show', 'tx'],
  ['text.lines.title', 't'], ['text.lines.subtitle', 'st'], ['text.lines.date', 'd'], ['text.lines.venue', 'v'], ['text.lines.footer', 'ft'],
  ['text.font', 'tf'], ['text.weight', 'tw'], ['text.bodyFont', 'bf'], ['text.bodyWeight', 'bw'],
  ['text.size', 'ts'], ['text.layout', 'l'], ['text.color', 'tc'], ['text.grid', 'g'],
  ['text.tracking', 'tt'], ['text.bodyTracking', 'bt'], ['text.leading', 'ld'],
  ['text.textCase', 'case'], ['text.titleStyle', 'sty'], ['text.blend', 'bl'],
  ['frame.w', 'fw'], ['frame.h', 'fh'], ['text.background', 'tb'], ['text.blockColor', 'tbc'], ['source.sample', 'src'],
];
const FX_PREFIX = 'x.';
const PARAM_PREFIX = 'p.';

// Long option values → short ones.
const SHORT_VALUES = {
  format: { 'A-series (portrait)': 'a', '4:5 (Instagram)': '45', '9:16 (Story)': '916', '1:1 (Square)': '1x1', '16:9 (Landscape)': '169', Custom: 'c' },
  palette: Object.fromEntries(Object.keys(PALETTES).map((p) => [p, p.toLowerCase().replace(/\s+/g, '-')])),
  'text.textCase': { 'As typed': 'a', UPPERCASE: 'U', lowercase: 'l' },
};
const LONG_VALUES = Object.fromEntries(Object.entries(SHORT_VALUES).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]))]));

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function set(obj, path, v) {
  const keys = path.split('.');
  if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return;
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = v;
}

// Numbers: 4 significant digits, no leading zero ("0.093" → ".093").
function writeValue(v) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(Number(v.toPrecision(4))).replace(/^(-?)0\./, '$1.');
  if (typeof v === 'string' && v.startsWith('#')) return v.slice(1);
  return String(v);
}

// Reads a text value back using the type of the default it replaces.
export function readValue(raw, like) {
  if (typeof like === 'boolean') return raw === '1' || raw === 'true' || raw === true;
  if (typeof like === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : like; }
  if (typeof like === 'string' && like.startsWith('#')) return /^[0-9a-f]{6}$/i.test(raw) ? '#' + raw : like;
  return String(raw);
}

// state + the current mode definition + defaults → "terrain/82758?t=…"
export function encodeShort(state, modeDef, defaults) {
  const q = new URLSearchParams();
  const preset = PALETTES[state.palette];
  for (const [path, code] of CODES) {
    const v = get(state, path), d = get(defaults, path);
    if (v === undefined) continue;
    // Colours only matter when they differ from the chosen palette.
    if (path.startsWith('colors.')) { if (preset && v === preset[path.slice(7)]) continue; }
    else if (v === d) continue;
    q.append(code, SHORT_VALUES[path]?.[v] ?? writeValue(v));
  }
  for (const [k, v] of Object.entries(state.fx || {})) if (v !== defaults.fx[k]) q.append(FX_PREFIX + k, writeValue(v));
  const params = state.params?.[state.mode] || {};
  for (const [k, def] of Object.entries(modeDef?.params || {})) {
    const v = params[k];
    if (v !== undefined && v !== def.value && !(typeof v === 'number' && Number(v.toPrecision(4)) === def.value)) q.append(PARAM_PREFIX + k, writeValue(v));
  }
  const qs = q.toString();
  return `${encodeURIComponent(state.mode)}/${Math.trunc(Number(state.seed)) || 0}${qs ? '?' + qs : ''}`;
}

export const isShortHash = (hash) => /^#?[a-z0-9-]+\/\d+(\?|$)/i.test(hash);
export const exampleFromHash = (hash) => { const m = /^#?example\/(\d+)$/.exec(hash); return m ? Number(m[1]) : null; };

// "#terrain/82758?…" → partial settings. Mode params stay as text here and are typed
// later by the engine, once it knows that mode's defaults.
export function decodeShort(hash, defaults) {
  const s = hash.replace(/^#/, '');
  const qi = s.indexOf('?');
  const [mode, seed] = (qi < 0 ? s : s.slice(0, qi)).split('/');
  const q = new URLSearchParams(qi < 0 ? '' : s.slice(qi + 1));
  const out = { mode, seed: Number(seed) || 0 };
  const byCode = Object.fromEntries(CODES.map(([p, c]) => [c, p]));
  const palette = q.get('pal');
  const paletteName = palette ? LONG_VALUES.palette[palette] : undefined;
  if (paletteName) { out.palette = paletteName; out.colors = { ...PALETTES[paletteName] }; }
  for (const [code, raw] of q) {
    if (code === 'pal') continue;
    if (code.startsWith(FX_PREFIX)) {
      const k = code.slice(FX_PREFIX.length);
      if (k in defaults.fx) set(out, 'fx.' + k, readValue(raw, defaults.fx[k]));
    } else if (code.startsWith(PARAM_PREFIX)) {
      set(out, `params.${mode}.${code.slice(PARAM_PREFIX.length)}`, raw);
    } else if (byCode[code]) {
      const path = byCode[code];
      const long = LONG_VALUES[path]?.[raw];
      set(out, path, long ?? readValue(raw, get(defaults, path)));
    }
  }
  return out;
}
