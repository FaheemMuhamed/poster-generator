# Adding a mode

Every effect in the library is one file plus one line in the registry. Follow these steps so new modes get search, hover previews, "How it works", essentials and Explore examples automatically.

## 1. Create the file

Put it in the folder for its engine:

| Engine | Folder | Start from |
|---|---|---|
| p5.js (2D canvas) | `js/modes/p5/` | `pills.js` |
| three.js (3D scene) | `js/modes/three/` | `particles.js` |
| Full-screen GLSL shader | `js/modes/shader/` | `aura.js` |

Every mode exports the same shape:

```js
export default {
  id: 'my-mode',            // unique, lowercase
  name: 'My Mode',          // shown in the sidebar
  engine: 'p5' | 'three',   // shader modes use 'three'
  hint: 'Move to …',        // one line under the title
  ownsText: false,          // true if the mode draws the poster text itself
  params: {
    amount: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Amount' },
    shape:  { value: 'Circle', options: ['Circle', 'Square'], label: 'Shape' },
    glow:   { value: true, label: 'Glow' },
    count:  { value: 200, min: 10, max: 2000, step: 10, label: 'Count', rebuild: true }, // rebuild = recreate on change
  },
  create(ctx) {
    // ctx.params (live values), ctx.palette, ctx.pointer {x, y, vx, vy, down, inside, justPressed},
    // ctx.state (all settings), ctx.rand (seeded random)
    return { resize(w, h, dpr) {}, frame(time, dt) {}, dispose() {} };
  },
};
```

Shader modes get every param as a GLSL uniform `p_<name>` for free, plus `uTime`, `uMouse`, `uPal[6]` and `paletteRamp()`. See `js/shared/fullscreenShader.js`.

Effects with a dark ground add `darkGround: (params, colors) => true` (or a check on their own background param). The poster text then swaps ink and background colours, so the default text stays readable.

**Rules that keep the library consistent:**
- Colours always come from the palette (`ctx.palette` / `uPal`), so palettes and hover previews work.
- Scale every mouse effect by `ctx.state.motion.mouse`.
- `frame(time, 0)` must work, because PNG export renders single frames at high resolution.
- Simulations keep a fixed internal resolution, so exports don't reset them.
- Aim for 60 fps on a laptop at about 600 × 850 px.

## 2. Register it

Add one entry to `js/modes/index.js`:

```js
{ id: 'my-mode', category: 'Generative' | 'Type' | 'Image', name: 'My Mode', group: '2D' | '3D' | 'Shader', library: 'p5' | 'three' | 'glsl',
  load: () => import('./p5/my-mode.js'),
  description: 'One plain sentence about what you see.',
  technique: 'The generative technique, e.g. "Poisson-disc sampling + Delaunay mesh"',
  tags: ['particles', 'noise'] },
```

`category` is what it makes and decides its sidebar group. Reuse existing tags where they fit; tags power the sidebar filters and Explore.

## 3. Choose its essentials

In `js/modes/controls.js`, list the 3–4 settings people reach for first, then group the rest:

```js
'my-mode': { essentials: ['amount', 'shape', 'count'], groups: { Detail: ['glow'] } },
```

## 4. Capture previews and examples

With `npm run dev` running, open http://localhost:5173/capture.html and keep the tab visible.

- **Record mode previews** creates `public/previews/<id>.mp4` and `.jpg` for the sidebar hover card.
- **Render examples** regenerates every Explore poster, including some made with your new mode.

Commit the new files in `public/previews/` and `public/examples/` with your mode.

## 5. Add standalone code (Code tab)

Add `code(values, colors, seed)` to the default export. It returns a small runnable page built with a helper from `js/shared/codegen.js`:

- **Single-pass shader** (it uses `createFullscreenShader`): no extra work.
  ```js
  code: (values, colors, seed) => shaderSketch({ id: 'aura', name: 'Aura Gradient', params, values, colors, seed, fragment }),
  ```
- **p5.js:** write a plain global-mode sketch (`setup` / `draw`) as a string. It can read `params`, `colors` and `SEED`. See `js/modes/p5/peaklines.js`.
  ```js
  code: (values, colors, seed) => p5Sketch({ id: 'peaklines', name: 'Peak Lines', values, colors, seed, sketch: SKETCH }),
  ```
- **three.js:** `threeSketch(...)` works the same way, with `THREE` already imported.

Keep the sketch readable: comments that explain the technique, no grain/bloom/text. Test it by pasting it into an empty `.html` file and opening it in a browser.

Entries without `code` show a "View source on GitHub" link instead.

## 6. Check

- The mode loads with no console errors, and its sliders, palettes and Finish looks work.
- The hover card plays the clip.
- `npm run build` passes.
