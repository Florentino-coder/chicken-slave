/**
 * Card encoding: id = (rank - 3) * 4 + suit, so ids 0..51 sort by rank first, then suit.
 * Rank 3..15 where 11=J, 12=Q, 13=K, 14=A, 15=2 (the highest).
 * Suit 0..3 = ♣ < ♦ < ♥ < ♠.
 */
export type CardId = number;

export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;
export const RANK_LABELS: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};

export const THREE_OF_CLUBS: CardId = 0;
export const RANK_TWO = 15;

/** Returns an integer in [0, n). */
export type Rng = (n: number) => number;

export function rankOf(id: CardId): number {
  return Math.floor(id / 4) + 3;
}

export function suitOf(id: CardId): number {
  return id % 4;
}

export function makeCard(rank: number, suit: number): CardId {
  return (rank - 3) * 4 + suit;
}

export function isValidCard(id: unknown): id is CardId {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < 52;
}

export function cardLabel(id: CardId): string {
  return `${RANK_LABELS[rankOf(id)]}${SUIT_SYMBOLS[suitOf(id)]}`;
}

export function fullDeck(): CardId[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function sortCards(cards: readonly CardId[]): CardId[] {
  return [...cards].sort((a, b) => a - b);
}

/** Fisher–Yates shuffle, returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministic RNG for tests and simulations (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * n);
  };
}
