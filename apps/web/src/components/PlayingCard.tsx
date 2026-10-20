import { motion } from 'framer-motion';
import { CardId, RANK_LABELS, cardLabel, rankOf, suitOf } from '@slave/engine';
import type { IconName } from '../icons/paths';
import Icon from './Icon';

const SUIT_ICONS: IconName[] = ['club', 'diamond', 'heart', 'spade'];

interface Props {
  id: CardId;
  selected?: boolean;
  highlight?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export default function PlayingCard({ id, selected, highlight, small, onClick, disabled }: Props) {
  const red = suitOf(id) === 1 || suitOf(id) === 2;
  const rank = RANK_LABELS[rankOf(id)];
  const suit = SUIT_ICONS[suitOf(id)];
  const size = small ? 'h-16 w-11 text-sm' : 'h-[72px] w-12 text-sm sm:h-28 sm:w-20 sm:text-lg';
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: selected ? -18 : 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-pressed={onClick ? !!selected : undefined}
      aria-label={cardLabel(id)}
      data-card={id}
      className={`relative shrink-0 select-none rounded-lg border bg-[#f6f0e1] font-normal shadow-md ${size} ${
        red ? 'text-cinnabar' : 'text-[#13221a]'
      } ${selected ? 'border-gold ring-2 ring-gold' : 'border-[#d9cfb6]'} ${highlight ? 'ring-2 ring-sky-400' : ''} ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <span className="absolute left-1 top-0.5 flex flex-col items-center leading-none">
        {rank}
        <Icon name={suit} size={small ? 10 : 12} className="mt-0.5 sm:hidden" />
        <Icon name={suit} size={14} className="mt-0.5 hidden sm:block" />
      </span>
      <span className="absolute inset-0 flex items-center justify-center pt-2">
        <Icon name={suit} size={small ? 22 : 26} className="sm:hidden" />
        <Icon name={suit} size={small ? 22 : 36} className="hidden sm:block" />
      </span>
    </motion.button>
  );
}

/** Lacquer card back: gold lattice on cinnabar-black. */
export function CardBack({ small = true }: { small?: boolean }) {
  return (
    <div
      className={`shrink-0 rounded-[5px] border border-[#f6f0e1]/70 shadow ${small ? 'h-8 w-6' : 'h-16 w-11'}`}
      style={{
        backgroundColor: '#4a1410',
        backgroundImage:
          'linear-gradient(45deg, rgb(231 196 92 / .35) 1px, transparent 1px), linear-gradient(-45deg, rgb(231 196 92 / .35) 1px, transparent 1px)',
        backgroundSize: '6px 6px',
      }}
      aria-hidden
    />
  );
}
