import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, History, Image, Search, Sparkles, Star, Type, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { CATEGORIES, MODES, LOOKS, previewUrl } from '../../js/modes/index.js';
import { useEngine } from '../useEngine.js';
import { cn } from '@/lib/utils';

const ICONS = { Generative: Sparkles, Type, Image };
const GROUPS = CATEGORIES.map((c) => ({ ...c, icon: ICONS[c.id] || Sparkles }));
const LIB = { p5: 'p5', three: 'three', glsl: 'GLSL' };

// Card shown while hovering a mode: a looping clip of the mode plus what it is.
function Preview({ mode }) {
  const [videoOk, setVideoOk] = useState(true);
  return (
    <div className="w-[260px]">
      <div className="relative aspect-[1/1.414] overflow-hidden rounded-md bg-muted">
        <img src={previewUrl(mode.id, 'jpg')} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        {videoOk && (
          <video
            src={previewUrl(mode.id, 'mp4')} autoPlay muted loop playsInline
            className="absolute inset-0 size-full object-cover"
            onError={() => setVideoOk(false)}
          />
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="text-[13px] font-semibold">{mode.name}</div>
        <p className="text-[12px] leading-snug text-muted-foreground">{mode.description}</p>
        <p className="text-[11px] leading-snug text-muted-foreground/70">{mode.technique}</p>
      </div>
    </div>
  );
}

// Favourites and recently used effects, remembered in this browser only.
const FAV_KEY = 'morva-favourites', RECENT_KEY = 'morva-recent';
const readList = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const writeList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const closedGroups = new Set(readList('morva-closed-groups'));

function EffectRow({ m, current, fav, onPick, onFav }) {
  const on = current === m.id;
  return (
    <HoverCard openDelay={350} closeDelay={60}>
      <HoverCardTrigger asChild>
        <div className={cn('group/row flex items-center rounded-md transition-colors', on ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted')}>
          <button type="button" data-effect={m.id} onClick={() => onPick(m.id)} aria-current={on ? 'true' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-1 pr-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src={previewUrl(m.id, 'jpg')} alt="" loading="lazy" className="h-7 w-5 shrink-0 rounded-[2px] bg-muted object-cover ring-1 ring-black/5"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <span className={cn('font-mono text-[10px]', on ? 'text-background/60' : 'text-muted-foreground/70', 'group-hover/row:hidden')}>{LIB[m.library]}</span>
          </button>
          <button type="button" onClick={() => onFav(m.id)} aria-pressed={fav} aria-label={fav ? `Remove ${m.name} from favourites` : `Add ${m.name} to favourites`}
            className={cn('mr-1 hidden size-5 shrink-0 place-items-center rounded group-hover/row:grid', fav && 'grid', on ? 'text-background/80' : 'text-muted-foreground hover:text-foreground')}>
            <Star className={cn('size-3', fav && 'fill-current text-signal')} />
          </button>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} className="w-auto p-3">
        <Preview mode={m} />
      </HoverCardContent>
    </HoverCard>
  );
}

export default function ModeList() {
  const engine = useEngine();
  const current = engine.state.mode;
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(null);
  const [favs, setFavs] = useState(() => readList(FAV_KEY));
  const [recent, setRecent] = useState(() => readList(RECENT_KEY));
  const [closed, setClosed] = useState(closedGroups);
  const navRef = useRef(null);

  // Remember the last few effects you opened.
  useEffect(() => {
    if (!current) return;
    setRecent((r) => { const next = [current, ...r.filter((x) => x !== current)].slice(0, 4); writeList(RECENT_KEY, next); return next; });
  }, [current]);

  const toggleFav = (id) => setFavs((f) => { const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id]; writeList(FAV_KEY, next); return next; });
  const toggleGroup = (id) => setClosed((c) => { const next = new Set(c); next.has(id) ? next.delete(id) : next.add(id); writeList('morva-closed-groups', [...next]); return next; });

  const filtering = !!(query.trim() || tag);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MODES.filter((m) =>
      (!tag || m.looks.includes(tag)) &&
      (!q || [m.name, m.description, m.technique, m.category, ...m.tags, ...m.looks].join(' ').toLowerCase().includes(q)));
  }, [query, tag]);

  // ↑/↓ move between effects in the list (and open them), like a file browser.
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...navRef.current.querySelectorAll('button[data-effect]')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    engine.setMode(next.dataset.effect);
  };

  const byId = (id) => MODES.find((m) => m.id === id);
  const pinned = [
    { id: 'Favourites', icon: Star, items: favs.map(byId).filter(Boolean) },
    { id: 'Recent', icon: History, items: recent.filter((id) => id !== current || recent.length > 1).map(byId).filter(Boolean).filter((m) => !favs.includes(m.id)) },
  ].filter((g) => g.items.length && !filtering);

  const row = (m) => <EffectRow key={m.id} m={m} current={current} fav={favs.includes(m.id)} onPick={(id) => engine.setMode(id)} onFav={toggleFav} />;

  const group = (id, Icon, items, { description, empty } = {}) => {
    const isClosed = closed.has(id) && !filtering;
    return (
      <div key={id}>
        <button type="button" onClick={() => toggleGroup(id)} aria-expanded={!isClosed} title={description}
          className="mb-1 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn('size-3 transition-transform', !isClosed && 'rotate-90')} />
          <Icon className="size-3.5" /> {id}
          <span className="ml-auto tabular-nums">{items.length || ''}</span>
        </button>
        {!isClosed && (items.length ? items.map(row) : empty && <p className="px-2 text-[12px] text-muted-foreground/70">{empty}</p>)}
      </div>
    );
  };

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border bg-background md:flex">
      <div className="space-y-2.5 border-b border-border/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or look"
            aria-label="Search effects"
            className="h-8 w-full rounded-md border border-border bg-muted/50 pl-8 pr-7 text-[12px] outline-none focus:border-foreground/40 focus:bg-card"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {/* Search by how it looks, not by technique (tags stay searchable in the box). */}
          {LOOKS.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                tag === t ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav ref={navRef} onKeyDown={onKeyDown} aria-label="Effects" className="space-y-4 p-2.5">
          {pinned.map((g) => group(g.id, g.icon, g.items))}
          {GROUPS.map(({ id, description, icon }) => {
            const items = visible.filter((m) => m.category === id);
            if (!items.length && filtering) return null;
            return group(id, icon, items, { description, empty: 'Coming soon' });
          })}
          {!visible.length && (
            <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              Nothing matches “{query || tag}”.{' '}
              <button className="underline" onClick={() => { setQuery(''); setTag(null); }}>Show all</button>
            </div>
          )}
        </nav>
      </ScrollArea>
      <p className="border-t border-border/60 px-3 py-2 text-[10.5px] text-muted-foreground/80">↑ ↓ to move through effects · ☆ to save favourites</p>
    </aside>
  );
}
