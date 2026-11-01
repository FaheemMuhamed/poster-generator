import { useRef, useState } from 'react';
import { ChevronRight, Lock, LockOpen } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// How a value reads: 0–1 ranges as percentages, everything else as a tidy number + unit.
function fmt(v, { min, max, step, unit } = {}) {
  if (typeof v !== 'number') return v;
  if (unit === '%' || (unit === undefined && min >= 0 && max <= 1 && max > 0)) return `${Math.round(v * 100)}%`;
  const d = !step || step >= 1 ? 0 : Math.min(2, Math.max(0, Math.ceil(-Math.log10(step))));
  const n = Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
  return unit ? `${n}${unit === '°' || unit === '×' ? '' : ' '}${unit}` : n;
}

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

// Label row shared by every control: name, a dot when it differs from the default
// (click it, or double-click the name, to reset), an optional lock, and the value.
// The number at the end of a slider row: click it to type an exact value.
// Percent fields take 0–100; anything typed is clamped to the range and snapped to the step.
function EditableValue({ value, display, min, max, step, unit, onChange }) {
  const [draft, setDraft] = useState(null);
  const percent = unit === '%' || (unit === undefined && min >= 0 && max <= 1 && max > 0);
  const commit = () => {
    let n = parseFloat(String(draft).replace(',', '.'));
    setDraft(null);
    if (!Number.isFinite(n)) return;
    if (percent) n /= 100;
    if (step) n = Math.round((n - min) / step) * step + min;
    onChange(Math.min(max, Math.max(min, Number(n.toFixed(6)))));
  };
  if (draft !== null) {
    return (
      <input
        autoFocus value={draft} aria-label="Exact value" inputMode="decimal"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); } }}
        className="ml-auto h-5 w-16 rounded-[3px] bg-muted px-1 text-right font-mono text-[11px] tabular-nums text-foreground outline-none ring-1 ring-ring"
      />
    );
  }
  const shown = percent ? Math.round(value * 100) : Number(value.toFixed(step && step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0));
  return (
    <button type="button" onClick={() => setDraft(String(shown))} title="Type an exact value"
      className="ml-auto rounded-[3px] px-1 font-mono text-[11px] tabular-nums text-muted-foreground/80 hover:bg-muted hover:text-foreground">
      {display}
    </button>
  );
}

function FieldHead({ label, value, changed, onReset, locked, onLock, editor }) {
  return (
    <div className="group/field flex min-h-5 items-center gap-1.5">
      <Label className="truncate text-[12px] font-normal text-muted-foreground" onDoubleClick={changed ? onReset : undefined} title={changed ? 'Double-click to reset' : undefined}>
        {label}
      </Label>
      {changed && onReset && (
        <button type="button" onClick={onReset} title="Reset to default" aria-label={`Reset ${label}`} className="grid size-3.5 place-items-center rounded-full">
          <span className="size-1.5 rounded-full bg-signal" />
        </button>
      )}
      {onLock && (
        <button
          type="button" onClick={onLock} aria-pressed={locked} aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          title={locked ? 'Locked: Surprise me and shuffles leave it alone' : 'Lock against shuffles'}
          className={cn('grid size-4 place-items-center rounded-sm text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100', locked ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-60')}
        >
          {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
        </button>
      )}
      {editor || (value !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/80">{value}</span>)}
    </div>
  );
}

export function SliderField({ label, value, min, max, step, unit, onChange, def, onReset, locked, onLock }) {
  return (
    <div className="space-y-2 py-1.5">
      <FieldHead label={label} changed={def && !same(value, def.value)} onReset={onReset} locked={locked} onLock={onLock}
        editor={typeof value === 'number' && <EditableValue value={value} display={fmt(value, { min, max, step, unit })} min={min} max={max} step={step} unit={unit} onChange={onChange} />} />
      <Slider value={[value]} min={min} max={max} step={step ?? (max - min) / 100} onValueChange={([v]) => onChange(v)} onDoubleClick={onReset} />
    </div>
  );
}

export function SwitchField({ label, value, onChange, def, onReset, locked, onLock }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <FieldHead label={label} changed={def && !same(value, def.value)} onReset={onReset} locked={locked} onLock={onLock} />
      <Switch checked={!!value} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function SelectField({ label, value, options, onChange, def, onReset, locked, onLock }) {
  // options: array of strings, or [{ value, label }]
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <FieldHead label={label} changed={def && !same(value, def.value)} onReset={onReset} locked={locked} onLock={onLock} />
      <Select value={String(value)} onValueChange={(v) => onChange(items.find((i) => String(i.value) === v)?.value ?? v)}>
        <SelectTrigger size="sm" className="h-8 w-[140px] shrink-0 text-[12px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {items.map((i) => <SelectItem key={String(i.value)} value={String(i.value)} className="text-[12px]">{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// A few short options read better as chips you can see all at once.
export function ChoiceField({ label, value, options, onChange, def, onReset, locked, onLock }) {
  return (
    <div className="space-y-1.5 py-1.5">
      <FieldHead label={label} changed={def && !same(value, def.value)} onReset={onReset} locked={locked} onLock={onLock} />
      <div role="radiogroup" aria-label={label} className="flex rounded-md bg-muted p-0.5">
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}
            className={cn('min-w-0 flex-1 truncate rounded-[3px] px-1.5 py-1 text-[11px] transition-colors',
              o === value ? 'bg-card text-foreground shadow-sm dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder, def, onReset }) {
  return (
    <div className="space-y-1.5 py-1">
      {label && <FieldHead label={label} changed={def && value !== def.value} onReset={onReset} />}
      <Input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-8 text-[12px]" />
    </div>
  );
}

// Renders the right control for a mode parameter definition.
export function ParamField({ def, value, onChange, onReset, locked, onLock }) {
  const common = { label: def.label, value, onChange, def, onReset, locked, onLock };
  if (def.options) {
    const short = def.options.length <= 4 && def.options.join('').length <= 26;
    return short ? <ChoiceField {...common} options={def.options} /> : <SelectField {...common} options={def.options} />;
  }
  if (typeof def.value === 'boolean') return <SwitchField {...common} />;
  if (typeof def.value === 'string') return <TextField {...common} />;
  return <SliderField {...common} min={def.min} max={def.max} step={def.step} unit={def.unit} />;
}

// A compact number box with a leading icon, like a design tool's text panel.
// Drag the icon sideways to scrub; ↑/↓ nudge (Shift ×10).
export function NumberField({ icon: Icon, label, value, onChange, min = -Infinity, max = Infinity, step = 1, format = (v) => v, parse = Number, className }) {
  const [draft, setDraft] = useState(null);
  const drag = useRef(null);
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const commit = (raw) => { const v = parse(raw); if (Number.isFinite(v)) onChange(clamp(v)); setDraft(null); };
  return (
    <label className={cn('flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-muted/70 px-2 text-[12px] focus-within:ring-1 focus-within:ring-ring', className)} title={label}>
      <span
        className="cursor-ew-resize text-muted-foreground"
        onPointerDown={(e) => { drag.current = { x: e.clientX, v: value }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) onChange(clamp(drag.current.v + Math.round((e.clientX - drag.current.x) / 3) * step)); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <input
        aria-label={label}
        value={draft ?? format(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            setDraft(null);
          }
        }}
        className="min-w-0 flex-1 bg-transparent font-mono text-[12px] tabular-nums text-foreground outline-none"
      />
    </label>
  );
}

// Section open/closed state is remembered by title, so moving between effects keeps your layout.
const openState = new Map();

// A titled group. Essentials sit open; other groups fold. `aside` holds small tools (shuffle, reset).
export function Section({ title, children, defaultOpen = false, collapsible = true, aside }) {
  const [open, setOpenState] = useState(() => (collapsible ? openState.get(title) ?? defaultOpen : true));
  const setOpen = (v) => { openState.set(title, v); setOpenState(v); };
  return (
    <section className="border-b border-border/60 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!collapsible}
          aria-expanded={collapsible ? open : undefined}
          onClick={() => setOpen(!open)}
          className={cn('flex flex-1 items-center gap-1.5 text-left', collapsible ? 'cursor-pointer' : 'cursor-default')}
        >
          {collapsible && <ChevronRight className={cn('size-3.5 text-muted-foreground/70 transition-transform', open && 'rotate-90')} />}
          <span className="text-[12px] font-medium text-foreground">{title}</span>
        </button>
        {aside && <span className="ml-auto flex items-center gap-0.5">{aside}</span>}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}
