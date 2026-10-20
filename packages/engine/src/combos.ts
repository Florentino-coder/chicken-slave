import { CardId, RANK_TWO, isValidCard, rankOf, sortCards } from './cards';

export type ComboType = 'single' | 'pair' | 'triple' | 'quad' | 'straight';

export interface Combo {
  type: ComboType;
  /** Sorted ascending. */
  cards: CardId[];
  size: number;
  /** Rank of the highest card. */
  rank: number;
  /** Highest card id; decides comparisons between combos of the same type and size. */
  high: CardId;
}

export interface ComboOptions {
  allowStraights: boolean;
}

const SET_TYPES: Record<number, ComboType> = { 1: 'single', 2: 'pair', 3: 'triple', 4: 'quad' };

/** Returns the combo the cards form, or null when they are not a legal combination. */
export function classify(cards: readonly CardId[], opts: ComboOptions): Combo | null {
  if (cards.length === 0) return null;
  if (!cards.every(isValidCard)) return null;
  if (new Set(cards).size !== cards.length) return null;

  const sorted = sortCards(cards);
  const high = sorted[sorted.length - 1];
  const ranks = sorted.map(rankOf);
  const base = { cards: sorted, size: sorted.length, rank: rankOf(high), high };

  if (sorted.length <= 4 && ranks.every((r) => r === ranks[0])) {
    return { type: SET_TYPES[sorted.length], ...base };
  }

  if (opts.allowStraights && sorted.length >= 3) {
    const isRun = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
    if (isRun && ranks[ranks.length - 1] < RANK_TWO) {
      return { type: 'straight', ...base };
    }
  }
  return null;
}

/**
 * Bomb rule: any triple cuts a single, and only a quad cuts a pair, whatever the ranks.
 * Afterwards the pile is the bomb, so followers must play a higher triple or quad.
 */
export function isBomb(combo: Combo, pile: Combo | null, bombs: boolean): boolean {
  if (!bombs || !pile) return false;
  return (pile.type === 'single' && combo.type === 'triple') || (pile.type === 'pair' && combo.type === 'quad');
}

/**
 * True when `combo` may be played on top of `pile`.
 * Same type and size are required; the higher top card wins. Revolution flips the order.
 * With `bombs`, a triple also beats any single and a quad also beats any pair.
 */
export function canBeat(combo: Combo, pile: Combo | null, revolution = false, bombs = false): boolean {
  if (!pile) return true;
  if (isBomb(combo, pile, bombs)) return true;
  if (combo.type !== pile.type || combo.size !== pile.size) return false;
  return revolution ? combo.high < pile.high : combo.high > pile.high;
}

function groupByRank(hand: readonly CardId[]): Map<number, CardId[]> {
  const groups = new Map<number, CardId[]>();
  for (const c of sortCards(hand)) {
    const r = rankOf(c);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(c);
  }
  return groups;
}

function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [first, ...s]), ...subsets(rest, k)];
}

/**
 * Every set (single/pair/triple/quad) the hand can form, plus straights when enabled.
 * Straights use the lowest card of each rank except the top rank, where every suit is tried;
 * this keeps enumeration small while still covering every possible top card.
 */
export function allCombos(hand: readonly CardId[], opts: ComboOptions): Combo[] {
  const groups = groupByRank(hand);
  const out: Combo[] = [];
  for (const cards of groups.values()) {
    for (let k = 1; k <= cards.length; k++) {
      for (const s of subsets(cards, k)) out.push(classify(s, opts)!);
    }
  }
  if (opts.allowStraights) {
    const ranks = [...groups.keys()].filter((r) => r < RANK_TWO).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 2; j < ranks.length; j++) {
        if (ranks[j] - ranks[i] !== j - i) break;
        const lower = ranks.slice(i, j).map((r) => groups.get(r)![0]);
        for (const top of groups.get(ranks[j])!) out.push(classify([...lower, top], opts)!);
      }
    }
  }
  return out;
}

export interface MoveQuery extends ComboOptions {
  pile: Combo | null;
  revolution?: boolean;
  /** Bomb rule (see isBomb). */
  bombs?: boolean;
  /** When set, every returned move must contain this card (first lead of the game: 3♣). */
  mustInclude?: CardId | null;
}

/** All plays that are legal from `hand` right now (excluding pass). */
export function legalMoves(hand: readonly CardId[], q: MoveQuery): Combo[] {
  return allCombos(hand, q).filter(
    (c) =>
      canBeat(c, q.pile, q.revolution, q.bombs) &&
      (q.mustInclude == null || c.cards.includes(q.mustInclude)),
  );
}
