import { describe, expect, it } from 'vitest';
import {
  GameState,
  applyAction,
  botAction,
  canBeat,
  classify,
  createGame,
  legalMoves,
  makeCard,
  nextRound,
  seededRng,
  viewFor,
} from '../src';

const S = { allowStraights: false };
const C = (rank: number, suit: number) => makeCard(rank, suit);

describe('classify', () => {
  it('detects sets', () => {
    expect(classify([C(5, 0)], S)?.type).toBe('single');
    expect(classify([C(5, 0), C(5, 3)], S)?.type).toBe('pair');
    expect(classify([C(5, 0), C(5, 1), C(5, 2)], S)?.type).toBe('triple');
    expect(classify([C(5, 0), C(5, 1), C(5, 2), C(5, 3)], S)?.type).toBe('quad');
  });
  it('rejects mixed ranks, duplicates, and bad ids', () => {
    expect(classify([C(5, 0), C(6, 0)], S)).toBeNull();
    expect(classify([C(5, 0), C(5, 0)], S)).toBeNull();
    expect(classify([52], S)).toBeNull();
    expect(classify([], S)).toBeNull();
  });
  it('straights only when enabled and never with a 2', () => {
    const run = [C(5, 0), C(6, 1), C(7, 2)];
    expect(classify(run, S)).toBeNull();
    expect(classify(run, { allowStraights: true })?.type).toBe('straight');
    expect(classify([C(13, 0), C(14, 0), C(15, 0)], { allowStraights: true })).toBeNull();
    expect(classify([C(5, 0), C(7, 0), C(8, 0)], { allowStraights: true })).toBeNull();
  });
});

describe('canBeat', () => {
  it('compares rank then suit', () => {
    const p = (r: number, s: number) => classify([C(r, s)], S)!;
    expect(canBeat(p(6, 0), p(5, 3))).toBe(true);
    expect(canBeat(p(5, 3), p(5, 2))).toBe(true);
    expect(canBeat(p(5, 2), p(5, 3))).toBe(false);
    expect(canBeat(p(15, 0), p(14, 3))).toBe(true);
  });
  it('pairs compare by highest suit', () => {
    const a = classify([C(9, 0), C(9, 3)], S)!;
    const b = classify([C(9, 1), C(9, 2)], S)!;
    expect(canBeat(a, b)).toBe(true);
    expect(canBeat(b, a)).toBe(false);
  });
  it('type and size must match', () => {
    const single = classify([C(15, 3)], S)!;
    const pair = classify([C(3, 0), C(3, 1)], S)!;
    expect(canBeat(single, pair)).toBe(false);
    expect(canBeat(pair, single)).toBe(false);
  });
  it('revolution reverses', () => {
    const lo = classify([C(4, 0)], S)!;
    const hi = classify([C(10, 0)], S)!;
    expect(canBeat(lo, hi, true)).toBe(true);
    expect(canBeat(hi, lo, true)).toBe(false);
  });
});

describe('legalMoves', () => {
  it('honours mustInclude', () => {
    const hand = [C(3, 0), C(3, 1), C(9, 2)];
    const moves = legalMoves(hand, { pile: null, mustInclude: 0, allowStraights: false });
    expect(moves.every((m) => m.cards.includes(0))).toBe(true);
    expect(moves.map((m) => m.type).sort()).toEqual(['pair', 'single']);
  });
});

function game(seed = 1, settings = {}): GameState {
  return createGame(['a', 'b', 'c', 'd'], settings, seededRng(seed));
}

function mustOk(state: GameState, p: string, a: Parameters<typeof applyAction>[2]): GameState {
  const r = applyAction(state, p, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('game flow', () => {
  it('deals 13 each and the 3♣ holder leads', () => {
    const g = game();
    for (const s of g.seats) expect(g.hands[s]).toHaveLength(13);
    expect(g.hands[g.turn!]).toContain(0);
    expect(g.mustInclude).toBe(0);
  });

  it('first lead must contain 3♣', () => {
    const g = game();
    const p = g.turn!;
    const other = g.hands[p].find((c) => c !== 0)!;
    expect(applyAction(g, p, { type: 'play', cards: [other] })).toEqual({ ok: false, error: 'must_include_3c' });
    expect(applyAction(g, p, { type: 'pass' })).toEqual({ ok: false, error: 'cannot_pass_lead' });
  });

  it('rejects out of turn and cards not held', () => {
    const g = game();
    const notTurn = g.seats.find((s) => s !== g.turn)!;
    expect(applyAction(g, notTurn, { type: 'play', cards: [g.hands[notTurn][0]] })).toEqual({ ok: false, error: 'not_your_turn' });
    const foreign = g.hands[notTurn][0];
    expect(applyAction(g, g.turn!, { type: 'play', cards: [0, foreign] }).ok).toBe(false);
    expect(applyAction(g, 'zzz', { type: 'pass' })).toEqual({ ok: false, error: 'unknown_player' });
  });

  it('clears the pile when everyone else passes', () => {
    let g = game();
    const leader = g.turn!;
    g = mustOk(g, leader, { type: 'play', cards: [0] });
    for (let i = 0; i < 3; i++) g = mustOk(g, g.turn!, { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.turn).toBe(leader);
  });

  it('pass lock skips passed players', () => {
    let g = game(3);
    const order = g.seats;
    const leader = g.turn!;
    g = mustOk(g, leader, { type: 'play', cards: [0] });
    const second = g.turn!;
    g = mustOk(g, second, { type: 'pass' });
    // third beats, fourth passes, leader beats if possible -> second must be skipped.
    const third = g.turn!;
    const beat = legalMoves(g.hands[third], { pile: g.pile, allowStraights: false })[0];
    g = mustOk(g, third, { type: 'play', cards: beat.cards });
    const fourth = g.turn!;
    g = mustOk(g, fourth, { type: 'pass' });
    expect(g.turn).toBe(leader);
    g = mustOk(g, leader, { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.turn).toBe(third);
    expect(order).toHaveLength(4);
  });

  it('view hides other hands', () => {
    const g = game();
    const v = viewFor(g, 'a');
    expect(v.myHand).toEqual(g.hands.a);
    expect(JSON.stringify(v)).not.toContain('"hands"');
    expect(v.handCounts.b).toBe(13);
  });
});

function playOut(g: GameState, guard = 2000): GameState {
  while (g.phase !== 'roundEnd' && guard-- > 0) {
    const p = g.phase === 'exchange' ? g.exchanges.find((t) => !t.done)!.from : g.turn!;
    const a = botAction(g, p)!;
    g = mustOk(g, p, a);
  }
  if (g.phase !== 'roundEnd') throw new Error('stuck');
  return g;
}

describe('rounds and exchange', () => {
  it('plays a full round, assigns roles and scores', () => {
    const g = playOut(game(7));
    expect(g.result).toHaveLength(4);
    expect(new Set(Object.values(g.roles))).toEqual(new Set(['king', 'queen', 'peasant', 'slave']));
    expect(Object.values(g.scores).sort()).toEqual([0, 1, 2, 3]);
  });

  it('exchange moves best cards up and the slave leads', () => {
    let g = playOut(game(11));
    g = nextRound(g, seededRng(99));
    expect(g.phase).toBe('exchange');
    const king = g.seats.find((s) => g.roles[s] === 'king')!;
    const slave = g.seats.find((s) => g.roles[s] === 'slave')!;
    expect(g.hands[king]).toHaveLength(15);
    expect(g.hands[slave]).toHaveLength(11);
    expect(Math.max(...g.received[king])).toBeGreaterThanOrEqual(Math.max(...g.hands[slave]));
    expect(applyAction(g, king, { type: 'exchange', cards: [g.hands[king][0]] })).toEqual({ ok: false, error: 'bad_count' });
    g = mustOk(g, king, { type: 'exchange', cards: g.hands[king].slice(0, 2) });
    const queen = g.seats.find((s) => g.roles[s] === 'queen')!;
    g = mustOk(g, queen, { type: 'exchange', cards: g.hands[queen].slice(0, 1) });
    expect(g.phase).toBe('playing');
    expect(g.turn).toBe(slave);
    expect(g.mustInclude).toBeNull();
    for (const s of g.seats) expect(g.hands[s]).toHaveLength(13);
  });

  it('works for 3, 5 and 6 players', () => {
    for (const n of [3, 5, 6]) {
      const seats = Array.from({ length: n }, (_, i) => `p${i}`);
      let g = createGame(seats, {}, seededRng(n));
      expect(Object.values(g.hands).flat()).toHaveLength(52);
      g = playOut(g);
      g = playOut(nextRound(g, seededRng(n + 1)));
      expect(g.result).toHaveLength(n);
    }
  });
});
