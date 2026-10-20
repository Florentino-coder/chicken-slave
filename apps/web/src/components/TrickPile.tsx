import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TrickPlay } from '@slave/engine';
import { useT } from '../i18n';
import PlayingCard from './PlayingCard';

function useMaxSets() {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide ? 6 : 3;
}

/**
 * The current pile as a row of overlapping plays, oldest on the left and faded, newest on top.
 * It sweeps away when the pile is cleared.
 */
export default function TrickPile({ trick, name, round }: { trick: TrickPlay[]; name: (id: string) => string; round: number }) {
  const t = useT();
  const maxSets = useMaxSets();
  const hidden = Math.max(0, trick.length - maxSets);
  const visible = trick.slice(hidden);
  // A new pile starts with a new first play, so every key changes and the old plays animate out.
  // The container itself never unmounts: swapping whole piles under AnimatePresence mode="wait"
  // got stuck with nothing rendered when bots cleared and re-led the pile within milliseconds.
  const pileKey = trick.length ? `${round}:${trick[0].p}:${trick[0].cards.join('.')}` : `empty:${round}`;

  return (
    <div className="relative flex items-end justify-center" data-testid="trick">
      {trick.length === 0 && <p className="tracking-wide text-white/45">{t('table.empty')}</p>}
      {hidden > 0 && <span className="mb-8 mr-2 whitespace-nowrap text-[11px] text-white/50">{t('table.more', { n: hidden })}</span>}
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((play, i) => {
          const latest = i === visible.length - 1;
          return (
            <motion.div
              key={`${pileKey}#${hidden + i}`}
              layout
              exit={{ opacity: 0, y: -60, scale: 0.85, transition: { duration: 0.3 } }}
              initial={{ opacity: 0, y: 40, scale: 0.7 }}
              animate={{ opacity: latest ? 1 : 0.55, y: 0, scale: latest ? 1 : 0.86 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className={`relative flex origin-bottom flex-col items-center ${i > 0 ? '-ml-6 sm:-ml-4' : ''}`}
              style={{ zIndex: i + 1, rotate: latest ? 0 : (i - visible.length + 1) * 3 }}
              data-testid="trick-play"
              title={name(play.p)}
            >
              {play.bomb && latest && (
                <motion.span
                  initial={{ opacity: 0.9, scale: 0.6 }}
                  animate={{ opacity: 0, scale: 2.2 }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-orange-400/60 blur-md"
                  aria-hidden
                />
              )}
              <div className={`flex ${latest ? 'gap-1' : '-space-x-6 sm:-space-x-8'}`}>
                {play.cards.map((c) => (
                  <PlayingCard key={c} id={c} small={!latest} />
                ))}
              </div>
              {/* Names would collide in the overlap; the latest player is named below the pile. */}
              {play.bomb && (
                <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-orange-300">{t('table.bomb')}</span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
