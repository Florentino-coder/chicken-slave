import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GameState,
  applyAction,
  botAction,
  canBeat,
  classify,
  createGame,
  isBomb,
  legalMoves,
  makeCard,
  nextRound,
  seededRng,
  viewFor,
} from '../src';

const S = { allowStraights: false };
const C = (rank: number, suit: number) => makeCard(rank, suit);
const combo = (...cards: number[]) => classify(cards, S)!;

const single2 = combo(C(15, 3));
const singleLow = combo(C(3, 0));
const pairAces = combo(C(14, 0), C(14, 3));
const triple4 = combo(C(4, 0), C(4, 1), C(4, 3));
const triple9 = combo(C(9, 0), C(9, 1), C(9, 2));
const quad5 = combo(C(5, 0), C(5, 1), C(5, 2), C(5, 3));
const quad8 = combo(C(8, 0), C(8, 1), C(8, 2), C(8, 3));

describe('bomb rule', () => {
  it('is on by default', () => {
    expect(DEFAULT_SETTINGS.bombs).toBe(true);
  });

  it('any triple cuts any single, including a 2', () => {
    expect(canBeat(triple4, single2, false, true)).toBe(true);
    expect(canBeat(triple4, singleLow, false, true)).toBe(true);
    expect(isBomb(triple4, single2, true)).toBe(true);
  });

  it('a triple cannot cut a pair; only a quad can', () => {
    expect(canBeat(triple9, pairAces, false, true)).toBe(false);
    expect(canBeat(quad5, pairAces, false, true)).toBe(true);
    expect(isBomb(quad5, pairAces, true)).toBe(true);
  });

  it('a quad does not cut a single', () => {
    expect(canBeat(quad5, single2, false, true)).toBe(false);
  });

  it('after a bomb the pile follows normal rules for that combo', () => {
    // pile is now a triple: only a higher triple beats it, no single and no quad
    expect(canBeat(triple9, triple4, false, true)).toBe(true);
    expect(canBeat(triple4, triple9, false, true)).toBe(false);
    expect(canBeat(single2, triple4, false, true)).toBe(false);
    expect(canBeat(quad8, triple4, false, true)).toBe(false);
    expect(canBeat(quad8, quad5, false, true)).toBe(true);
    expect(isBomb(triple9, triple4, true)).toBe(false);
  });

  it('bombs ignore revolution order', () => {
    expect(canBeat(triple9, singleLow, true, true)).toBe(true);
    expect(canBeat(quad8, pairAces, true, true)).toBe(true);
  });

  it('does nothing when disabled', () => {
    expect(canBeat(triple4, single2, false, false)).toBe(false);
    expect(canBeat(quad5, pairAces, false, false)).toBe(false);
    expect(isBomb(triple4, single2, false)).toBe(false);
  });

  it('legalMoves offers bombs only when enabled', () => {
    const hand = [C(4, 0), C(4, 1), C(4, 3), C(6, 0)];
    const on = legalMoves(hand, { pile: single2, allowStraights: false, bombs: true });
    expect(on.map((m) => m.type)).toEqual(['triple']);
    expect(legalMoves(hand, { pile: single2, allowStraights: false, bombs: false })).toEqual([]);
  });
});

/** Builds a playing state with chosen hands; bypasses dealing. */
function table(hands: Record<string, number[]>, settings = {}): GameState {
  const seats = Object.keys(hands);
  const g = createGame(seats, settings, seededRng(1));
  g.hands = Object.fromEntries(Object.entries(hands).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
  g.turn = seats[0];
  g.mustInclude = null;
  return g;
}

function ok(g: GameState, p: string, a: Parameters<typeof applyAction>[2]) {
  const r = applyAction(g, p, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('bombs in a game', () => {
  const hands = {
    a: [C(15, 3), C(3, 0), C(3, 1)],
    b: [C(4, 0), C(4, 1), C(4, 3), C(10, 0)],
    c: [C(9, 0), C(9, 1), C(9, 2), C(11, 0)],
    d: [C(12, 0), C(12, 1), C(13, 0)],
  };

  it('a triple cuts a 2 and is logged as a bomb', () => {
    let g = table(hands);
    g = ok(g, 'a', { type: 'play', cards: [C(15, 3)] });
    g = ok(g, 'b', { type: 'play', cards: [C(4, 0), C(4, 1), C(4, 3)] });
    expect(g.pile?.type).toBe('triple');
    expect(g.trick.map((t) => t.bomb)).toEqual([false, true]);
    const last = g.log[g.log.length - 1];
    expect(last.t === 'play' && last.bomb).toBe(true);
    // c follows with a higher triple; a single is no longer allowed
    expect(applyAction(g, 'c', { type: 'play', cards: [C(11, 0)] })).toEqual({ ok: false, error: 'cannot_beat' });
    g = ok(g, 'c', { type: 'play', cards: [C(9, 0), C(9, 1), C(9, 2)] });
    expect(g.trick).toHaveLength(3);
    expect(g.trick[2].bomb).toBe(false);
  });

  it('rejects a triple on a pair', () => {
    let g = table({ ...hands, a: [C(14, 0), C(14, 3), C(3, 0)] });
    g = ok(g, 'a', { type: 'play', cards: [C(14, 0), C(14, 3)] });
    expect(applyAction(g, 'b', { type: 'play', cards: [C(4, 0), C(4, 1), C(4, 3)] })).toEqual({ ok: false, error: 'cannot_beat' });
  });

  it('rejects bombs when the rule is off', () => {
    let g = table(hands, { bombs: false });
    g = ok(g, 'a', { type: 'play', cards: [C(15, 3)] });
    expect(applyAction(g, 'b', { type: 'play', cards: [C(4, 0), C(4, 1), C(4, 3)] })).toEqual({ ok: false, error: 'cannot_beat' });
  });
});

describe('trick history', () => {
  it('collects plays and clears when everyone passes', () => {
    let g = createGame(['a', 'b', 'c', 'd'], {}, seededRng(5));
    expect(g.trick).toEqual([]);
    const leader = g.turn!;
    g = ok(g, leader, { type: 'play', cards: [0] });
    expect(g.trick).toEqual([{ p: leader, cards: [0], bomb: false }]);
    for (let i = 0; i < 3; i++) g = ok(g, g.turn!, { type: 'pass' });
    expect(g.pile).toBeNull();
    expect(g.trick).toEqual([]);
  });

  it('clears when the last player went out and the rest pass', () => {
    let g = table({ a: [C(15, 3)], b: [C(5, 0), C(6, 0)], c: [C(7, 0), C(8, 0)], d: [C(9, 0), C(10, 0)] });
    g = ok(g, 'a', { type: 'play', cards: [C(15, 3)] });
    expect(g.finished).toEqual(['a']);
    expect(g.trick).toHaveLength(1);
    for (let i = 0; i < 3; i++) g = ok(g, g.turn!, { type: 'pass' });
    expect(g.trick).toEqual([]);
    expect(g.turn).toBe('b');
  });

  it('starts empty each round and is visible in the player view', () => {
    let g = createGame(['a', 'b', 'c', 'd'], {}, seededRng(9));
    g = ok(g, g.turn!, { type: 'play', cards: [0] });
    const v = viewFor(g, 'a');
    expect(v.trick).toEqual(g.trick);
    v.trick[0].cards.push(51);
    expect(g.trick[0].cards).toEqual([0]);

    let guard = 0;
    while (g.phase !== 'roundEnd' && guard++ < 2000) g = ok(g, g.turn!, botAction(g, g.turn!)!);
    expect(g.trick).toEqual([]);
    g = nextRound(g, seededRng(10));
    expect(g.trick).toEqual([]);
  });
});

describe('bots and bombs', () => {
  it('a medium bot keeps its triple instead of bombing an early low single', () => {
    let g = table({
      a: [C(5, 0), C(6, 0), C(7, 0), C(8, 0), C(9, 0), C(10, 0), C(11, 1)],
      b: [C(4, 0), C(4, 1), C(4, 3), C(6, 1), C(7, 1), C(8, 1), C(10, 1), C(12, 1)],
      c: [C(9, 1), C(9, 2), C(11, 0), C(12, 0), C(13, 0), C(13, 1), C(14, 0)],
      d: [C(12, 2), C(12, 3), C(13, 2), C(13, 3), C(14, 1), C(14, 2), C(15, 0)],
    });
    g = ok(g, 'a', { type: 'play', cards: [C(5, 0)] });
    const a = botAction(g, 'b', 'medium')!;
    expect(a.type).toBe('play');
    expect(a.type === 'play' && a.cards).toHaveLength(1);
  });

  it('a medium bot bombs a 2 when it has no normal answer', () => {
    let g = table({
      a: [C(15, 3), C(5, 0), C(6, 0), C(7, 0), C(8, 0)],
      b: [C(4, 0), C(4, 1), C(4, 3), C(6, 1), C(7, 1)],
      c: [C(9, 1), C(9, 2), C(11, 0), C(12, 0), C(13, 0)],
      d: [C(12, 2), C(12, 3), C(13, 2), C(13, 3), C(14, 1)],
    });
    g = ok(g, 'a', { type: 'play', cards: [C(15, 3)] });
    const a = botAction(g, 'b', 'medium')!;
    expect(a).toEqual({ type: 'play', cards: [C(4, 0), C(4, 1), C(4, 3)] });
  });
});
