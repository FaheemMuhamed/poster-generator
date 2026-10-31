// Dev-only capture tool (capture.html). Drives the real poster engine to produce:
//   public/previews/<mode>.mp4 + .jpg   short clips for the sidebar hover cards
//   public/examples/e-<n>.webp           example posters (720 px long side) for Explore
//   public/examples/atlas.webp           all examples packed into one texture
//   public/examples/examples.json        each example's full settings + atlas cell
// Keep this tab visible while it runs: hidden tabs pause animation.
import './fonts.css';
import { GOOGLE_FONTS_CSS } from '../js/shared/fonts.js';
import { createEngine, DEFAULT_STATE } from '../js/engine.js';
import { MODES, loadMode } from '../js/modes/index.js';
import { PALETTES } from '../js/shared/palettes.js';
import { loadFont } from '../js/shared/typeLayer.js';
import { composite, settingsOf } from '../js/shared/export.js';
import { makeRandom } from '../js/shared/random.js';

document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: GOOGLE_FONTS_CSS }));

const $ = (id) => document.getElementById(id);
const log = (m) => { $('log').textContent += m + '\n'; $('log').scrollTop = 1e9; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const viewport = $('viewport');
function setViewport(w, h) { viewport.style.width = w + 'px'; viewport.style.height = h + 'px'; }

const engine = createEngine({
  els: { viewport, stage: $('stage'), scene: $('scene'), typeCanvas: $('type-layer') },
  notify: log,
  embed: true,
});
const sceneCanvas = () => $('scene').querySelector('canvas');

async function upload(dir, name, blob) {
  const r = await fetch(`/__capture?dir=${dir}&name=${name}`, { method: 'POST', body: blob });
  if (!r.ok) throw new Error(`upload failed: ${name}`);
}
const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

// A slow figure-eight "cursor" so previews show the mouse interaction.
function moveCursor(t) {
  const r = $('scene').getBoundingClientRect();
  const x = r.left + r.width * (0.5 + 0.3 * Math.sin(t * 1.3));
  const y = r.top + r.height * (0.5 + 0.22 * Math.sin(t * 2.6));
  $('scene').dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
}

async function settle(settings, ms) {
  engine.load(settings);
  await new Promise((r) => loadFont(engine.state.text, r));
  await sleep(ms);
}

// ---------- Mode preview clips ----------
const PREVIEW_PALETTE = {
  pills: 'Chromatography', collage: 'Lilac Sky', orbit: 'Sunset Bloom', ascii: 'Ink Wash',
  particles: 'Neuro Violet', blob: 'Neon Pulse', ribbons: 'Sunset Bloom', terrain: 'Night Petal',
  aura: 'Sunset Bloom', ink: 'Chromatography', liquidtype: 'Neon Pulse', rd: 'Halftone Ice', voronoi: 'Neuro Violet',
};

async function recordPreviews() {
  setViewport(240, 340);
  // capture.html?only=dither,prism records just those entries.
  const only = new URLSearchParams(location.search).get('only')?.split(',').filter(Boolean);
  for (const m of MODES.filter((x) => !only || only.includes(x.id))) {
    const palette = PREVIEW_PALETTE[m.id] || 'Chromatography';
    await settle({ mode: m.id, seed: 7, palette, colors: PALETTES[palette], ui: { ambient: false },
      text: { ...DEFAULT_STATE.text, layout: '12-field', lines: { title: m.name, subtitle: '', date: '', venue: '', footer: '' } } }, 1500);
    const { w, h } = { w: $('stage').offsetWidth, h: $('stage').offsetHeight };
    const out = document.createElement('canvas');
    composite(out, sceneCanvas(), w, h, 2, engine.state);
    await upload('previews', `${m.id}.jpg`, await toBlob(out, 'image/jpeg', 0.82));

    const rec = new MediaRecorder(out.captureStream(30), { mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 700_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        moveCursor(t);
        composite(out, sceneCanvas(), w, h, 2, engine.state);
        if (t < 3) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/mp4' });
    await upload('previews', `${m.id}.mp4`, blob);
    log(`✓ ${m.id}  ${(blob.size / 1024).toFixed(0)} KB`);
  }
  log('Previews done.');
}

// ---------- Example posters ----------
// Curated rather than random: each effect is shown through its own designed looks,
// in a mix of frame shapes, with a type pairing and a finish chosen to suit it.
const COPY = [
  ['Night Signals', 'Audiovisual live set', '14.02.27', 'Halle 3', 'Doors 21:00'],
  ['Soft Machines', 'Group exhibition', '03.05 → 28.05', 'Kunsthalle Ost', 'Free entry'],
  ['Field Notes', 'A talk on generative form', 'Thu 19:30', 'Room 204', 'Design School'],
  ['Afterglow', 'Album release', '09.09.26', 'The Lantern', 'With guests'],
  ['Open Studio', 'Printmaking weekend', 'Sat–Sun', 'Atelier Nord', '10–18h'],
  ['Parallel', 'Film series', 'Every Friday', 'Cinema Lumen', '35mm'],
  ['Slow Light', 'Photography', '12 → 30 Nov', 'Gallery Mira', 'Opening 6pm'],
  ['Noise Garden', 'Experimental music', '22.04.27', 'Botanic Hall', 'Tickets at the door'],
  ['Type Club', 'Lettering meetup', 'Monthly', 'Studio Kern', 'Bring a pen'],
  ['Wavelength', 'Festival of sound', '06–08 Jul', 'Riverside', '3 days, 40 acts'],
  ['Loose Ends', 'Graduation show', '15.06.27', 'Main Building', 'Class of 2027'],
  ['Common Ground', 'Panel discussion', 'Wed 18:00', 'Library Hall', 'Open to all'],
  ['Prism', 'Light installation', 'Dusk till late', 'Harbour Front', 'Winter edition'],
  ['Hidden Rooms', 'Architecture tour', 'Sundays', 'Old Town', 'Meet at the clock'],
  ['Echo Chamber', 'Club night', '31.12.26', 'Basement', 'Until sunrise'],
  ['Material Matters', 'Craft biennale', '01 → 20 Oct', 'Design Museum', 'Workshops daily'],
  ['Undertow', 'Dance performance', '18.03.27', 'Studio Theatre', '8pm'],
  ['Small Hours', 'Late night radio', 'Fridays 02:00', 'FM 98.4', 'Live from the roof'],
  ['Terra', 'Ceramics fair', '24–26 Apr', 'Old Market', 'Makers welcome'],
  ['Quiet Weather', 'Poetry evening', 'Sun 17:00', 'Reading Room', 'Tea served'],
  ['Signal / Noise', 'Media art symposium', '11.11.26', 'Arts Lab', 'Day pass'],
  ['Bloom', 'Spring market', '05.04.27', 'Garden Court', 'From 9am'],
  ['Long Exposure', 'Night photo walk', 'Full moon', 'North Pier', 'Bring a tripod'],
  ['Grain', 'Analogue film club', 'Tuesdays', 'Darkroom 2', 'Members free'],
];

// Title face, weight, body face, tracking. Pairings, not random draws.
const TYPE = [
  ['Inter Tight', 700, 'Inter', -20], ['Instrument Serif', 400, 'Instrument Sans', -10], ['League Gothic', 400, 'Space Mono', 10],
  ['Fraunces', 600, 'Hanken Grotesk', -20], ['Syne', 800, 'Space Grotesk', -30], ['Unbounded', 600, 'JetBrains Mono', -20],
  ['Newsreader', 400, 'Inter', -10], ['Big Shoulders Display', 800, 'Martian Mono', 0], ['Bricolage Grotesque', 700, 'Bricolage Grotesque', -30],
  ['Gloock', 400, 'Familjen Grotesk', -10], ['Archivo', 800, 'Archivo', -30], ['DM Serif Display', 400, 'Overused Grotesk', -10],
  ['Space Grotesk', 700, 'Space Mono', -30], ['Mattone', 700, 'Inter', 0], ['Darker Grotesque', 800, 'Darker Grotesque', -20],
  ['Young Serif', 400, 'Apfel Grotezk', 0], ['Familjen Grotesk', 700, 'League Mono', -20], ['Bagnard', 400, 'Instrument Sans', 0],
];

// Frame shapes, weighted toward portrait print sizes.
const RATIOS = [
  ...Array(5).fill({ format: 'A-series (portrait)' }), ...Array(4).fill({ format: '4:5 (Instagram)' }),
  ...Array(3).fill({ format: '9:16 (Story)' }), ...Array(3).fill({ format: '1:1 (Square)' }), ...Array(2).fill({ format: '16:9 (Landscape)' }),
  { format: 'Custom', frame: { w: 2, h: 3 } }, { format: 'Custom', frame: { w: 3, h: 4 } }, { format: 'Custom', frame: { w: 3, h: 2 } },
];
const PORTRAIT = ['12-field', '20-field', '32-field', 'Swiss 6-column', 'Stepped', 'Van de Graaf', 'Golden canon', 'Asymmetric',
  'Corners', 'Index strip', 'Big type', 'Vertical title', 'Split', 'Stacked', 'Centered', 'Vertical edge'];
const WIDE = ['8-field', 'Corners', 'Index strip', 'Big type', 'Split', 'Stacked', 'Centered', 'Two-column', '3-column'];

// Finishes. Only one in ten posters is left with the plain default grain.
const FINISH = {
  plain:    { grain: 0.08 },
  film:     { grain: 0.28, vignette: 0.35 },
  soft:     { soft: 0.6, grain: 0.18, vignette: 0.2 },
  glow:     { bloom: 0.9, grain: 0.14 },
  bloomy:   { bloom: 1.5, soft: 0.3, grain: 0.1, vignette: 0.3 },
  halftone: { halftone: true, halftoneSize: 7, grain: 0.06 },
  coarse:   { halftone: true, halftoneSize: 11 },
  dither:   { dither: true, ditherLevels: 3, grain: 0.1 },
  chroma:   { chroma: 1.1, grain: 0.18, vignette: 0.25 },
  glitch:   { rgbShift: 0.7, chroma: 0.5, grain: 0.22 },
  pixel:    { pixelate: 6, grain: 0.1 },
};
const DARK = ['Night Petal'];
const LIGHT_FINISHES = ['film', 'film', 'soft', 'halftone', 'coarse', 'dither', 'chroma', 'glitch', 'pixel', 'glow'];
const DARK_FINISHES = ['glow', 'glow', 'bloomy', 'bloomy', 'chroma', 'film', 'soft', 'glitch'];
// Effects that already are a print screen don't get another one on top.
const SCREENED = new Set(['dither', 'halftone', 'cloudscreen', 'topiary', 'ascii', 'codecolumns']);

const COUNT = 120;

async function makeExample(i, r) {
  const meta = MODES[i % MODES.length];
  const def = await loadMode(meta.id);
  // Rounds 1–3 use the effect's own designed looks; the last round shows its defaults.
  const looks = Object.values(def.presets || {});
  const look = looks[Math.floor(i / MODES.length)] || {};
  const params = { ...look };

  const palette = i % 6 === 0 ? 'Night Petal' : r.pick(Object.keys(PALETTES));
  const dark = DARK.includes(palette);
  let finish = i % 10 === 9 ? 'plain' : r.pick(dark ? DARK_FINISHES : LIGHT_FINISHES);
  if (SCREENED.has(meta.id) && /halftone|coarse|dither|pixel/.test(finish)) finish = dark ? 'glow' : 'film';

  const ratio = r.pick(RATIOS);
  const wide = ratio.format === '16:9 (Landscape)' || ratio.frame?.w > ratio.frame?.h;
  const [title, subtitle, date, venue, footer] = r.pick(COPY);
  const [font, weight, bodyFont, tracking] = r.pick(TYPE);
  const sparse = r() < 0.35; // a quieter poster: title, date and venue only
  return {
    mode: meta.id, seed: r.int(1, 99999), format: ratio.format, ...(ratio.frame && { frame: ratio.frame }),
    palette, colors: { ...PALETTES[palette] },
    ui: { ambient: false },
    fx: { ...DEFAULT_STATE.fx, grain: 0, ...FINISH[finish] },
    text: {
      ...DEFAULT_STATE.text,
      lines: sparse ? { title, subtitle: '', date, venue, footer: '' } : { title, subtitle, date, venue, footer },
      font, weight, bodyFont, bodyWeight: 400, tracking,
      layout: r.pick(wide ? WIDE : PORTRAIT),
      textCase: r() < 0.25 ? 'UPPERCASE' : 'As typed',
      size: r.range(0.9, 1.2),
      background: r() < 0.15 ? r.pick(['Block', 'Pill']) : 'None',
    },
    params: { [meta.id]: params },
    finish,
  };
}

// Atlas cells are square; each poster sits centred in its cell at its own shape.
const CELL = 320, ATLAS_COLS = 12, LONG_SIDE = 720;

async function renderExamples() {
  setViewport(640, 640);
  const r = makeRandom(20261031);
  const rows = Math.ceil(COUNT / ATLAS_COLS);
  const atlas = document.createElement('canvas');
  atlas.width = CELL * ATLAS_COLS; atlas.height = CELL * rows;
  const actx = atlas.getContext('2d');
  const list = [];
  for (let i = 0; i < COUNT; i++) {
    const { finish, ...s } = await makeExample(i, r);
    await settle(s, s.mode === 'rd' ? 2200 : 1400);
    moveCursor(i * 0.7);
    await sleep(120);
    const w = $('stage').offsetWidth, h = $('stage').offsetHeight;
    const big = composite(document.createElement('canvas'), sceneCanvas(), w, h, LONG_SIDE / Math.max(w, h), engine.state);
    await upload('examples', `e-${i}.webp`, await toBlob(big, 'image/webp', 0.86));
    const aspect = w / h;
    const cw = aspect >= 1 ? CELL : CELL * aspect, ch = aspect >= 1 ? CELL / aspect : CELL;
    actx.drawImage(big, (i % ATLAS_COLS) * CELL + (CELL - cw) / 2, Math.floor(i / ATLAS_COLS) * CELL + (CELL - ch) / 2, cw, ch);
    const meta = MODES.find((m) => m.id === s.mode);
    list.push({ id: i, cell: i, aspect: +aspect.toFixed(4), mode: s.mode, name: meta.name, group: meta.group, tags: meta.tags,
      title: s.text.lines.title, palette: s.palette, colors: s.colors, settings: settingsOf(engine.state) });
    log(`✓ ${i + 1}/${COUNT}  ${meta.name} · ${s.format} · ${s.palette} · ${finish}`);
  }
  await upload('examples', 'atlas.webp', await toBlob(atlas, 'image/webp', 0.84));
  const json = { cell: [CELL, CELL], cols: ATLAS_COLS, rows, examples: list };
  await upload('examples', 'examples.json', new Blob([JSON.stringify(json)], { type: 'application/json' }));
  log('Examples done.');
}

// One job at a time: two runs would fight over the same poster.
let busy = false;
const run = (job) => async () => {
  if (busy) return log('Already running. Wait for it to finish.');
  busy = true;
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try { await job(); } catch (e) { log('✗ ' + e.message); }
  busy = false;
  document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
};
$('run-previews').onclick = run(recordPreviews);
$('run-examples').onclick = run(renderExamples);
window.capture = { recordPreviews: run(recordPreviews), renderExamples: run(renderExamples), all: run(async () => { await recordPreviews(); await renderExamples(); }), engine };
