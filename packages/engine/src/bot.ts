import { CardId, RANK_TWO, rankOf } from './cards';
import { Combo, legalMoves } from './combos';
import { Action, GameState, activePlayers } from './game';

export type BotLevel = 'easy' | 'medium';

/** Card strength under the current order (revolution reverses it). */
function power(state: GameState, id: CardId): number {
  return state.revolution ? 51 - id : id;
}

function rankCounts(hand: readonly CardId[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of hand) m.set(rankOf(c), (m.get(rankOf(c)) ?? 0) + 1);
  return m;
}

/** Lowest-strength cards first. */
function weakest(state: GameState, hand: readonly CardId[], count: number): CardId[] {
  return [...hand].sort((a, b) => power(state, a) - power(state, b)).slice(0, count);
}

/** Cards a timed-out or disconnected player gives during exchange. */
export function autoExchangeCards(state: GameState, player: string): CardId[] {
  const task = state.exchanges.find((t) => t.from === player && !t.done);
  if (!task) return [];
  return weakest(state, state.hands[player], task.count);
}

/** Move made for a player whose turn timer ran out: pass, or lead the weakest single. */
export function timeoutAction(state: GameState, player: string): Action | null {
  if (state.phase === 'exchange') {
    const cards = autoExchangeCards(state, player);
    return cards.length ? { type: 'exchange', cards } : null;
  }
  if (state.phase !== 'playing' || state.turn !== player) return null;
  if (state.pile) return { type: 'pass' };
  if (state.mustInclude != null) return { type: 'play', cards: [state.mustInclude] };
  return { type: 'play', cards: weakest(state, state.hands[player], 1) };
}

function movesFor(state: GameState, player: string): Combo[] {
  return legalMoves(state.hands[player], {
    pile: state.pile,
    revolution: state.revolution,
    mustInclude: state.mustInclude,
    allowStraights: state.settings.allowStraights,
  });
}

/** Picks an action for a bot, or null when it is not the bot's move. */
export function botAction(state: GameState, player: string, level: BotLevel = 'medium'): Action | null {
  if (state.phase === 'exchange') {
    const cards = autoExchangeCards(state, player);
    return cards.length ? { type: 'exchange', cards } : null;
  }
  if (state.phase !== 'playing' || state.turn !== player) return null;

  const hand = state.hands[player];
  const moves = movesFor(state, player);
  if (moves.length === 0) return state.pile ? { type: 'pass' } : null;

  const byStrength = (a: Combo, b: Combo) => power(state, a.high) - power(state, b.high);

  // Going out in one move always wins.
  const finisher = moves.find((m) => m.size === hand.length);
  if (finisher && !(state.settings.noTwoFinish && finisher.rank === RANK_TWO)) {
    return { type: 'play', cards: finisher.cards };
  }

  if (level === 'easy') {
    const pick = state.pile
      ? [...moves].sort(byStrength)[0]
      : [...moves].filter((m) => m.type !== 'straight').sort((a, b) => byStrength(a, b) || b.size - a.size)[0];
    return { type: 'play', cards: pick.cards };
  }

  const counts = rankCounts(hand);
  const breaksSet = (m: Combo) => m.type !== 'straight' && m.size < (counts.get(m.rank) ?? 0);
  const isTop = (m: Combo) => {
    const top = state.revolution ? m.cards[0] : m.high;
    return state.revolution ? rankOf(top) <= 4 : rankOf(top) >= 14;
  };
  const opponents = activePlayers(state).filter((p) => p !== player);
  const endgame = hand.length <= 4 || opponents.some((p) => state.hands[p].length <= 2);

  if (!state.pile) {
    // Lead: dump the weakest whole group (keep pairs/triples together), longer straights first.
    const leads = moves.filter((m) => !breaksSet(m));
    const straights = leads.filter((m) => m.type === 'straight').sort((a, b) => b.size - a.size || byStrength(a, b));
    if (straights.length && !isTop(straights[0])) return { type: 'play', cards: straights[0].cards };
    const sets = leads.filter((m) => m.type !== 'straight').sort(byStrength);
    const pick = sets[0] ?? [...moves].sort(byStrength)[0];
    return { type: 'play', cards: pick.cards };
  }

  const cost = (m: Combo) => power(state, m.high) + (breaksSet(m) ? 30 : 0) + (isTop(m) && !endgame ? 40 : 0);
  const best = [...moves].sort((a, b) => cost(a) - cost(b))[0];
  if (!endgame && isTop(best) && hand.length > 6) return { type: 'pass' };
  if (!endgame && breaksSet(best) && (counts.get(best.rank) ?? 0) >= 3) return { type: 'pass' };
  return { type: 'play', cards: best.cards };
}
