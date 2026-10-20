import { motion } from 'framer-motion';
import { CardId, RANK_LABELS, SUIT_SYMBOLS, cardLabel, rankOf, suitOf } from '@slave/engine';

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
  const suit = SUIT_SYMBOLS[suitOf(id)];
  const size = small ? 'h-16 w-11 text-sm' : 'h-24 w-16 text-base sm:h-28 sm:w-20 sm:text-lg';
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
      className={`relative shrink-0 select-none rounded-lg border bg-white font-bold shadow-md ${size} ${
        red ? 'text-red-600' : 'text-slate-900'
      } ${selected ? 'border-amber-400 ring-2 ring-amber-400' : 'border-slate-300'} ${
        highlight ? 'ring-2 ring-sky-400' : ''
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className="absolute left-1 top-0.5 leading-none">
        {rank}
        <br />
        {suit}
      </span>
      <span className={`absolute inset-0 flex items-center justify-center ${small ? 'text-xl' : 'text-3xl'}`}>{suit}</span>
    </motion.button>
  );
}

export function CardBack({ small = true }: { small?: boolean }) {
  return (
    <div
      className={`shrink-0 rounded-md border border-white/30 bg-gradient-to-br from-rose-700 to-rose-900 shadow ${
        small ? 'h-8 w-6' : 'h-16 w-11'
      }`}
      aria-hidden
    />
  );
}
