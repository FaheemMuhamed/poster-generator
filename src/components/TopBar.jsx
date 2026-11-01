import { Dices, Grid3x3, Lamp, Moon, Move, Pause, Play, Redo2, Sun, Undo2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { GUIDES } from './ArrangeLayer.jsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SupportDialog from './SupportDialog.jsx';
import FeedbackDialog from './FeedbackDialog.jsx';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { FORMATS, MODES } from '../../js/engine.js';
import { useEngine } from '../useEngine.js';
import ExportMenu from './ExportMenu.jsx';
import Logo from './Logo.jsx';
import SurpriseButton from './SurpriseButton.jsx';
import { setTheme, useTheme } from '../useTheme.js';

function IconButton({ label, shortcut, onClick, children, disabled, pressed }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={pressed ? 'size-8 bg-muted text-foreground' : 'size-8'} onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={label}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}{shortcut && <kbd className="ml-2 opacity-60">{shortcut}</kbd>}</TooltipContent>
    </Tooltip>
  );
}

// One side of a custom width : height ratio (e.g. 3 : 4, 1200 : 628).
function RatioInput({ value, onChange, label }) {
  return (
    <input
      type="number" min={0.1} step="any" value={value} aria-label={label}
      onChange={(e) => { const v = Number(e.target.value); if (v > 0) onChange(v); }}
      className="h-7 w-14 rounded-[3px] bg-muted px-1.5 text-center font-mono text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export default function TopBar({ view, onView }) {
  const engine = useEngine();
  const { state } = engine;
  const theme = useTheme();
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-1.5 md:h-12 md:flex-nowrap md:py-0">
      <a href="#/about" onClick={(e) => { e.preventDefault(); onView('about'); }} className="flex items-center rounded-[3px] pl-1 pr-2 focus-visible:outline-2 focus-visible:outline-foreground" aria-label="Morva: about">
        <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
      </a>

      <ToggleGroup type="single" value={view} onValueChange={(v) => v && onView(v)} className="rounded-md bg-muted p-0.5">
        <ToggleGroupItem value="create" className="h-7 rounded-[5px] px-3 text-[12px] data-[state=on]:bg-card dark:data-[state=on]:bg-accent data-[state=on]:shadow-sm">Create</ToggleGroupItem>
        <ToggleGroupItem value="explore" className="h-7 rounded-[5px] px-3 text-[12px] data-[state=on]:bg-card dark:data-[state=on]:bg-accent data-[state=on]:shadow-sm">Explore</ToggleGroupItem>
      </ToggleGroup>

      {/* On phones the mode list is hidden, so offer it here. */}
      {view === 'create' && <Select value={state.mode} onValueChange={(v) => engine.setMode(v)}>
        <SelectTrigger size="sm" className="h-8 w-[130px] shrink-0 text-[12px] md:hidden"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MODES.map((m) => <SelectItem key={m.id} value={m.id} className="text-[12px]">{m.category} · {m.name}</SelectItem>)}
        </SelectContent>
      </Select>}

      {/* Phones: these tools wrap onto a second row. */}
      <div className={view === 'create' ? 'flex items-center gap-1 md:mx-auto' : 'hidden items-center gap-1 md:invisible md:mx-auto md:flex'}>
        <Select value={state.format} onValueChange={(v) => engine.setFormat(v)}>
          <SelectTrigger size="sm" className="h-8 w-[118px] shrink-0 border-none lg:w-[170px] text-[12px] shadow-none hover:bg-muted"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(FORMATS).map((f) => <SelectItem key={f} value={f} className="text-[12px]">{f === 'Custom' ? 'Custom ratio…' : f}</SelectItem>)}
          </SelectContent>
        </Select>
        {state.format === 'Custom' && (
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground" title="Width : height">
            <RatioInput value={state.frame.w} onChange={(w) => engine.setFrame(w, state.frame.h)} label="Width" />
            <span>:</span>
            <RatioInput value={state.frame.h} onChange={(h) => engine.setFrame(state.frame.w, h)} label="Height" />
          </div>
        )}
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <IconButton label="Undo" shortcut="⌘Z" onClick={() => engine.undo()} disabled={!engine.canUndo}><Undo2 /></IconButton>
        <IconButton label="Redo" shortcut="⇧⌘Z" onClick={() => engine.redo()} disabled={!engine.canRedo}><Redo2 /></IconButton>
        <IconButton label={engine.arranging ? 'Done arranging' : 'Arrange: move the artwork, text and pin'} shortcut="A" pressed={engine.arranging} onClick={() => engine.setArranging(!engine.arranging)}><Move /></IconButton>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={engine.guides !== 'None' ? 'size-8 bg-muted text-foreground' : 'size-8'} aria-label="Guides"><Grid3x3 /></Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Guides</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="center" className="w-44">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Guides (never exported)</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={engine.guides} onValueChange={(g) => engine.setGuides(g)}>
              {GUIDES.map((g) => <DropdownMenuRadioItem key={g} value={g} className="text-[12px]">{g}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <IconButton label={state.motion.paused ? 'Play' : 'Pause'} shortcut="Space" onClick={() => engine.togglePause()}>
          {state.motion.paused ? <Play /> : <Pause />}
        </IconButton>
        <IconButton label="New variation" shortcut="R" onClick={() => engine.randomise()}><Dices /></IconButton>
        <IconButton label={state.ui.ambient ? 'Turn off ambient glow' : 'Turn on ambient glow'} onClick={() => engine.toggleAmbient()}>
          <Lamp className={state.ui.ambient ? '' : 'opacity-40'} />
        </IconButton>
        <span className="ml-1.5"><SurpriseButton /></span>
      </div>

      <div className="hidden items-center md:flex">
        <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </IconButton>
        <FeedbackDialog />
        <SupportDialog />
      </div>
      {view === 'create' && <ExportMenu />}
    </header>
  );
}
