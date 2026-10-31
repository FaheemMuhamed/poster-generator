// PNG export (any resolution), video recording, and shareable links.
import { drawType } from './typeLayer.js';

export const BLEND_OPS = { Normal: 'source-over', Difference: 'difference', Multiply: 'multiply' };
export const BLEND_CSS = { Normal: 'normal', Difference: 'difference', Multiply: 'multiply' };

export const EXPORT_SIZES = { 'Screen': 0, '2K (2048px)': 2048, '4K (4096px)': 4096, '6K (6144px)': 6144 };

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function stamp(state) {
  return `morva-${state.mode}-${state.seed}`;
}

// Draws the scene canvas + text layer into one 2D canvas.
export function composite(target, sceneCanvas, w, h, dpr, state) {
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
  const c = target.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = state.colors.bg;
  c.fillRect(0, 0, W, H);
  if (sceneCanvas) c.drawImage(sceneCanvas, 0, 0, W, H);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!state.textHidden) {
    // Same blend as the live overlay's CSS mix-blend-mode.
    c.globalCompositeOperation = BLEND_OPS[state.text.blend] || 'source-over';
    drawType(c, w, h, state.text, state.colors);
    c.globalCompositeOperation = 'source-over';
  }
  return target;
}

// Re-renders the current mode at a higher pixel density, grabs it, then restores.
export async function renderPNG({ instance, sceneCanvas, size, state, time, longEdge }) {
  const { w, h, dpr } = size;
  const d = longEdge ? longEdge / Math.max(w, h) : dpr;
  instance.resize(w, h, d);
  instance.frame(time, 0);
  const canvas = composite(document.createElement('canvas'), sceneCanvas(), w, h, d, state);
  instance.resize(w, h, dpr);
  instance.frame(time, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { blob, canvas };
}

export async function exportPNG(opts) {
  const { blob, canvas } = await renderPNG(opts);
  download(blob, `${stamp(opts.state)}-${canvas.width}x${canvas.height}.png`);
  return canvas;
}

// Puts the PNG on the clipboard (paste straight into Figma, Slack, Keynote…).
// The promise is handed to ClipboardItem right away so Safari accepts it.
export async function copyPNG(opts) {
  const pending = renderPNG(opts);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending.then((r) => r.blob) })]);
  return (await pending).canvas;
}

// Settings without runtime-only fields.
export function settingsOf(state) {
  const { textHidden, ...rest } = state;
  return rest;
}

// The address of the site itself (without settings), e.g. https://morva-studio.com/
export function siteUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// `hash` is the poster's link code (engine.toHash()).
export function embedCode(hash, aspect) {
  const src = `${siteUrl()}?embed=1#${hash}`;
  return `<iframe src="${escapeHtml(src)}" title="Morva visual" loading="lazy" style="width:100%;aspect-ratio:${aspect.toFixed(4)};border:0;display:block" allow="fullscreen"></iframe>`;
}

// A single .html file with the current settings baked in. It loads the poster code
// from the published site, so it works anywhere with an internet connection.
export async function downloadStandaloneHTML(state) {
  const base = siteUrl();
  let html = await (await fetch(base + 'index.html', { cache: 'no-store' })).text();
  const settings = JSON.stringify(settingsOf(state)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // Function replacers, so `$&`-style patterns in the poster's text stay literal.
  // The site's CSP is dropped: this file runs from the user's own disk with an inline settings script.
  html = html
    .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace('<head>', () => `<head>\n  <base href="${escapeHtml(base)}" />`)
    .replace('</head>', () => `  <script>window.POSTER_STATE = ${settings}; window.POSTER_EMBED = true;</script>\n</head>`)
    .replace(/<title>.*<\/title>/, () => `<title>${escapeHtml(state.text.lines.title || 'Morva')}</title>`);
  download(new Blob([html], { type: 'text/html' }), `${stamp(state)}.html`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function pickVideoType() {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

// Returns a recorder; call `tick()` every frame (after rendering) and it stops by itself.
export function startRecording({ seconds, state, onDone }) {
  const canvas = document.createElement('canvas');
  const type = pickVideoType();
  if (!type) throw new Error('This browser cannot record video.');
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type }), `${stamp(state)}.${ext}`);
    onDone?.();
  };
  const started = performance.now();
  let primed = false;
  return {
    tick(sceneCanvas, w, h, dpr) {
      composite(canvas, sceneCanvas, w, h, dpr, state);
      if (!primed) { rec.start(); primed = true; }
      if (performance.now() - started > seconds * 1000 && rec.state === 'recording') rec.stop();
    },
    get active() { return rec.state !== 'inactive' || !primed; },
  };
}

// Settings <-> URL hash (base64 JSON), so a link reopens the same poster.
export function encodeState(state) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(settingsOf(state)))));
}

export function decodeState(hash) {
  try { return JSON.parse(decodeURIComponent(escape(atob(hash.replace(/^#/, ''))))); }
  catch { return null; }
}
