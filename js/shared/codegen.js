// "Code" tab: turns the current visual into a small, standalone, runnable page.
//
// A mode opts in by adding `code(values, colors, seed)` to its default export, returning
// one of the builders below. Values are inlined, so the copy looks exactly like the
// current settings. Post effects (grain, glow, finish looks) and the type layer are
// left out, so the code shows the technique itself.
import { NOISE, PALETTE_GLSL } from '../shaders/noise.glsl.js';

export const P5_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.1/p5.min.js';
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(Number(v.toPrecision(4))));
const glslValue = (def, v) => {
  if (typeof v === 'boolean') return v ? '1.0' : '0.0';
  if (def.options) return num(Math.max(0, def.options.indexOf(v)));
  return num(v);
};
// JSON that is safe inside a <script> block (no closing tag, no JS line separators).
const safeJSON = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const jsValue = (v) => (typeof v === 'string' ? safeJSON(v) : String(typeof v === 'number' ? Number(v.toPrecision(4)) : v));
const pad = (lines, n) => lines.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

const PAGE_CSS = 'html, body { margin: 0; height: 100%; background: #111; }\ncanvas { display: block; width: 100vw; height: 100vh; }';

function page({ title, css = PAGE_CSS, head = '', body = '', script, module = false }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
${pad(css, 4)}
  </style>${head ? '\n' + pad(head, 2) : ''}
</head>
<body>${body ? '\n' + pad(body, 2) : ''}
  <script${module ? ' type="module"' : ''}>
${pad(script, 4)}
  </script>
</body>
</html>
`;
}

// Result shape shared by every builder.
//   source    the full .html file
//   filename  for downloads
function result({ id, title, html = '', css = PAGE_CSS, head = '', script, external = [], module = false }) {
  const scripts = external.map((src) => `<script src="${src}"></script>`).join('\n');
  return {
    library: module ? 'three.js' : external.some((s) => s.includes('p5')) ? 'p5.js' : 'WebGL',
    filename: `morva-${id}.html`,
    source: page({ title, css, head: [scripts, head].filter(Boolean).join('\n'), body: html, script, module }),
  };
}

// ---------- p5.js (global mode) ----------
// `sketch` is plain p5 code; the current values are injected as a `params` object
// and the palette as `colors`.
export function p5Sketch({ id, name, values, colors, seed, sketch }) {
  const script = `// ${name}: made with Morva. Runs as-is with p5.js ${P5_CDN.match(/\d+\.\d+\.\d+/)[0]}.
const params = {
${Object.entries(values).map(([k, v]) => `  ${k}: ${jsValue(v)},`).join('\n')}
};
const colors = ${safeJSON(colors).replace(/,"/g, ', "').replace(/":/g, '": ')};
const SEED = ${Math.trunc(Number(seed)) || 0};

${sketch.trim()}`;
  return result({ id, title: `${name} · Morva`, script, external: [P5_CDN] });
}

// ---------- GLSL (one full-screen fragment shader, plain WebGL, no library) ----------
// `fragment` is the mode's own shader body (it uses p_<name> params, uPal and the shared noise).
export function shaderSketch({ id, name, params, values, colors, seed, fragment }) {
  const consts = Object.entries(params).map(([k, def]) => `const float p_${k} = ${glslValue(def, values[k])};`).join('\n');
  const frag = `precision highp float;
varying vec2 vUv;
uniform float uTime, uAspect, uDown, uSeed, uMousePow, uInside;
uniform vec2 uRes, uMouse, uMouseVel;

// Settings from Morva. Change these and reload.
${consts}
${PALETTE_GLSL}${NOISE}
// ---- ${name} ----${fragment}`;

  const script = `// ${name}: made with Morva. A single fragment shader, drawn with plain WebGL.
const FRAG = \`${frag.replace(/`/g, '\\`')}\`;

const VERT = \`attribute vec2 pos; varying vec2 vUv;
void main() { vUv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }\`;

// Palette: background, ink, then four colours.
const colors = ${safeJSON(['bg', 'ink', 'c1', 'c2', 'c3', 'c4'].map((k) => colors[k]))};
const SEED = ${Math.trunc(Number(seed)) || 0};

const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl', { antialias: false });

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
gl.useProgram(prog);

// One triangle that covers the whole screen.
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'pos');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

const u = (name) => gl.getUniformLocation(prog, name);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
gl.uniform3fv(u('uPal'), colors.flatMap(rgb));
gl.uniform1f(u('uSeed'), (SEED % 1000) / 1000);
gl.uniform1f(u('uMousePow'), 1);

// Pointer: position (0..1, y up), pressed, and an eased "is the cursor over it".
const mouse = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, down: 0, over: 0, inside: 0 };
canvas.addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth; mouse.y = 1 - e.clientY / innerHeight; mouse.over = 1; });
canvas.addEventListener('pointerleave', () => { mouse.over = 0; });
canvas.addEventListener('pointerdown', () => { mouse.down = 1; });
addEventListener('pointerup', () => { mouse.down = 0; });

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
addEventListener('resize', resize);
resize();

function frame(now) {
  mouse.inside += (mouse.over - mouse.inside) * 0.08;
  gl.uniform1f(u('uTime'), now / 1000);
  gl.uniform1f(u('uAspect'), canvas.width / canvas.height);
  gl.uniform2f(u('uRes'), canvas.width, canvas.height);
  gl.uniform2f(u('uMouse'), mouse.x, mouse.y);
  gl.uniform2f(u('uMouseVel'), mouse.x - mouse.px, mouse.y - mouse.py);
  gl.uniform1f(u('uDown'), mouse.down);
  gl.uniform1f(u('uInside'), mouse.inside);
  mouse.px = mouse.x; mouse.py = mouse.y;
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`;
  return result({ id, title: `${name} · Morva`, html: '<canvas></canvas>', script });
}

// ---------- three.js (ES module via an import map) ----------
export function threeSketch({ id, name, values, colors, seed, sketch }) {
  const head = `<script type="importmap">{ "imports": { "three": "${THREE_CDN}", "three/addons/": "${THREE_CDN.replace('build/three.module.js', 'examples/jsm/')}" } }</script>`;
  const script = `// ${name}: made with Morva. Runs as-is with three.js 0.170.
import * as THREE from 'three';

const params = {
${Object.entries(values).map(([k, v]) => `  ${k}: ${jsValue(v)},`).join('\n')}
};
const colors = ${safeJSON(colors)};
const SEED = ${Math.trunc(Number(seed)) || 0};

${sketch.trim()}`;
  return result({ id, title: `${name} · Morva`, head, script, module: true });
}

