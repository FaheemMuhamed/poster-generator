import { ALargeSmall, CaseLower, CaseSensitive, CaseUpper, ChevronRight, Dices, Layers, Move, MoveHorizontal, MoveVertical, Pipette, Plus, RotateCcw, Save, Trash2, Type, TypeOutline, X } from 'lucide-react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PALETTES, MODES } from '../../js/engine.js';
import { controlPlan, controlSections } from '../../js/modes/controls.js';
import { fontByName } from '../../js/shared/fonts.js';
import FontPicker from './FontPicker.jsx';
import { useEngine } from '../useEngine.js';
import { NumberField, ParamField, Section, SelectField, SliderField, SwitchField, TextField } from './Field.jsx';
import LayoutPicker from './LayoutPicker.jsx';
import { CodeButton } from './CodeTab.jsx';
import SourcePicker from './SourcePicker.jsx';
import { cn } from '@/lib/utils';
import { LAYER_BLENDS, LAYER_MASKS, isTextMask } from '../../js/shared/layers.js';

const LINE_KEYS_ALL = ['title', 'subtitle', 'date', 'venue', 'footer'];
const COLOR_KEYS = [['bg', 'Background'], ['ink', 'Ink'], ['c1', 'Accent 1'], ['c2', 'Accent 2'], ['c3', 'Accent 3'], ['c4', 'Accent 4']];

// One-click looks for 3D + shader modes. Each preset sets every effect.
const FX_ZERO = { bloom: 0, soft: 0, halftone: false, halftoneSize: 7, dither: false, ditherLevels: 3, threshold: false, grain: 0, chroma: 0, rgbShift: 0, pixelate: 0, vignette: 0 };
const FX_PRESETS = {
  'Clean':      { grain: 0.12 },
  'Soft print': { soft: 0.5, grain: 0.22, vignette: 0.3 },
  'Dreamy':     { bloom: 1, soft: 0.6, grain: 0.15 },
  'Halftone':   { halftone: true, halftoneSize: 7, grain: 0.08 },
  'Riso':       { dither: true, ditherLevels: 3, grain: 0.25, chroma: 0.6 },
  '2-colour':   { threshold: true, dither: true },
  'Glitch':     { rgbShift: 1.5, chroma: 1.2, grain: 0.2 },
  'Pixel':      { pixelate: 10, dither: true, ditherLevels: 4 },
};
const presetValues = (name) => ({ ...FX_ZERO, ...FX_PRESETS[name] });
const matchPreset = (fx) => Object.keys(FX_PRESETS).find((n) => Object.entries(presetValues(n)).every(([k, v]) => fx[k] === v));

// The effect's own params for a list of keys, each with reset and lock.
function ParamList({ engine, keys }) {
  const { state, mode } = engine;
  const values = state.params[mode.id] || {};
  return keys.map((k) => (
    <ParamField
      key={k} def={mode.params[k]} value={values[k]}
      onChange={(v) => engine.setParam(k, v)}
      onReset={() => engine.resetParams([k])}
      locked={engine.isLocked(k)} onLock={() => engine.toggleLock(k)}
    />
  ));
}

// Small section tools: shuffle just this section, and reset it when something changed.
function SectionTools({ engine, keys }) {
  const { state, mode } = engine;
  const values = state.params[mode.id] || {};
  const changed = keys.some((k) => values[k] !== mode.params[k].value);
  return (
    <>
      {changed && (
        <button type="button" onClick={() => engine.resetParams(keys)} title="Reset this section" aria-label="Reset this section"
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <RotateCcw className="size-3.5" />
        </button>
      )}
      <button type="button" onClick={() => engine.randomiseParams(keys)} title="Shuffle this section (locked controls stay)" aria-label="Shuffle this section"
        className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <Dices className="size-3.5" />
      </button>
    </>
  );
}

// One-click looks for the effect; hovering previews them on the visual.
function Looks({ engine }) {
  const { mode, state } = engine;
  const presets = Object.entries(mode.presets || {});
  if (!presets.length) return null;
  const values = state.params[mode.id] || {};
  const active = presets.find(([, v]) => Object.entries(v).every(([k, x]) => values[k] === x))?.[0];
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
      {presets.map(([name, v]) => (
        <button key={name} type="button"
          onClick={() => engine.applyPreset(v)}
          onMouseEnter={() => engine.previewPreset(v)} onMouseLeave={() => engine.endPreview()}
          className={cn('rounded-full px-2.5 py-1 text-[11px] ring-1 transition-colors',
            active === name ? 'bg-foreground text-background ring-foreground' : 'text-muted-foreground ring-border hover:text-foreground')}>
          {name}
        </button>
      ))}
    </div>
  );
}

function ShapeTab({ engine }) {
  const { state, mode } = engine;
  const plan = controlPlan(mode);
  const sections = controlSections(mode).filter((s) => s.keys.length || s.id === 'motion' || s.id === 'interaction');
  const how = mode.interactions;
  return (
    <>
      {mode.medium === 'image' && <SourcePicker engine={engine} extra={plan.image.length ? <ParamList engine={engine} keys={plan.image} /> : null} />}
      <Looks engine={engine} />
      {sections.map((s) => (
        <Section key={s.id} title={s.title} collapsible={!s.essential} defaultOpen={s.essential}
          aside={s.keys.length ? <SectionTools engine={engine} keys={s.keys} /> : null}>
          {s.id === 'interaction' && how && (
            <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {how.hover && <><b className="font-medium text-foreground">Hover</b> {how.hover}. </>}
              {how.click && <><b className="font-medium text-foreground">Click</b> {how.click}.</>}
            </p>
          )}
          <ParamList engine={engine} keys={s.keys} />
          {s.id === 'motion' && <SliderField label="Overall speed" value={state.motion.speed} min={0} max={3} step={0.01} unit="×" def={{ value: 1 }} onReset={() => engine.setMotion('speed', 1)} onChange={(v) => engine.setMotion('speed', v)} />}
          {s.id === 'interaction' && <SliderField label="Mouse strength" value={state.motion.mouse} min={0} max={3} step={0.01} unit="×" def={{ value: 1 }} onReset={() => engine.setMotion('mouse', 1)} onChange={(v) => engine.setMotion('mouse', v)} />}
          {s.id === 'interaction' && <PinControl engine={engine} />}
        </Section>
      ))}
      <LayerSection engine={engine} />
      <Section title="Variation" defaultOpen>
        <div className="flex items-center gap-2">
          <Input type="number" value={state.seed} min={0} max={99999} onChange={(e) => engine.setSeed(Number(e.target.value) || 0)} className="h-8 font-mono text-[12px]" aria-label="Variation number" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => engine.randomise()}><Dices className="size-3.5" /> New</Button>
        </div>
        <Button variant="ghost" size="sm" className="mt-2 h-8 w-full gap-1.5 text-[12px] text-muted-foreground" onClick={() => engine.resetParams()}>
          <RotateCcw className="size-3.5" /> Reset {mode.name}
        </Button>
      </Section>
    </>
  );
}

// The pin holds the effect's hover reaction at one point, so it shows up in the poster.
function PinControl({ engine }) {
  const { pin } = engine.state;
  return (
    <div className="mt-1 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px]">Pin the hover</span>
        <Switch checked={pin.on} aria-label="Pin the hover" onCheckedChange={(on) => { engine.setPin({ on }); if (on) engine.setArranging(true); }} />
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {pin.on ? 'Drag the pin on the poster (Arrange) to place the effect’s reaction.' : 'Keeps the effect reacting at a point you choose, even in exports.'}
      </p>
    </div>
  );
}

// A second effect on top, with blend, opacity and a simple mask.
function LayerSection({ engine }) {
  const { state } = engine;
  const L = state.layer2;
  const def = engine.layerMode;
  const pick = (
    <Select value={L?.mode || ''} onValueChange={(id) => engine.setLayerMode(id)}>
      <SelectTrigger size="sm" className="h-8 w-full text-[12px]"><SelectValue placeholder="Add an effect on top…" /></SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {MODES.map((m) => <SelectItem key={m.id} value={m.id} className="text-[12px]">{m.name} <span className="text-muted-foreground">· {m.category}</span></SelectItem>)}
      </SelectContent>
    </Select>
  );
  return (
    <Section title="Layer" defaultOpen={!!L} aside={L && (
      <button type="button" onClick={() => engine.removeLayer()} title="Remove the layer" aria-label="Remove the layer"
        className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="size-3.5" /></button>
    )}>
      {!L && <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">Stack a second effect over this one, then blend and mask it.</p>}
      {pick}
      {L && (
        <div className="mt-2">
          <SelectField label="Blend" value={L.blend} options={Object.keys(LAYER_BLENDS)} onChange={(v) => engine.setLayer('blend', v)} />
          <SliderField label="Opacity" value={L.opacity} min={0} max={1} step={0.01} onChange={(v) => engine.setLayer('opacity', v)} />
          <SelectField label="Show it" value={L.mask} options={LAYER_MASKS.map((m) => ({ value: m, label: m === 'Full' ? 'Everywhere' : m }))} onChange={(v) => engine.setLayer('mask', v)} />
          {L.mask !== 'Full' && !isTextMask(L.mask) && <SliderField label="Edge softness" value={L.soft} min={0} max={1} step={0.01} onChange={(v) => engine.setLayer('soft', v)} />}
          {def && (
            <details className="group mt-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[12px] text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> {def.name} settings
                <button type="button" onClick={(e) => { e.preventDefault(); engine.shuffleLayer(); }} title="New variation of the layer" aria-label="New variation of the layer"
                  className="ml-auto grid size-6 place-items-center rounded-md hover:bg-muted"><Dices className="size-3.5" /></button>
              </summary>
              {Object.keys(def.params || {}).map((k) => (
                <ParamField key={k} def={def.params[k]} value={L.params[k]} onChange={(v) => engine.setLayerParam(k, v)} onReset={() => engine.resetLayerParams([k])} />
              ))}
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

// Palettes people save themselves, kept on this browser.
const MY_PALETTES = 'morva-palettes';
const readPalettes = () => { try { return JSON.parse(localStorage.getItem(MY_PALETTES)) || []; } catch { return []; } };
const writePalettes = (list) => { try { localStorage.setItem(MY_PALETTES, JSON.stringify(list)); } catch {} };

// One colour: swatch (system picker), exact hex, and an eyedropper where the browser has one.
function ColourRow({ engine, k, label }) {
  const value = engine.state.colors[k];
  const [draft, setDraft] = useState(null);
  const commit = () => {
    const v = (draft ?? '').trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) engine.setColor(k, v.toLowerCase());
    else if (/^#[0-9a-f]{3}$/i.test(v)) engine.setColor(k, ('#' + [...v.slice(1)].map((c) => c + c).join('')).toLowerCase());
    setDraft(null);
  };
  const pickFromScreen = async () => {
    try { const r = await new window.EyeDropper().open(); engine.setColor(k, r.sRGBHex.toLowerCase()); } catch { /* cancelled */ }
  };
  return (
    <div className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/50">
      <label className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-foreground/10" style={{ background: value }} title={`Pick ${label}`}>
        <input type="color" value={value} onChange={(e) => engine.setColor(k, e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label} colour`} />
      </label>
      <span className="flex-1 text-[12px] text-muted-foreground">{label}</span>
      <input
        value={draft ?? value.toUpperCase()} spellCheck={false} aria-label={`${label} hex`}
        onFocus={(e) => { setDraft(value.toUpperCase()); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
        className="h-6 w-[74px] rounded-[3px] bg-transparent px-1 text-right font-mono text-[11px] uppercase text-muted-foreground outline-none hover:bg-muted focus:bg-muted focus:text-foreground"
      />
      {'EyeDropper' in window && (
        <button type="button" onClick={pickFromScreen} title="Pick a colour from the screen" aria-label={`Pick ${label} from the screen`}
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Pipette className="size-3.5" /></button>
      )}
    </div>
  );
}

function ColourTab({ engine }) {
  const { state, mode } = engine;
  const effectKeys = controlPlan(mode).colour;
  const [mine, setMine] = useState(readPalettes);
  const savePalette = () => {
    const name = `My palette ${mine.length + 1}`;
    const next = [...mine, { name, colors: { ...state.colors } }];
    setMine(next); writePalettes(next);
    engine.setColors(name, state.colors);
  };
  const deletePalette = (i) => { const next = mine.filter((_, j) => j !== i); setMine(next); writePalettes(next); };
  return (
    <>
      <Section title="Palette" collapsible={false} aside={
        <button type="button" onClick={savePalette} title="Save these colours as a palette" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
          <Save className="size-3.5" /> Save
        </button>
      }>
        {mine.length > 0 && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            {mine.map((p, i) => (
              <div key={i} className={cn('group relative overflow-hidden rounded-md border text-left transition', state.palette === p.name ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40')}>
                <button type="button" className="block w-full text-left" onClick={() => engine.setColors(p.name, p.colors)}>
                  <div className="flex h-7">{['bg', 'c1', 'c2', 'c3', 'c4', 'ink'].map((k) => <div key={k} className="flex-1" style={{ background: p.colors[k] }} />)}</div>
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">{p.name}</div>
                </button>
                <button type="button" onClick={() => deletePalette(i)} aria-label={`Delete ${p.name}`} title="Delete"
                  className="absolute right-1 bottom-1 grid size-5 place-items-center rounded bg-background/80 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"><X className="size-3" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PALETTES).map(([name, p]) => (
            <button
              key={name}
              onClick={() => engine.setPalette(name)}
              onMouseEnter={() => engine.previewPalette(name)}
              onMouseLeave={() => engine.endPreview()}
              className={cn('overflow-hidden rounded-md border text-left transition', state.palette === name ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40')}
            >
              <div className="flex h-7">{[p.bg, p.c1, p.c2, p.c3, p.c4, p.ink].map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}</div>
              <div className="px-2 py-1 text-[11px] text-muted-foreground">{name}</div>
            </button>
          ))}
        </div>
      </Section>
      {effectKeys.length > 0 && (
        <Section title="Effect colours" defaultOpen aside={<SectionTools engine={engine} keys={effectKeys} />}>
          <ParamList engine={engine} keys={effectKeys} />
        </Section>
      )}
      <Section title="Exact colours" defaultOpen>
        <div className="space-y-0.5">
          {COLOR_KEYS.map(([k, label]) => <ColourRow key={k} engine={engine} k={k} label={label} />)}
        </div>
      </Section>
    </>
  );
}

// Palette swatches as a single-choice row (text colour, background colour).
function Swatches({ state, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {COLOR_KEYS.map(([k, name]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} title={name} aria-label={name} onClick={() => onChange(k)}
          className={cn('size-5 rounded-full ring-1 ring-foreground/10', value === k && 'ring-2 ring-foreground ring-offset-2 ring-offset-background')}
          style={{ background: state.colors[k] }} />
      ))}
    </div>
  );
}

// Icon toggles in a row, like the case/alignment buttons of a text editor.
function IconToggles({ value, options, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-muted/70 p-0.5">
      {options.map(([v, Icon, name]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} title={name} aria-label={name} onClick={() => onChange(v)}
          className={cn('grid h-7 flex-1 place-items-center rounded-[3px] transition-colors', value === v ? 'bg-card text-foreground shadow-sm dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}>
          {typeof Icon === 'string' ? <span className="text-[11px]">{Icon}</span> : <Icon className="size-3.5" />}
        </button>
      ))}
    </div>
  );
}

// The Type tab follows a standard text panel: words, typeface, typesetting, fill, then layout.
function TypeTab({ engine }) {
  const { state, mode } = engine;
  const t = state.text;
  const owns = mode?.ownsText;
  const effectKeys = controlPlan(mode).type;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const perMille = (v) => `${(v / 10).toFixed(1)}%`; // tracking is stored in 1/1000 em
  return (
    <>
      <Section title="Words" collapsible={false} aside={<Switch checked={t.show} onCheckedChange={(v) => engine.setText('show', v)} aria-label="Show text" />}>
        {owns && <p className="mb-2 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">This effect sets the words inside the artwork itself.</p>}
        <Input value={t.lines.title} onChange={(e) => engine.setText('title', e.target.value)} placeholder="Title" aria-label="Title" className="mb-1.5 h-9 text-[14px] font-medium" />
        <TextField value={t.lines.subtitle} placeholder="Subtitle" onChange={(v) => engine.setText('subtitle', v)} />
        <div className="grid grid-cols-2 gap-2">
          <TextField value={t.lines.date} placeholder="Date" onChange={(v) => engine.setText('date', v)} />
          <TextField value={t.lines.venue} placeholder="Venue" onChange={(v) => engine.setText('venue', v)} />
        </div>
        <TextField value={t.lines.footer} placeholder="Footer" onChange={(v) => engine.setText('footer', v)} />
      </Section>

      <Section title="Typeface" defaultOpen>
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Title</p>
          <FontPicker value={t.font} onChange={(v) => engine.setText('font', v)} />
          <div className="grid grid-cols-2 gap-1.5">
            <WeightPicker font={t.font} value={t.weight} onChange={(v) => engine.setText('weight', v)} compact />
            <NumberField icon={ALargeSmall} label="Size" value={t.size} min={0.4} max={2.5} step={0.05} format={pct} parse={(s) => parseFloat(s) / 100} onChange={(v) => engine.setText('size', v)} />
            <NumberField icon={MoveHorizontal} label="Title letter spacing" value={t.tracking} min={-100} max={300} step={5} format={perMille} parse={(s) => parseFloat(s) * 10} onChange={(v) => engine.setText('tracking', v)} />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Text</p>
          <FontPicker value={t.bodyFont} onChange={(v) => engine.setText('bodyFont', v)} />
          <div className="grid grid-cols-2 gap-1.5">
            <WeightPicker font={t.bodyFont} value={t.bodyWeight} onChange={(v) => engine.setText('bodyWeight', v)} compact />
            <NumberField icon={MoveHorizontal} label="Text letter spacing" value={t.bodyTracking} min={-50} max={300} step={5} format={perMille} parse={(s) => parseFloat(s) * 10} onChange={(v) => engine.setText('bodyTracking', v)} />
          </div>
        </div>
      </Section>

      <Section title="Typesetting" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField icon={MoveVertical} label="Line height" value={t.leading} min={0.7} max={1.8} step={0.05} format={pct} parse={(s) => parseFloat(s) / 100} onChange={(v) => engine.setText('leading', v)} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <IconToggles label="Case" value={t.textCase} onChange={(v) => engine.setText('textCase', v)}
            options={[['As typed', CaseSensitive, 'As typed'], ['UPPERCASE', CaseUpper, 'Uppercase'], ['lowercase', CaseLower, 'Lowercase']]} />
          <IconToggles label="Title style" value={t.titleStyle} onChange={(v) => engine.setText('titleStyle', v)}
            options={[['Fill', Type, 'Filled title'], ['Outline', TypeOutline, 'Outlined title']]} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground">Colour</span>
          <Swatches state={state} label="Text colour" value={t.color} onChange={(k) => engine.setText('color', k)} />
        </div>
        <div className="mt-2">
          <Segmented label="Blend" value={t.blend} options={[['Normal', 'Normal'], ['Difference', 'Difference'], ['Multiply', 'Multiply']]} onChange={(v) => engine.setText('blend', v)} />
        </div>
      </Section>

      <Section title="Text background" defaultOpen>
        <IconToggles label="Text background" value={t.background || 'None'} onChange={(v) => engine.setText('background', v)}
          options={[['None', 'None', 'No background'], ['Block', 'Block', 'Block behind each line'], ['Pill', 'Pill', 'Pill behind each line']]} />
        {t.background && t.background !== 'None' && (
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Colour</span>
            <Swatches state={state} label="Background colour" value={t.blockColor || 'ink'} onChange={(k) => engine.setText('blockColor', k)} />
          </div>
        )}
      </Section>

      <Section title="Placement" defaultOpen>
        <SliderField label="Clear behind text" value={t.clear} min={0} max={1} step={0.01} def={{ value: 0 }} onReset={() => engine.setText('clear', 0)} onChange={(v) => engine.setText('clear', v)} />
        <p className="-mt-0.5 mb-2 text-[11px] leading-relaxed text-muted-foreground">Softens the artwork behind each line so the words read.</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-8 flex-1 gap-1.5 text-[12px]" onClick={() => engine.setArranging(true)}><Move className="size-3.5" /> Move text</Button>
          {(Object.keys(t.offsets).length > 0 || Object.keys(t.styles).length > 0) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px] text-muted-foreground" onClick={() => { engine.resetTextPlacement(); LINE_KEYS_ALL.forEach((k) => engine.setTextStyle(k, null)); }}><RotateCcw className="size-3.5" /> Reset</Button>
          )}
        </div>
      </Section>

      <Section title="Layout" defaultOpen aside={
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          Grid <Switch checked={t.grid} onCheckedChange={(v) => engine.setText('grid', v)} className="scale-75" aria-label="Show grid" />
        </label>
      }>
        <LayoutPicker state={state} onPick={(l) => engine.setText('layout', l)} />
      </Section>

      {effectKeys.length > 0 && (
        <Section title="Effect text" defaultOpen aside={<SectionTools engine={engine} keys={effectKeys} />}>
          <ParamList engine={engine} keys={effectKeys} />
        </Section>
      )}
    </>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <ToggleGroup type="single" variant="outline" size="sm" value={String(value)} onValueChange={(v) => v && onChange(v)}>
        {options.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="px-2.5 text-[11px]">{l}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  );
}

// Only offers the weights the chosen font really has.
function WeightPicker({ font, value, onChange, compact }) {
  const weights = fontByName(font)?.weights || [400, 700];
  if (weights.length < 2) return compact ? <div className="flex h-8 items-center rounded-md bg-muted/40 px-2 text-[12px] text-muted-foreground">Regular</div> : null;
  const names = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const nearest = weights.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
  const options = weights.map((w) => ({ value: w, label: names[w] || w }));
  if (!compact) return <SelectField label="Weight" value={nearest} options={options} onChange={onChange} />;
  return (
    <Select value={String(nearest)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" aria-label="Weight" className="h-8 w-full min-w-0 border-none bg-muted/70 text-[12px] shadow-none"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={String(o.value)} className="text-[12px]">{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function FinishTab({ engine }) {
  const { state, mode } = engine;
  if (mode.engine !== 'three') {
    return (
      <>
        <Section title="Background" collapsible={false}>
          <SliderField label="Gradient bloom" value={state.bloom.amount} min={0} max={1} step={0.01} onChange={(v) => engine.setBloom('amount', v)} />
          <SliderField label="Bloom blobs" value={state.bloom.count} min={1} max={6} step={1} onChange={(v) => engine.setBloom('count', v)} />
        </Section>
        <Section title="Texture" collapsible={false}>
          <SliderField label="Film grain" value={state.grain} min={0} max={1} step={0.01} onChange={(v) => engine.setGrain(v)} />
        </Section>
        <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground/70">Halftone, dither, glow and other print effects are available in the 3D and Shader modes.</p>
      </>
    );
  }
  const fx = state.fx;
  const active = matchPreset(fx);
  const set = (k) => (v) => engine.setFx(k, v);
  return (
    <>
      <Section title="Look" collapsible={false}>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.keys(FX_PRESETS).map((name) => (
            <Button key={name} variant={active === name ? 'default' : 'outline'} size="sm" className="h-8 justify-start text-[12px] font-normal"
              onClick={() => engine.applyFx(presetValues(name))}
              onMouseEnter={() => engine.previewFx(presetValues(name))}
              onMouseLeave={() => engine.endPreview()}>{name}</Button>
          ))}
        </div>
        {!active && <p className="mt-2 text-[11px] text-muted-foreground/70">Custom mix</p>}
      </Section>
      <Section title="Light">
        <SliderField label="Glow" value={fx.bloom} min={0} max={3} step={0.01} onChange={set('bloom')} />
        <SliderField label="Soft focus" value={fx.soft} min={0} max={2} step={0.01} onChange={set('soft')} />
        <SliderField label="Vignette" value={fx.vignette} min={0} max={1} step={0.01} onChange={set('vignette')} />
      </Section>
      <Section title="Print">
        <SwitchField label="Halftone" value={fx.halftone} onChange={set('halftone')} />
        {fx.halftone && <SliderField label="Dot size" value={fx.halftoneSize} min={3} max={30} step={1} onChange={set('halftoneSize')} />}
        <SwitchField label="Dither" value={fx.dither} onChange={set('dither')} />
        {fx.dither && <SliderField label="Levels" value={fx.ditherLevels} min={2} max={8} step={1} onChange={set('ditherLevels')} />}
        <SwitchField label="2-colour" value={fx.threshold} onChange={set('threshold')} />
        <SliderField label="Film grain" value={fx.grain} min={0} max={1} step={0.01} onChange={set('grain')} />
      </Section>
      <Section title="Distort">
        <SliderField label="Chromatic edge" value={fx.chroma} min={0} max={3} step={0.01} onChange={set('chroma')} />
        <SliderField label="Glitch" value={fx.rgbShift} min={0} max={3} step={0.01} onChange={set('rgbShift')} />
        <SliderField label="Pixelate" value={fx.pixelate} min={0} max={40} step={1} onChange={set('pixelate')} />
      </Section>
    </>
  );
}

export default function Inspector() {
  const engine = useEngine();
  const mode = engine.mode;
  if (!mode) return <aside className="w-[300px] shrink-0 border-l border-border bg-background" />;
  const meta = MODES.find((m) => m.id === mode.id);
  return (
    <aside className="flex h-[45vh] w-full shrink-0 flex-col border-t border-border bg-background md:h-auto md:w-[300px] md:border-l md:border-t-0">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[17px] leading-tight font-semibold tracking-tight">{mode.name}</h2>
          <CodeButton engine={engine} />
        </div>
        {mode.hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{mode.hint}</p>}
        {meta && (
          <details className="group mt-2 text-[12px]">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> How it works
            </summary>
            <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-2.5 leading-snug">
              <p className="text-foreground">{meta.description}</p>
              <p className="text-muted-foreground">{meta.technique}</p>
              <div className="flex flex-wrap items-center gap-1">
                {meta.tags.map((t) => <span key={t} className="rounded-full bg-card px-1.5 py-0.5 text-[10.5px] text-muted-foreground ring-1 ring-border">{t}</span>)}
              </div>
            </div>
          </details>
        )}
      </div>
      {/* Always the same order: words first, then form, colour, and the final look. */}
      <Tabs defaultValue="type" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="px-4 pb-1">
          <TabsList className="grid h-8 w-full grid-cols-4">
            {['type', 'shape', 'colour', 'finish'].map((t) => (
              <TabsTrigger key={t} value={t} className="px-1 text-[12px] capitalize">{t}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* block (not Radix's default table) so wide code scrolls inside its box */}
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          <TabsContent value="type" className="mt-0"><TypeTab engine={engine} /></TabsContent>
          <TabsContent value="shape" className="mt-0"><ShapeTab engine={engine} /></TabsContent>
          <TabsContent value="colour" className="mt-0"><ColourTab engine={engine} /></TabsContent>
          <TabsContent value="finish" className="mt-0"><FinishTab engine={engine} /></TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}
