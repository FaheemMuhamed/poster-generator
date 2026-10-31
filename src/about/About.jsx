import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MODES } from '../../js/modes/index.js';
import { FONTS_LIBRARY } from '../../js/shared/fonts.js';
import DitherLogo from './DitherLogo.jsx';

// The hero is a live entry, running in embed mode (no interface, no text) so it can be played with.
const HERO = 'rd';
const HERO_SRC = `${location.pathname}?embed=1#${HERO}/1984?tx=0`;

// The live hero. While hovered, a faint glow of its own colours spreads behind it
// (a tiny copy of its canvas, blurred), like the editor's ambient glow.
function HeroVisual({ title }) {
  const frameRef = useRef(null);
  const glowRef = useRef(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!hover) return;
    const g = glowRef.current.getContext('2d');
    let raf, n = 0;
    const tick = () => {
      if (n++ % 4 === 0) {
        try {
          const src = frameRef.current?.contentDocument?.querySelector('#scene canvas');
          if (src) g.drawImage(src, 0, 0, 32, 45);
        } catch {}
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hover]);

  return (
    <div className="relative aspect-[1/1.414]" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <canvas
        ref={glowRef} width={32} height={45} aria-hidden="true"
        className={`pointer-events-none absolute -inset-[12%] size-[124%] blur-[48px] saturate-150 transition-opacity duration-700 ease-out motion-reduce:transition-none ${hover ? 'opacity-40' : 'opacity-0'}`}
      />
      <iframe ref={frameRef} src={HERO_SRC} title={title} className="absolute inset-0 size-full border-0 bg-transparent" />
    </div>
  );
}

export default function About({ onOpenMode, onExplore }) {
  const hero = MODES.find((m) => m.id === HERO);
  const selfHosted = FONTS_LIBRARY.filter((f) => f.source === 'self').length;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1120px] px-[max(16px,env(safe-area-inset-left,0px))] pb-24 pt-10 sm:px-8">
        <section className="grid items-center gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="space-y-6">
            <DitherLogo className="w-full max-w-[460px]" />
            <p className="max-w-[22ch] text-balance text-[26px] leading-[1.12] font-semibold tracking-[-0.025em] sm:text-[36px]">
              An archive of generative visuals you can play with.
            </p>
            <p className="max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
              Morva collects techniques from generative art and creative coding, such as noise fields, particle systems, reaction–diffusion and kinetic type. Each one is a live visual. Shape it with plain controls, export it as an image, video or embed, and copy its p5.js, three.js or GLSL code. You don't need to write code to use any of it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onOpenMode(HERO)} className="gap-1.5">Start making <ArrowRight className="size-4" /></Button>
              <Button variant="outline" onClick={onExplore}>Explore 120 examples</Button>
            </div>
          </div>

          <figure className="mx-auto w-full max-w-[400px]">
            <HeroVisual title={`${hero.name}, live`} />
            <figcaption className="mt-2 space-y-0.5 text-[12px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] leading-tight font-semibold">{hero.name}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">GLSL</span>
              </div>
              <p className="text-muted-foreground">Move over it to paint. Click to drop a seed.</p>
            </figcaption>
          </figure>
        </section>

        <section className="mt-20 grid gap-10 border-t border-border pt-8 md:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-[20px] leading-tight font-semibold tracking-tight">For developers</h2>
            <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">
              Every entry has a Code button that opens a terminal with runnable code and your settings built in. Select it and copy it into your own project.
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-[20px] leading-tight font-semibold tracking-tight">Credits</h2>
            <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">
              Built on p5.js and three.js. The type library holds {FONTS_LIBRARY.length} open-licence families, {selfHosted} of them from independent foundries: Collletttivo, Open Foundry, uncut.wtf and The League of Moveable Type. Morva is free; the Support button keeps it growing.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
