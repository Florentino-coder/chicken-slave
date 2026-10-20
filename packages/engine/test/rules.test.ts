import { describe, expect, it } from 'vitest';
import {
  Action,
  CardId,
  DEFAULT_SETTINGS,
  GameState,
  Settings,
  activePlayers,
  allCombos,
  applyAction,
  autoExchangeCards,
  botAction,
  canBeat,
  cardLabel,
  classify,
  createGame,
  fullDeck,
  isOut,
  isValidCard,
  legalMoves,
  makeCard,
  nextRound,
  rankOf,
  roleForPlace,
  seededRng,
  shuffle,
  sortCards,
  suitOf,
  timeoutAction,
  viewFor,
} from '../src';

const C = (rank: number, suit: number) => makeCard(rank, suit);
const NO_ST = { allowStraights: false };
const ST = { allowStraights: true };
/** Rng that never swaps: shuffle() returns the deck in id order. */
const identityRng = (n: number) => n - 1;

const seatsOf = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function ok(state: GameState, p: string, a: Action): GameState {
  const r = applyAction(state, p, a);
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(a)} -> ${r.error}`);
  return r.state;
}
function err(state: GameState, p: string, a: Action): string | undefined {
  const r = applyAction(state, p, a);
  return r.ok ? undefined : r.error;
}

/** A playing-phase table with hand-picked hands; `turn` leads an empty pile. */
function table(hands: CardId[][], settings: Partial<Settings> = {}, turn = 'p0'): GameState {
  const g = createGame(seatsOf(hands.length), settings, identityRng);
  g.hands = Object.fromEntries(hands.map((h, i) => [`p${i}`, sortCards(h)]));
  g.turn = turn;
  g.mustInclude = null;
  g.pile = null;
  g.passed = [];
  return g;
}

/** A finished round with the given roles, ready for nextRound. */
function afterRound(order: string[]): GameState {
  const g = createGame(seatsOf(order.length), {}, identityRng);
  g.phase = 'roundEnd';
  g.turn = null;
  g.mustInclude = null;
  g.result = order;
  g.roles = Object.fromEntries(order.map((p, i) => [p, roleForPlace(i, order.length)]));
  return g;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

// ---------------------------------------------------------------- cards
describe('cards', () => {
  it('id encoding: (rank-3)*4 + suit, ranks 3..15, suits ♣♦♥♠', () => {
    expect(makeCard(3, 0)).toBe(0);
    expect(makeCard(15, 3)).toBe(51);
    for (let id = 0; id < 52; id++) {
      expect(makeCard(rankOf(id), suitOf(id))).toBe(id);
      expect(rankOf(id)).toBeGreaterThanOrEqual(3);
      expect(rankOf(id)).toBeLessThanOrEqual(15);
    }
    expect(cardLabel(0)).toBe('3♣');
    expect(cardLabel(51)).toBe('2♠');
    expect(cardLabel(C(11, 1))).toBe('J♦');
    expect(cardLabel(C(14, 2))).toBe('A♥');
    expect(cardLabel(C(10, 3))).toBe('10♠');
  });

  it('isValidCard', () => {
    expect(isValidCard(0)).toBe(true);
    expect(isValidCard(51)).toBe(true);
    for (const bad of [-1, 52, 1.5, NaN, Infinity, '0', null, undefined, {}, []]) expect(isValidCard(bad)).toBe(false);
  });

  it('fullDeck, sortCards, shuffle, seededRng', () => {
    expect(fullDeck()).toEqual(Array.from({ length: 52 }, (_, i) => i));
    const input = [5, 1, 3];
    expect(sortCards(input)).toEqual([1, 3, 5]);
    expect(input).toEqual([5, 1, 3]);
    const deck = fullDeck();
    const sh = shuffle(deck, seededRng(42));
    expect(sh).not.toEqual(deck);
    expect(sortCards(sh)).toEqual(deck);
    expect(deck).toEqual(fullDeck());
    expect(shuffle(deck, seededRng(42))).toEqual(sh);
    const r = seededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r(6);
      expect(Number.isInteger(v) && v >= 0 && v < 6).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- combos
describe('classify', () => {
  it('sets of 1..4 same rank', () => {
    expect(classify([C(9, 2)], NO_ST)).toMatchObject({ type: 'single', size: 1, rank: 9, high: C(9, 2) });
    expect(classify([C(9, 3), C(9, 0)], NO_ST)).toMatchObject({ type: 'pair', cards: [C(9, 0), C(9, 3)], high: C(9, 3) });
    expect(classify([C(15, 0), C(15, 1), C(15, 2)], NO_ST)?.type).toBe('triple');
    expect(classify([C(3, 0), C(3, 1), C(3, 2), C(3, 3)], NO_ST)?.type).toBe('quad');
  });

  it('rejects empty, duplicates, out-of-range and non-integer ids', () => {
    expect(classify([], ST)).toBeNull();
    expect(classify([4, 4], ST)).toBeNull();
    expect(classify([0, 1, 1], ST)).toBeNull();
    expect(classify([52], ST)).toBeNull();
    expect(classify([-1], ST)).toBeNull();
    expect(classify([1.5], ST)).toBeNull();
    expect(classify(['0' as unknown as number], ST)).toBeNull();
    expect(classify([null as unknown as number], ST)).toBeNull();
  });

  it('straights: >=3 consecutive ranks, any suits, only when enabled, never with a 2', () => {
    const run3 = [C(3, 0), C(4, 3), C(5, 1)];
    expect(classify(run3, NO_ST)).toBeNull();
    expect(classify(run3, ST)).toMatchObject({ type: 'straight', size: 3, rank: 5, high: C(5, 1) });
    // 3..A (12 cards) is the longest legal straight
    const long = Array.from({ length: 12 }, (_, i) => C(3 + i, i % 4));
    expect(classify(long, ST)).toMatchObject({ type: 'straight', size: 12, rank: 14 });
    expect(classify([C(13, 0), C(14, 0), C(15, 0)], ST)).toBeNull(); // K-A-2
    expect(classify([...long, C(15, 0)], ST)).toBeNull(); // 3..2
    expect(classify([C(14, 0), C(15, 0), C(3, 0)], ST)).toBeNull(); // no wraparound
    expect(classify([C(4, 0), C(5, 0)], ST)).toBeNull(); // 2-card run is not a straight
    expect(classify([C(4, 0), C(5, 0), C(7, 0)], ST)).toBeNull(); // gap
    expect(classify([C(4, 0), C(4, 1), C(5, 0), C(6, 0)], ST)).toBeNull(); // repeated rank
    expect(classify([C(4, 0), C(4, 1), C(5, 0)], ST)).toBeNull(); // mixed pair+single
  });
});

describe('canBeat', () => {
  const one = (r: number, s: number) => classify([C(r, s)], ST)!;
  it('empty pile accepts anything', () => {
    expect(canBeat(one(3, 0), null)).toBe(true);
    expect(canBeat(one(3, 0), null, true)).toBe(true);
  });
  it('higher top card (id) wins, rank before suit', () => {
    expect(canBeat(one(4, 0), one(3, 3))).toBe(true);
    expect(canBeat(one(3, 3), one(3, 2))).toBe(true);
    expect(canBeat(one(3, 2), one(3, 3))).toBe(false);
    expect(canBeat(one(5, 0), one(5, 0))).toBe(false);
  });
  it('type and size must match (straights included)', () => {
    const s3 = classify([C(5, 0), C(6, 0), C(7, 0)], ST)!;
    const s3hi = classify([C(6, 0), C(7, 0), C(8, 0)], ST)!;
    const s4 = classify([C(6, 0), C(7, 0), C(8, 0), C(9, 0)], ST)!;
    const triple = classify([C(9, 0), C(9, 1), C(9, 2)], ST)!;
    expect(canBeat(s3hi, s3)).toBe(true);
    expect(canBeat(s3, s3hi)).toBe(false);
    expect(canBeat(s4, s3)).toBe(false);
    expect(canBeat(triple, s3)).toBe(false);
    expect(canBeat(s3hi, triple)).toBe(false);
    // same ranks, higher top suit
    expect(canBeat(classify([C(5, 0), C(6, 0), C(7, 3)], ST)!, s3)).toBe(true);
  });
  it('revolution reverses every comparison', () => {
    expect(canBeat(one(3, 0), one(15, 3), true)).toBe(true);
    expect(canBeat(one(15, 3), one(3, 0), true)).toBe(false);
    const s3 = classify([C(5, 0), C(6, 0), C(7, 0)], ST)!;
    const s3hi = classify([C(6, 0), C(7, 0), C(8, 0)], ST)!;
    expect(canBeat(s3, s3hi, true)).toBe(true);
    expect(canBeat(s3hi, s3, true)).toBe(false);
  });
});

describe('allCombos / legalMoves', () => {
  it('a quad yields 4+6+4+1 sets', () => {
    expect(allCombos([0, 1, 2, 3], NO_ST)).toHaveLength(15);
  });
  it('enumerates straights covering every possible top card', () => {
    const hand = [C(3, 0), C(4, 0), C(5, 0), C(5, 3)];
    const straights = allCombos(hand, ST).filter((c) => c.type === 'straight');
    expect(straights.map((s) => s.high).sort((a, b) => a - b)).toEqual([C(5, 0), C(5, 3)]);
    expect(allCombos(hand, NO_ST).some((c) => c.type === 'straight')).toBe(false);
  });
  it('never offers straights through a 2', () => {
    const hand = [C(13, 0), C(14, 0), C(15, 0)];
    expect(allCombos(hand, ST).some((c) => c.type === 'straight')).toBe(false);
  });
  it('mustInclude 3♣ allows a straight lead', () => {
    const hand = [C(3, 0), C(4, 1), C(5, 2), C(9, 0)];
    const moves = legalMoves(hand, { pile: null, mustInclude: 0, allowStraights: true });
    expect(moves.every((m) => m.cards.includes(0))).toBe(true);
    expect(moves.some((m) => m.type === 'straight' && m.size === 3)).toBe(true);
  });
  it('filters by pile and revolution', () => {
    const pile = classify([C(10, 0)], NO_ST)!;
    const hand = [C(4, 0), C(11, 0)];
    expect(legalMoves(hand, { pile, allowStraights: false }).map((m) => m.high)).toEqual([C(11, 0)]);
    expect(legalMoves(hand, { pile, revolution: true, allowStraights: false }).map((m) => m.high)).toEqual([C(4, 0)]);
  });
});

// ---------------------------------------------------------------- setup / dealing
describe('createGame / dealing', () => {
  it.each([3, 4, 5, 6])('%i players: all 52 dealt round-robin from seat 0', (n) => {
    const g = createGame(seatsOf(n), {}, identityRng);
    for (let k = 0; k < n; k++) {
      const expected = fullDeck().filter((c) => c % n === k);
      expect(g.hands[`p${k}`]).toEqual(expected);
    }
    expect(g.turn).toBe('p0'); // holds id 0
    expect(g.mustInclude).toBe(0);
    expect(g.round).toBe(1);
    expect(g.phase).toBe('playing');
    expect(g.settings.playerCount).toBe(n);
  });

  it('hand sizes for random deals', () => {
    const sizes: Record<number, number[]> = { 3: [18, 17, 17], 4: [13, 13, 13, 13], 5: [11, 11, 10, 10, 10], 6: [9, 9, 9, 9, 8, 8] };
    for (const n of [3, 4, 5, 6]) {
      const g = createGame(seatsOf(n), {}, seededRng(n * 13));
      expect(g.seats.map((s) => g.hands[s].length)).toEqual(sizes[n]);
      const all = Object.values(g.hands).flat();
      expect(new Set(all).size).toBe(52);
      expect(g.hands[g.turn!]).toContain(0);
      for (const s of g.seats) expect(g.hands[s]).toEqual(sortCards(g.hands[s]));
    }
  });

  it('rejects bad seat lists and applies default settings', () => {
    expect(() => createGame(['a', 'b'], {}, identityRng)).toThrow();
    expect(() => createGame(seatsOf(7), {}, identityRng)).toThrow();
    expect(() => createGame(['a', 'a', 'b'], {}, identityRng)).toThrow();
    const g = createGame(seatsOf(4), { playerCount: 9 }, identityRng);
    expect(g.settings).toEqual({ ...DEFAULT_SETTINGS, playerCount: 4 });
    expect(g.settings.passLock).toBe(true);
  });
});

// ---------------------------------------------------------------- first lead
describe('round 1 lead', () => {
  it('3♣ holder must include id 0 in any combo and cannot pass', () => {
    const g = table([[0, 1, 2, C(4, 0), C(5, 0)], [C(6, 0)], [C(7, 0)]], { allowStraights: true });
    g.mustInclude = 0;
    expect(err(g, 'p0', { type: 'play', cards: [1] })).toBe('must_include_3c');
    expect(err(g, 'p0', { type: 'play', cards: [1, 2] })).toBe('must_include_3c');
    expect(err(g, 'p0', { type: 'pass' })).toBe('cannot_pass_lead');
    expect(ok(g, 'p0', { type: 'play', cards: [0] }).mustInclude).toBeNull();
    expect(ok(g, 'p0', { type: 'play', cards: [0, 2] }).pile?.type).toBe('pair');
    expect(ok(g, 'p0', { type: 'play', cards: [0, 1, 2] }).pile?.type).toBe('triple');
    const st = ok(g, 'p0', { type: 'play', cards: [0, C(4, 0), C(5, 0)] });
    expect(st.pile?.type).toBe('straight');
    expect(st.turn).toBe('p1');
  });

  it('straight lead with 3♣ is rejected when straights are disabled', () => {
    const g = table([[0, C(4, 0), C(5, 0)], [C(6, 0)], [C(7, 0)]]);
    g.mustInclude = 0;
    expect(err(g, 'p0', { type: 'play', cards: [0, C(4, 0), C(5, 0)] })).toBe('invalid_combo');
  });

  it('real deal: first player is the 3♣ holder and other players may not act', () => {
    const g = createGame(seatsOf(5), {}, seededRng(3));
    expect(g.hands[g.turn!]).toContain(0);
    for (const s of g.seats.filter((x) => x !== g.turn)) {
      expect(err(g, s, { type: 'play', cards: [g.hands[s][0]] })).toBe('not_your_turn');
      expect(err(g, s, { type: 'pass' })).toBe('not_your_turn');
    }
  });
});

// ---------------------------------------------------------------- following
describe('following', () => {
  it('must match type and size and beat the top card', () => {
    let g = table([[C(9, 1), C(4, 0)], [C(9, 0), C(9, 3), C(10, 0), C(10, 1)], [C(12, 0)], [C(13, 0)]]);
    g = ok(g, 'p0', { type: 'play', cards: [C(9, 1)] });
    expect(err(g, 'p1', { type: 'play', cards: [C(9, 0)] })).toBe('cannot_beat');
    expect(err(g, 'p1', { type: 'play', cards: [C(10, 0), C(10, 1)] })).toBe('cannot_beat');
    expect(err(g, 'p1', { type: 'play', cards: [C(9, 0), C(10, 0)] })).toBe('invalid_combo');
    g = ok(g, 'p1', { type: 'play', cards: [C(9, 3)] });
    expect(g.pile?.high).toBe(C(9, 3));
    expect(g.lastPlayer).toBe('p1');
    expect(g.turn).toBe('p2');
  });

  it('invalid inputs', () => {
    const g = table([[C(5, 0), C(5, 1), C(7, 0)], [C(6, 0)], [C(8, 0)]]);
    const bad = (cards: unknown) => err(g, 'p0', { type: 'play', cards: cards as CardId[] });
    expect(bad('5')).toBe('invalid_combo');
    expect(bad(null)).toBe('invalid_combo');
    expect(bad(undefined)).toBe('invalid_combo');
    expect(bad({ 0: C(5, 0), length: 1 })).toBe('invalid_combo');
    expect(bad(C(5, 0))).toBe('invalid_combo');
    expect(bad([])).toBe('invalid_combo');
    expect(bad([C(5, 0), C(5, 0)])).toBe('invalid_combo');
    expect(bad([52])).toBe('invalid_combo');
    expect(bad([-4])).toBe('invalid_combo');
    expect(bad([0.5])).toBe('invalid_combo');
    expect(bad([NaN])).toBe('invalid_combo');
    expect(bad([String(C(5, 0))])).toBe('invalid_combo');
    expect(bad([C(6, 0)])).toBe('not_in_hand');
    expect(bad([C(5, 0), C(5, 2)])).toBe('not_in_hand');
    expect(err(g, 'nobody', { type: 'pass' })).toBe('unknown_player');
    expect(err(g, 'p0', { type: 'exchange', cards: [C(5, 0)] })).toBe('bad_phase');
  });
});

// ---------------------------------------------------------------- pass lock and pile clearing
describe('passing and pile clearing', () => {
  // p0 leads 4, p1 passes, p2 passes, p3 plays 6, p0 passes -> ?
  const hands = () => [[C(4, 0), C(14, 0)], [C(8, 0), C(14, 1)], [C(3, 1), C(14, 2)], [C(6, 0), C(14, 3)]];

  it('passLock on: passed players are skipped until the pile clears', () => {
    let g = table(hands());
    g = ok(g, 'p0', { type: 'play', cards: [C(4, 0)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'play', cards: [C(6, 0)] });
    expect(g.turn).toBe('p0');
    g = ok(g, 'p0', { type: 'pass' });
    // p1, p2 locked -> everyone else passed -> p3 leads a fresh pile
    expect(g.pile).toBeNull();
    expect(g.turn).toBe('p3');
    expect(g.passed).toEqual([]);
    expect(err(g, 'p3', { type: 'pass' })).toBe('cannot_pass_lead');
  });

  it('passLock on: locked player is skipped in the middle of the order', () => {
    let g = table(hands());
    g = ok(g, 'p0', { type: 'play', cards: [C(4, 0)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'play', cards: [C(6, 0)] });
    g = ok(g, 'p0', { type: 'play', cards: [C(14, 0)] });
    expect(g.turn).toBe('p3'); // p1, p2 skipped
    expect(err(g, 'p1', { type: 'play', cards: [C(14, 1)] })).toBe('not_your_turn');
  });

  it('passLock off: a player who passed may play again before the pile clears', () => {
    let g = table(hands(), { passLock: false });
    g = ok(g, 'p0', { type: 'play', cards: [C(4, 0)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'play', cards: [C(6, 0)] });
    expect(g.passed).toEqual([]);
    g = ok(g, 'p0', { type: 'pass' });
    expect(g.pile).not.toBeNull();
    expect(g.turn).toBe('p1');
    g = ok(g, 'p1', { type: 'play', cards: [C(8, 0)] });
    expect(g.lastPlayer).toBe('p1');
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'pass' });
    g = ok(g, 'p0', { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.turn).toBe('p1');
  });

  it('when the last player went out, the next active seat after them leads', () => {
    // p3 leads 4, p0 plays its last card and goes out, everyone passes -> p1 leads
    let g = table([[C(10, 0)], [C(3, 1), C(9, 0)], [C(3, 2), C(9, 1)], [C(4, 0), C(9, 2)]], {}, 'p3');
    g = ok(g, 'p3', { type: 'play', cards: [C(4, 0)] });
    g = ok(g, 'p0', { type: 'play', cards: [C(10, 0)] });
    expect(g.finished).toEqual(['p0']);
    expect(g.turn).toBe('p1');
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.turn).toBe('p1');
  });

  it('leader-after-out skips seats that already finished, even ones that passed', () => {
    // p1 already out. p0 plays out; next active after p0 is p2 (who passed earlier).
    let g = table([[C(4, 0), C(10, 0)], [], [C(3, 1), C(9, 1)], [C(5, 0), C(9, 2)]], {}, 'p0');
    g.finished = ['p1'];
    g = ok(g, 'p0', { type: 'play', cards: [C(4, 0)] });
    expect(g.turn).toBe('p2');
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'play', cards: [C(5, 0)] });
    g = ok(g, 'p0', { type: 'play', cards: [C(10, 0)] }); // out
    expect(g.turn).toBe('p3'); // p1 out, p2 locked
    g = ok(g, 'p3', { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.turn).toBe('p2');
  });

  it('a player can still beat the pile of someone who just went out', () => {
    let g = table([[C(10, 0)], [C(12, 0), C(3, 3)], [C(3, 2), C(9, 1)]]);
    g = ok(g, 'p0', { type: 'play', cards: [C(10, 0)] });
    expect(g.turn).toBe('p1');
    g = ok(g, 'p1', { type: 'play', cards: [C(12, 0)] });
    expect(g.turn).toBe('p2');
  });
});

// ---------------------------------------------------------------- revolution
describe('revolution', () => {
  const quads = () => [
    [0, 1, 2, 3, C(9, 0)].map((x) => x), // 3s quad
    [C(5, 0), C(5, 1), C(5, 2), C(5, 3), C(13, 0)],
    [C(4, 0), C(4, 1), C(4, 2), C(4, 3), C(14, 0)],
  ];

  it('quad toggles revolution; a second quad toggles it back', () => {
    let g = table(quads(), { revolution: true });
    g = ok(g, 'p0', { type: 'play', cards: [0, 1, 2, 3] });
    expect(g.revolution).toBe(true);
    expect(g.log.at(-1)).toEqual({ t: 'revolution', on: true });
    // 5s cannot beat 3s now; 4s also can't (4♠ > 3♠)... both higher. Under revolution a quad needs a lower top card.
    expect(err(g, 'p1', { type: 'play', cards: [C(5, 0), C(5, 1), C(5, 2), C(5, 3)] })).toBe('cannot_beat');
  });

  it('second quad flips back to normal order', () => {
    let g = table(
      [[C(9, 0), C(9, 1), C(9, 2), C(9, 3), C(6, 0)], [C(5, 0), C(5, 1), C(5, 2), C(5, 3), C(13, 0)], [C(3, 1), C(14, 0)]],
      { revolution: true },
    );
    g = ok(g, 'p0', { type: 'play', cards: [C(9, 0), C(9, 1), C(9, 2), C(9, 3)] });
    expect(g.revolution).toBe(true);
    g = ok(g, 'p1', { type: 'play', cards: [C(5, 0), C(5, 1), C(5, 2), C(5, 3)] }); // lower beats under revolution
    expect(g.revolution).toBe(false);
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p0', { type: 'pass' });
    expect(g.turn).toBe('p1');
    g = ok(g, 'p1', { type: 'play', cards: [C(13, 0)] });
    expect(err(g, 'p2', { type: 'play', cards: [C(3, 1)] })).toBe('cannot_beat');
    expect(ok(g, 'p2', { type: 'play', cards: [C(14, 0)] }).pile?.high).toBe(C(14, 0));
  });

  it('under revolution lower singles beat higher ones and it persists after the pile clears', () => {
    let g = table(
      [[C(9, 0), C(9, 1), C(9, 2), C(9, 3), C(6, 0)], [C(13, 0), C(4, 0)], [C(15, 3), C(3, 1)]],
      { revolution: true },
    );
    g = ok(g, 'p0', { type: 'play', cards: [C(9, 0), C(9, 1), C(9, 2), C(9, 3)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.revolution).toBe(true);
    g = ok(g, 'p0', { type: 'play', cards: [C(6, 0)] });
    expect(err(g, 'p1', { type: 'play', cards: [C(13, 0)] })).toBe('cannot_beat');
    g = ok(g, 'p1', { type: 'play', cards: [C(4, 0)] });
    expect(err(g, 'p2', { type: 'play', cards: [C(15, 3)] })).toBe('cannot_beat');
    g = ok(g, 'p2', { type: 'play', cards: [C(3, 1)] });
    expect(g.pile?.high).toBe(C(3, 1));
  });

  it('setting off: quads do not toggle', () => {
    let g = table(quads(), { revolution: false });
    g = ok(g, 'p0', { type: 'play', cards: [0, 1, 2, 3] });
    expect(g.revolution).toBe(false);
    expect(ok(g, 'p1', { type: 'play', cards: [C(5, 0), C(5, 1), C(5, 2), C(5, 3)] }).revolution).toBe(false);
  });

  it('resets at the next round', () => {
    const g = afterRound(['p0', 'p1', 'p2', 'p3']);
    g.revolution = true;
    expect(nextRound(g, identityRng).revolution).toBe(false);
  });
});

// ---------------------------------------------------------------- finishing, roles, scores
describe('finish order, roles, scores', () => {
  it('roleForPlace for 4/5/6 players', () => {
    const roles = (n: number) => Array.from({ length: n }, (_, i) => roleForPlace(i, n));
    expect(roles(4)).toEqual(['king', 'queen', 'peasant', 'slave']);
    expect(roles(5)).toEqual(['king', 'queen', 'commoner', 'peasant', 'slave']);
    expect(roles(6)).toEqual(['king', 'queen', 'commoner', 'commoner', 'peasant', 'slave']);
  });

  // Spec: "1st=king, 2nd=queen, 2nd-last=peasant (only n>=4), last=slave". Read literally, the
  // 2nd place in a 3-player game is a queen; the engine (game.ts:100 `n >= 4 && place === 1`) makes
  // them a commoner. Flagged as a spec/engine mismatch for the product owner to rule on.
  // Intended: with 3 players there is no queen/peasant pair, so 2nd place is a commoner.
  it.fails('3 players: 2nd place is queen (literal spec)', () => {
    expect([0, 1, 2].map((i) => roleForPlace(i, 3))).toEqual(['king', 'queen', 'slave']);
  });

  it('round ends with full ordering, roles and scores n-1-place', () => {
    let g = table([[C(10, 0)], [C(11, 0)], [C(3, 1), C(3, 2), C(5, 0)], [C(4, 1), C(4, 2)]]);
    g = ok(g, 'p0', { type: 'play', cards: [C(10, 0)] }); // p0 1st
    g = ok(g, 'p1', { type: 'play', cards: [C(11, 0)] }); // p1 2nd
    expect(g.turn).toBe('p2');
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'pass' });
    expect(g.turn).toBe('p2'); // next active after p1
    g = ok(g, 'p2', { type: 'play', cards: [C(3, 1), C(3, 2)] });
    g = ok(g, 'p3', { type: 'play', cards: [C(4, 1), C(4, 2)] }); // p3 3rd -> round ends
    expect(g.phase).toBe('roundEnd');
    expect(g.result).toEqual(['p0', 'p1', 'p3', 'p2']);
    expect(g.roles).toEqual({ p0: 'king', p1: 'queen', p3: 'peasant', p2: 'slave' });
    expect(g.scores).toEqual({ p0: 3, p1: 2, p3: 1, p2: 0 });
    expect(g.turn).toBeNull();
    expect(err(g, 'p2', { type: 'pass' })).toBe('bad_phase');
    expect(g.log.at(-1)).toEqual({ t: 'roundEnd', order: ['p0', 'p1', 'p3', 'p2'] });
  });

  it('noTwoFinish: going out on a 2 sends you to the bottom; first penalized is very last', () => {
    let g = table([[C(15, 0)], [C(15, 1)], [C(3, 1)], [C(4, 1), C(4, 2)]], { noTwoFinish: true });
    g = ok(g, 'p0', { type: 'play', cards: [C(15, 0)] });
    expect(g.bottom).toEqual(['p0']);
    expect(g.log.find((e) => e.t === 'finish')).toEqual({ t: 'finish', p: 'p0', place: 3, penalized: true });
    g = ok(g, 'p1', { type: 'play', cards: [C(15, 1)] });
    expect(g.bottom).toEqual(['p0', 'p1']);
    expect(g.log.filter((e) => e.t === 'finish').at(-1)).toEqual({ t: 'finish', p: 'p1', place: 2, penalized: true });
    expect(isOut(g, 'p0') && isOut(g, 'p1')).toBe(true);
    expect(activePlayers(g)).toEqual(['p2', 'p3']);
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p3', { type: 'pass' });
    expect(g.turn).toBe('p2');
    g = ok(g, 'p2', { type: 'play', cards: [C(3, 1)] });
    expect(g.phase).toBe('roundEnd');
    expect(g.result).toEqual(['p2', 'p3', 'p1', 'p0']);
    expect(g.roles.p0).toBe('slave');
    expect(g.scores).toEqual({ p2: 3, p3: 2, p1: 1, p0: 0 });
    expect(viewFor(g, 'p2').finished).toEqual(['p2', 'p1', 'p0']);
  });

  it('noTwoFinish applies to pairs of 2s; a 2 that is not the last play is fine', () => {
    let g = table([[C(15, 0), C(15, 1)], [C(3, 1), C(5, 0)], [C(3, 2), C(5, 1)]], { noTwoFinish: true });
    g = ok(g, 'p0', { type: 'play', cards: [C(15, 0), C(15, 1)] });
    expect(g.bottom).toEqual(['p0']);
    expect(g.finished).toEqual([]);

    let h = table([[C(15, 0), C(5, 3)], [C(3, 1), C(6, 0)], [C(3, 2), C(6, 1)]], { noTwoFinish: true });
    h = ok(h, 'p0', { type: 'play', cards: [C(15, 0)] });
    expect(h.bottom).toEqual([]);
  });

  it('noTwoFinish off: finishing on a 2 is a normal finish', () => {
    let g = table([[C(15, 0)], [C(3, 1), C(5, 0)], [C(3, 2), C(5, 1)]]);
    g = ok(g, 'p0', { type: 'play', cards: [C(15, 0)] });
    expect(g.finished).toEqual(['p0']);
    expect(g.bottom).toEqual([]);
  });

  it('noTwoFinish with 3 players: penalized player is last even if they went out first', () => {
    let g = table([[C(15, 0)], [C(3, 1)], [C(3, 2), C(4, 0)]], { noTwoFinish: true });
    g = ok(g, 'p0', { type: 'play', cards: [C(15, 0)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    expect(g.turn).toBe('p1');
    g = ok(g, 'p1', { type: 'play', cards: [C(3, 1)] });
    expect(g.result).toEqual(['p1', 'p2', 'p0']);
    expect(g.roles).toEqual({ p1: 'king', p2: 'commoner', p0: 'slave' });
  });

  it('scores accumulate across rounds', () => {
    let g = table([[C(10, 0)], [C(3, 1)], [C(3, 2), C(4, 0)]]);
    g.scores = { p0: 5, p1: 1, p2: 0 };
    g = ok(g, 'p0', { type: 'play', cards: [C(10, 0)] });
    g = ok(g, 'p1', { type: 'pass' });
    g = ok(g, 'p2', { type: 'pass' });
    g = ok(g, 'p1', { type: 'play', cards: [C(3, 1)] });
    expect(g.scores).toEqual({ p0: 7, p1: 2, p2: 0 });
  });
});

// ---------------------------------------------------------------- exchange
describe('nextRound and exchange', () => {
  it('throws unless the round is over', () => {
    expect(() => nextRound(createGame(seatsOf(4), {}, identityRng), identityRng)).toThrow();
  });

  it('4 players: slave gives 2 highest to king, peasant 1 highest to queen; slave leads freely', () => {
    const prev = afterRound(['p0', 'p1', 'p2', 'p3']); // king p0, queen p1, peasant p2, slave p3
    const v0 = prev.version;
    let g = nextRound(prev, identityRng);
    expect(prev.phase).toBe('roundEnd');
    expect(g.version).toBe(v0 + 1);
    expect(g.round).toBe(2);
    expect(g.phase).toBe('exchange');
    expect(g.turn).toBeNull();
    expect(g.received.p0).toEqual([47, 51]);
    expect(g.received.p1).toEqual([50]);
    expect(g.hands.p3).not.toContain(51);
    expect(g.hands.p0).toHaveLength(15);
    expect(g.hands.p1).toHaveLength(14);
    expect(g.hands.p2).toHaveLength(12);
    expect(g.hands.p3).toHaveLength(11);
    expect(g.exchanges).toEqual([
      { from: 'p0', to: 'p3', count: 2, done: false },
      { from: 'p1', to: 'p2', count: 1, done: false },
    ]);

    expect(err(g, 'p3', { type: 'play', cards: [3] })).toBe('bad_phase');
    expect(err(g, 'p0', { type: 'pass' })).toBe('bad_phase');
    expect(err(g, 'p3', { type: 'exchange', cards: [3, 7] })).toBe('no_exchange');
    expect(err(g, 'p2', { type: 'exchange', cards: [2] })).toBe('no_exchange');
    expect(err(g, 'p0', { type: 'exchange', cards: [0] })).toBe('bad_count');
    expect(err(g, 'p0', { type: 'exchange', cards: [0, 4, 8] })).toBe('bad_count');
    expect(err(g, 'p0', { type: 'exchange', cards: 'xx' as unknown as CardId[] })).toBe('bad_count');
    expect(err(g, 'p0', { type: 'exchange', cards: [0, 0] })).toBe('not_in_hand');
    expect(err(g, 'p0', { type: 'exchange', cards: [0, 1] })).toBe('not_in_hand');
    expect(err(g, 'p0', { type: 'exchange', cards: [0, 99] })).toBe('not_in_hand');

    g = ok(g, 'p1', { type: 'exchange', cards: [1] });
    expect(g.phase).toBe('exchange');
    expect(g.hands.p2).toContain(1);
    expect(g.received.p2).toEqual([1]);
    expect(viewFor(g, 'p0').pendingExchanges).toEqual(['p0']);
    expect(err(g, 'p1', { type: 'exchange', cards: [5] })).toBe('no_exchange');
    g = ok(g, 'p0', { type: 'exchange', cards: [8, 0] });
    expect(g.received.p3).toEqual([0, 8]);
    expect(g.phase).toBe('playing');
    expect(g.turn).toBe('p3');
    expect(g.mustInclude).toBeNull();
    for (const s of g.seats) expect(g.hands[s]).toHaveLength(13);
    for (const s of g.seats) expect(g.hands[s]).toEqual(sortCards(g.hands[s]));
    expect(new Set(Object.values(g.hands).flat()).size).toBe(52);
    // slave holds 3♣ but need not lead it
    expect(g.hands.p3).toContain(0);
    expect(ok(g, 'p3', { type: 'play', cards: [7] }).pile?.high).toBe(7);
  });

  it('king may return the cards just received', () => {
    let g = nextRound(afterRound(['p0', 'p1', 'p2', 'p3']), identityRng);
    g = ok(g, 'p0', { type: 'exchange', cards: [47, 51] });
    expect(g.hands.p3).toContain(51);
  });

  it('3 players: only king and slave exchange', () => {
    let g = nextRound(afterRound(['p2', 'p0', 'p1']), identityRng);
    expect(g.exchanges).toEqual([{ from: 'p2', to: 'p1', count: 2, done: false }]);
    // identity deal: p1 holds ids 1,4,7,...,49 -> gives 46, 49
    expect(g.received.p2).toEqual([46, 49]);
    expect(err(g, 'p0', { type: 'exchange', cards: [0] })).toBe('no_exchange');
    g = ok(g, 'p2', { type: 'exchange', cards: g.hands.p2.slice(0, 2) });
    expect(g.phase).toBe('playing');
    expect(g.turn).toBe('p1');
    expect(g.seats.map((s) => g.hands[s].length)).toEqual([18, 17, 17]);
  });

  it.each([5, 6])('%i players: commoners do nothing, queen/peasant and king/slave swap', (n) => {
    const order = seatsOf(n).reverse();
    let g = nextRound(afterRound(order), identityRng);
    const king = order[0], queen = order[1], peasant = order[n - 2], slave = order[n - 1];
    const before = createGame(seatsOf(n), {}, identityRng).hands;
    expect(g.received[king]).toEqual(before[slave].slice(-2));
    expect(g.received[queen]).toEqual(before[peasant].slice(-1));
    for (const c of order.slice(2, n - 2)) {
      expect(g.roles[c]).toBe('commoner');
      expect(g.hands[c]).toEqual(before[c]);
      expect(err(g, c, { type: 'exchange', cards: [g.hands[c][0]] })).toBe('no_exchange');
    }
    g = ok(g, king, { type: 'exchange', cards: g.hands[king].slice(0, 2) });
    g = ok(g, queen, { type: 'exchange', cards: g.hands[queen].slice(0, 1) });
    expect(g.phase).toBe('playing');
    expect(g.turn).toBe(slave);
    for (const s of g.seats) expect(g.hands[s]).toHaveLength(before[s].length);
  });
});

// ---------------------------------------------------------------- immutability, version, view
describe('immutability and version', () => {
  it('applyAction never mutates its input (accepted and rejected actions)', () => {
    const g = deepFreeze(table([[C(4, 0), C(14, 0)], [C(8, 0), C(14, 1)], [C(3, 1), C(14, 2)]], { revolution: true }));
    const snap = JSON.stringify(g);
    const a = ok(g, 'p0', { type: 'play', cards: [C(4, 0)] });
    ok(a, 'p1', { type: 'pass' });
    err(g, 'p0', { type: 'pass' });
    err(g, 'p1', { type: 'play', cards: [C(8, 0)] });
    expect(JSON.stringify(g)).toBe(snap);

    const ex = deepFreeze(nextRound(afterRound(['p0', 'p1', 'p2', 'p3']), identityRng));
    const exSnap = JSON.stringify(ex);
    ok(ex, 'p0', { type: 'exchange', cards: [0, 4] });
    err(ex, 'p0', { type: 'exchange', cards: [0] });
    expect(JSON.stringify(ex)).toBe(exSnap);

    const end = deepFreeze(afterRound(['p0', 'p1', 'p2']));
    const endSnap = JSON.stringify(end);
    nextRound(end, identityRng);
    expect(JSON.stringify(end)).toBe(endSnap);
  });

  it('version increments by exactly 1 per accepted action', () => {
    let g = createGame(seatsOf(4), {}, seededRng(5));
    expect(g.version).toBe(1);
    for (let i = 0; i < 30 && g.phase === 'playing'; i++) {
      const p = g.turn!;
      const v = g.version;
      g = ok(g, p, botAction(g, p)!);
      expect(g.version).toBe(v + 1);
    }
  });
});

describe('viewFor privacy', () => {
  function numberArrays(o: unknown, out: number[][] = []): number[][] {
    if (Array.isArray(o)) {
      if (o.some((x) => typeof x === 'number')) out.push(o as number[]);
      o.forEach((x) => numberArrays(x, out));
    } else if (o && typeof o === 'object') Object.values(o).forEach((x) => numberArrays(x, out));
    return out;
  }
  function assertPrivate(g: GameState) {
    for (const me of g.seats) {
      const v = viewFor(g, me);
      expect(v.myHand).toEqual(g.hands[me]);
      expect(Object.keys(v)).not.toContain('hands');
      expect(Object.keys(v)).not.toContain('exchanges');
      const others = new Set(g.seats.filter((s) => s !== me).flatMap((s) => g.hands[s]));
      // Log entries from earlier rounds name cards that were re-dealt since; only check this round's.
      const lastRound = v.log.map((e) => e.t).lastIndexOf('round');
      const scoped = { ...v, log: lastRound >= 0 ? v.log.slice(lastRound) : v.log };
      for (const arr of numberArrays(scoped)) for (const c of arr) expect(others.has(c)).toBe(false);
      for (const s of g.seats) expect(v.handCounts[s]).toBe(g.hands[s].length);
    }
  }
  it('never exposes other hands during play and exchange', () => {
    let g = createGame(seatsOf(4), {}, seededRng(9));
    assertPrivate(g);
    let guard = 0;
    while (g.phase === 'playing' && guard++ < 500) {
      g = ok(g, g.turn!, botAction(g, g.turn!)!);
      assertPrivate(g);
    }
    g = nextRound(g, seededRng(10));
    assertPrivate(g);
    const king = g.seats.find((s) => g.roles[s] === 'king')!;
    const slave = g.seats.find((s) => g.roles[s] === 'slave')!;
    expect(viewFor(g, king).received).toEqual(g.received[king]);
    expect(viewFor(g, king).myExchange).toEqual({ to: slave, count: 2 });
    expect(viewFor(g, slave).received).toBeNull();
    expect(viewFor(g, slave).myExchange).toBeNull();
    g = ok(g, king, botAction(g, king)!);
    assertPrivate(g);
    expect(viewFor(g, slave).received).toEqual(g.received[slave]);
  });
  it('unknown viewer gets an empty hand', () => {
    expect(viewFor(createGame(seatsOf(3), {}, identityRng), 'ghost').myHand).toEqual([]);
  });
});

// ---------------------------------------------------------------- bots / timeout
describe('botAction and timeoutAction', () => {
  it('return null when it is not the player move', () => {
    const g = createGame(seatsOf(4), {}, seededRng(1));
    const other = g.seats.find((s) => s !== g.turn)!;
    expect(botAction(g, other)).toBeNull();
    expect(timeoutAction(g, other)).toBeNull();
    const end = afterRound(['p0', 'p1', 'p2', 'p3']);
    expect(botAction(end, 'p0')).toBeNull();
    expect(timeoutAction(end, 'p0')).toBeNull();
  });

  it('timeout: first lead plays 3♣, follower passes, free lead plays weakest single (revolution aware)', () => {
    const g = createGame(seatsOf(4), {}, seededRng(1));
    expect(timeoutAction(g, g.turn!)).toEqual({ type: 'play', cards: [0] });
    const g2 = ok(g, g.turn!, { type: 'play', cards: [0] });
    expect(timeoutAction(g2, g2.turn!)).toEqual({ type: 'pass' });
    const t = table([[C(5, 0), C(9, 0)], [C(6, 0)], [C(7, 0)]]);
    expect(timeoutAction(t, 'p0')).toEqual({ type: 'play', cards: [C(5, 0)] });
    t.revolution = true;
    expect(timeoutAction(t, 'p0')).toEqual({ type: 'play', cards: [C(9, 0)] });
  });

  it('exchange: bot/timeout give the weakest cards; nothing for players without a task', () => {
    const g = nextRound(afterRound(['p0', 'p1', 'p2', 'p3']), identityRng);
    expect(autoExchangeCards(g, 'p0')).toEqual([0, 4]);
    expect(botAction(g, 'p0')).toEqual({ type: 'exchange', cards: [0, 4] });
    expect(timeoutAction(g, 'p1')).toEqual({ type: 'exchange', cards: [1] });
    expect(botAction(g, 'p3')).toBeNull();
    expect(timeoutAction(g, 'p2')).toBeNull();
  });

  it('bots go out when they can, and under noTwoFinish their choice is still legal', () => {
    const t = table([[C(9, 0), C(9, 1)], [C(3, 1)], [C(3, 2)]]);
    expect(botAction(t, 'p0', 'medium')).toEqual({ type: 'play', cards: [C(9, 0), C(9, 1)] });
    expect(botAction(t, 'p0', 'easy')).toEqual({ type: 'play', cards: [C(9, 0), C(9, 1)] });
    const n2 = table([[C(15, 0), C(15, 1)], [C(3, 1)], [C(3, 2)]], { noTwoFinish: true });
    // Note: both bot levels still lead the pair of 2s here and get penalized; legal, just weak play.
    for (const lvl of ['easy', 'medium'] as const) {
      const a = botAction(n2, 'p0', lvl)!;
      expect(applyAction(n2, 'p0', a).ok).toBe(true);
    }
  });

  it('bots always produce a legal action in crafted edge positions', () => {
    const cases: GameState[] = [];
    const st = table([[0, C(4, 0), C(5, 0), C(6, 0), C(6, 1), C(14, 0), C(14, 1)], [C(7, 0)], [C(8, 0)]], { allowStraights: true });
    st.mustInclude = 0;
    cases.push(st);
    const rev = table([[C(3, 1), C(3, 2), C(10, 0), C(10, 1), C(10, 2), C(15, 3)], [C(7, 0)], [C(8, 0)]], { revolution: true });
    rev.revolution = true;
    cases.push(rev);
    let piled = table([[C(5, 0), C(13, 0)], [C(6, 0), C(6, 1), C(6, 2), C(14, 3), C(4, 0), C(8, 0), C(9, 0), C(11, 0)], [C(3, 0)]]);
    piled = ok(piled, 'p0', { type: 'play', cards: [C(5, 0)] });
    cases.push(piled);
    for (const g of cases) {
      for (const lvl of ['easy', 'medium'] as const) {
        const a = botAction(g, g.turn!, lvl)!;
        expect(applyAction(g, g.turn!, a).ok).toBe(true);
      }
      expect(applyAction(g, g.turn!, timeoutAction(g, g.turn!)!).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- sparse-array input
describe('exchange input validation', () => {
  // holdsAll() uses Array.prototype.every, which skips holes, so a sparse array of the right length
  // passes validation and `undefined` is inserted into the recipient's hand (game.ts:266 / :284).
  // JSON cannot produce holes, so this is only reachable through direct API use.
  it('rejects a sparse cards array instead of injecting undefined into a hand', () => {
    const g = nextRound(afterRound(['p0', 'p1', 'p2', 'p3']), identityRng);
    const sparse: CardId[] = [0];
    sparse.length = 2; // [0, <hole>]
    const r = applyAction(g, 'p0', { type: 'exchange', cards: sparse });
    if (r.ok) {
      expect(r.state.hands.p3.every(isValidCard)).toBe(true);
    }
    expect(r.ok).toBe(false);
  });
});
