import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Upload, X } from 'lucide-react';
import { userFonts, onUserFonts, addUserFont, removeUserFont } from '../../js/shared/userFonts.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FONTS_LIBRARY, FONT_CATEGORIES, fontByName } from '../../js/shared/fonts.js';
import { cn } from '@/lib/utils';

const sample = (f) => `400 16px "${f.family}"`;

// Fonts only download when shown, so warm up the visible list once the picker opens.
function useWarmFonts(open, list) {
  useEffect(() => {
    if (!open) return;
    list.forEach((f) => document.fonts.load(sample(f)).catch(() => {}));
  }, [open, list]);
}

export default function FontPicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState('All');
  const list = cat === 'All' ? FONTS_LIBRARY : FONTS_LIBRARY.filter((f) => f.category === cat);
  useWarmFonts(open, list);
  const current = fontByName(value);
  useSyncExternalStore(onUserFonts, () => userFonts.length); // re-render when fonts are added or removed
  const mine = userFonts;
  const fileRef = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    try { const name = await addUserFont(file); onChange(name); setOpen(false); toast(`Added ${name}. It stays on this browser only.`); }
    catch (e) { toast(e.message); }
  };

  return (
    <div className={label ? 'flex items-center justify-between gap-3 py-1' : ''}>
      {label && <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={cn('flex h-8 items-center justify-between rounded-md px-2.5 text-left text-[13px]', label ? 'w-[170px] border border-border bg-background hover:border-foreground/40' : 'w-full bg-muted/70 hover:bg-muted')}>
            <span className="truncate" style={{ fontFamily: `"${current?.family || value}", Inter` }}>{current?.name || value}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search typefaces" className="text-[12px]" />
            <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-2">
              {['All', ...FONT_CATEGORIES].map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={cn('rounded-full px-2 py-0.5 text-[11px]', cat === c ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}>
                  {c}
                </button>
              ))}
            </div>
            <CommandList className="max-h-[340px]">
              <CommandEmpty className="py-6 text-center text-[12px] text-muted-foreground">No typeface with that name.</CommandEmpty>
              {mine.length > 0 && (
                <CommandGroup heading="Your fonts">
                  {mine.map((name) => (
                    <CommandItem key={name} value={`${name} your font`} onSelect={() => { onChange(name); setOpen(false); }} className="flex items-center gap-2 py-2">
                      <Check className={cn('size-3.5 shrink-0', value === name ? 'opacity-100' : 'opacity-0')} />
                      <div className="min-w-0 flex-1 truncate text-[17px] leading-tight" style={{ fontFamily: `"${name}", Inter` }}>{name}</div>
                      <button type="button" aria-label={`Remove ${name}`} title="Remove from this browser"
                        onClick={(e) => { e.stopPropagation(); removeUserFont(name); }} className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground">
                        <X className="size-3" />
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup>
                {list.map((f) => (
                  <CommandItem key={f.name} value={`${f.name} ${f.foundry} ${f.category}`} onSelect={() => { onChange(f.name); setOpen(false); }} className="flex items-center gap-2 py-2">
                    <Check className={cn('size-3.5 shrink-0', value === f.name ? 'opacity-100' : 'opacity-0')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[17px] leading-tight" style={{ fontFamily: `"${f.family}", Inter` }}>{f.name}</div>
                      <div className="truncate text-[10.5px] text-muted-foreground/70">{f.foundry.replace(/\s*\(.*\)$/, '')} · {f.category}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t border-border/60 p-1.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
                <Upload className="size-3.5" /> Upload your own font
                <span className="ml-auto text-[10.5px] text-muted-foreground/70">.ttf .otf .woff2</span>
              </button>
              <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
