import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createEngine } from '../js/engine.js';
import { EngineContext } from './useEngine.js';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import TopBar from './components/TopBar.jsx';
import ModeList from './components/ModeList.jsx';
import Inspector from './components/Inspector.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ArrangeLayer from './components/ArrangeLayer.jsx';

// The Explore universe is only downloaded when first opened.
const Explore = lazy(() => import('./explore/Explore.jsx'));
const About = lazy(() => import('./about/About.jsx'));

// Embed mode (iframe / downloaded HTML): just the poster.
const EMBED = new URLSearchParams(location.search).has('embed') || !!window.POSTER_EMBED;
// Embedded: no page background, so only the visual shows (no slivers or corners around it).
if (EMBED) document.documentElement.classList.add('embed');
const EXPLORE_HASH = '#/explore';
const ABOUT_HASH = '#/about';
const viewOfHash = (h) => (h === EXPLORE_HASH ? 'explore' : h === ABOUT_HASH ? 'about' : 'create');

export default function App() {
  const viewportRef = useRef(null);
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const scene2Ref = useRef(null);
  const typeRef = useRef(null);
  const ambientRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const [view, setView] = useState(() => (EMBED ? 'create' : viewOfHash(location.hash)));
  // The example last opened from Explore, so browser Back returns to it.
  const [lastOpened, setLastOpened] = useState(null);
  const engineRef = useRef(null);

  useEffect(() => {
    const e = createEngine({
      els: { viewport: viewportRef.current, stage: stageRef.current, scene: sceneRef.current, scene2: scene2Ref.current, typeCanvas: typeRef.current, ambient: ambientRef.current },
      notify: (msg) => toast(msg),
      embed: EMBED,
    });
    setEngine(e);
    engineRef.current = e;
    return () => e.destroy();
  }, []);

  // The editor keeps running in the background but sleeps while exploring.
  useEffect(() => { engine?.setActive(view === 'create'); }, [engine, view]);

  // Each switch between Create and Explore is a browser history step, so Back/Forward work.
  const go = useCallback((v) => {
    const e = engineRef.current;
    if (v === 'explore') history.pushState(null, '', EXPLORE_HASH);
    else if (v === 'about') history.pushState(null, '', ABOUT_HASH);
    else if (e) history.pushState(null, '', '#' + e.toHash());
    setView(v);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const v = viewOfHash(location.hash);
      if (v !== 'create') return setView(v);
      setView('create');
      // Going back to an earlier poster: load the settings stored in that address.
      const e = engineRef.current;
      if (e && location.hash !== '#' + e.toHash()) e.loadFromHash(location.hash);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Drop or paste an image anywhere in the editor to use it as the image source.
  useEffect(() => {
    if (!engine || EMBED || view !== 'create') return;
    const fileOf = (list) => [...(list || [])].find((f) => f.type?.startsWith('image/'));
    const onOver = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); };
    const onDrop = (e) => { const f = fileOf(e.dataTransfer?.files); if (!f) return; e.preventDefault(); useImage(f); };
    const onPaste = (e) => { if (e.target.closest?.('input, textarea')) return; const f = fileOf(e.clipboardData?.files); if (f) useImage(f); };
    const useImage = (f) => {
      engine.setSourceFile(f);
      if (engine.mode?.medium !== 'image') toast('Image loaded. Pick an entry from the Image group to use it.');
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop); window.removeEventListener('paste', onPaste); };
  }, [engine, view]);

  // Keyboard shortcuts (editor only)
  useEffect(() => {
    if (!engine || EMBED || view !== 'create') return;
    const onKey = (e) => {
      const typing = e.target.closest('input, textarea, select, [contenteditable]');
      // Undo / redo work everywhere except while typing (where the field's own undo applies).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) engine.redo(); else engine.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); engine.redo(); return; }
      if (e.key === 'Escape' && engine.arranging) { engine.setArranging(false); return; }
      if (e.target.closest('input, textarea, select, [contenteditable], [role="slider"], [role="combobox"], [role="dialog"]') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') { engine.setArranging(!engine.arranging); return; }
      if (k === 'r') engine.randomise();
      else if (k === 's') engine.savePNG('4K (4096px)');
      else if (e.key === ' ') { engine.togglePause(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') engine.stepMode(1);
      else if (e.key === 'ArrowLeft') engine.stepMode(-1);
      else if (k === 'x') window.dispatchEvent(new Event('morva:surprise'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, view]);

  const stage = (
    <div ref={viewportRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div ref={stageRef} id="stage" className={EMBED ? 'relative' : 'relative bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_60px_-20px_rgba(0,0,0,0.25)]'}>
        {!EMBED && <canvas ref={ambientRef} id="ambient" aria-hidden="true" />}
        {/* The artwork and its optional second layer, clipped to the frame so they can be panned and zoomed. */}
        <div id="clip" className="absolute inset-0 overflow-hidden">
          <div ref={sceneRef} id="scene" className="absolute inset-0 cursor-crosshair touch-none" />
          <div ref={scene2Ref} id="scene2" className="pointer-events-none absolute inset-0" style={{ display: 'none' }} />
        </div>
        <canvas ref={typeRef} id="type-layer" />
        {!EMBED && engine && <EngineContext.Provider value={engine}><ArrangeLayer /></EngineContext.Provider>}
      </div>
    </div>
  );

  if (EMBED) return <div className="flex h-full bg-transparent">{stage}</div>;

  const withEngine = (node) => engine && <EngineContext.Provider value={engine}>{node}</EngineContext.Provider>;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {withEngine(<TopBar view={view} onView={(v) => { if (v === 'explore') setLastOpened(null); go(v); }} />)}
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          <ErrorBoundary>{withEngine(<ModeList />)}</ErrorBoundary>
          <main className="relative isolate flex min-h-[55vh] min-w-0 flex-1 overflow-hidden bg-stage">{stage}</main>
          <ErrorBoundary>{withEngine(<Inspector />)}</ErrorBoundary>

          {view === 'about' && engine && (
            <div className="fixed inset-x-0 bottom-0 top-12 z-20">
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <About onOpenMode={(id) => { engine.setMode(id); go('create'); }} onExplore={() => go('explore')} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}

          {view === 'explore' && engine && (
            <div className="fixed inset-x-0 bottom-0 top-12 z-20 bg-stage">
              <ErrorBoundary>
                <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-muted-foreground">Loading the universe…</div>}>
                  <Explore
                    initialSelected={lastOpened}
                    onOpenMode={(id) => { engine.setMode(id); go('create'); }}
                    onOpen={(example) => { setLastOpened(example.id); engine.load(example.settings, { exampleId: example.id }); go('create'); }}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
