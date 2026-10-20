import { CardId, RANK_TWO, Rng, THREE_OF_CLUBS, fullDeck, shuffle, sortCards } from './cards';
import { Combo, canBeat, classify } from './combos';

export interface Settings {
  /** Seats at the table, 3..6. */
  playerCount: number;
  /** A player who passes cannot play again until the pile is cleared. */
  passLock: boolean;
  allowStraights: boolean;
  /** Playing a quad flips the card order until the round ends. */
  revolution: boolean;
  /** Finishing with a 2 in the last play sends the player to the bottom of the order. */
  noTwoFinish: boolean;
  /** Seconds per turn; enforced by the server, not the engine. */
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  playerCount: 4,
  passLock: true,
  allowStraights: false,
  revolution: false,
  noTwoFinish: false,
  turnSeconds: 20,
};

export type Role = 'king' | 'queen' | 'commoner' | 'peasant' | 'slave';
export type Phase = 'exchange' | 'playing' | 'roundEnd';

/** `from` (the higher role) must hand `count` cards of their choice to `to`. */
export interface ExchangeTask {
  from: string;
  to: string;
  count: number;
  done: boolean;
}

export type LogEntry =
  | { t: 'round'; round: number }
  | { t: 'play'; p: string; cards: CardId[]; combo: Combo['type'] }
  | { t: 'pass'; p: string }
  | { t: 'clear'; next: string }
  | { t: 'finish'; p: string; place: number; penalized: boolean }
  | { t: 'revolution'; on: boolean }
  | { t: 'exchange'; from: string; to: string; count: number }
  | { t: 'roundEnd'; order: string[] };

export interface GameState {
  settings: Settings;
  seats: string[];
  hands: Record<string, CardId[]>;
  phase: Phase;
  round: number;
  turn: string | null;
  pile: Combo | null;
  lastPlayer: string | null;
  passed: string[];
  finished: string[];
  /** Players who finished with a forbidden card (noTwoFinish); ranked below everyone. */
  bottom: string[];
  revolution: boolean;
  mustInclude: CardId | null;
  /** Titles earned in the previous round; empty in round 1. */
  roles: Record<string, Role>;
  exchanges: ExchangeTask[];
  /** Cards each player received during the current exchange, for display. */
  received: Record<string, CardId[]>;
  scores: Record<string, number>;
  /** Final order of the last finished round. */
  result: string[] | null;
  /** Increments on every accepted action; clients echo it to reject stale or duplicate input. */
  version: number;
  log: LogEntry[];
}

export type Action =
  | { type: 'play'; cards: CardId[] }
  | { type: 'pass' }
  | { type: 'exchange'; cards: CardId[] };

export type ActionError =
  | 'bad_phase'
  | 'not_your_turn'
  | 'not_in_hand'
  | 'invalid_combo'
  | 'cannot_beat'
  | 'must_include_3c'
  | 'cannot_pass_lead'
  | 'no_exchange'
  | 'bad_count'
  | 'unknown_player';

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: ActionError };

const LOG_LIMIT = 200;

export function roleForPlace(place: number, n: number): Role {
  if (place === 0) return 'king';
  if (place === n - 1) return 'slave';
  if (n >= 4 && place === 1) return 'queen';
  if (n >= 4 && place === n - 2) return 'peasant';
  return 'commoner';
}

export function createGame(seats: string[], settings: Partial<Settings>, rng: Rng): GameState {
  if (seats.length < 3 || seats.length > 6) throw new Error('need 3..6 players');
  if (new Set(seats).size !== seats.length) throw new Error('duplicate player ids');
  const state: GameState = {
    settings: { ...DEFAULT_SETTINGS, ...settings, playerCount: seats.length },
    seats: [...seats],
    hands: {},
    phase: 'playing',
    round: 0,
    turn: null,
    pile: null,
    lastPlayer: null,
    passed: [],
    finished: [],
    bottom: [],
    revolution: false,
    mustInclude: null,
    roles: {},
    exchanges: [],
    received: {},
    scores: Object.fromEntries(seats.map((s) => [s, 0])),
    result: null,
    version: 0,
    log: [],
  };
  startRound(state, rng);
  return state;
}

/** Starts the next round after `roundEnd`. Returns a new state. */
export function nextRound(prev: GameState, rng: Rng): GameState {
  if (prev.phase !== 'roundEnd') throw new Error('round not finished');
  const state = structuredClone(prev);
  startRound(state, rng);
  return state;
}

function pushLog(state: GameState, entry: LogEntry) {
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function startRound(state: GameState, rng: Rng) {
  const n = state.seats.length;
  state.round += 1;
  state.pile = null;
  state.lastPlayer = null;
  state.passed = [];
  state.finished = [];
  state.bottom = [];
  state.revolution = false;
  state.exchanges = [];
  state.received = {};
  state.version += 1;
  pushLog(state, { t: 'round', round: state.round });

  const deck = shuffle(fullDeck(), rng);
  const hands: Record<string, CardId[]> = Object.fromEntries(state.seats.map((s) => [s, []]));
  deck.forEach((card, i) => hands[state.seats[i % n]].push(card));
  for (const s of state.seats) hands[s] = sortCards(hands[s]);
  state.hands = hands;

  const byRole = (role: Role) => state.seats.find((s) => state.roles[s] === role);
  const king = byRole('king');
  const slave = byRole('slave');

  if (!king || !slave) {
    state.phase = 'playing';
    state.mustInclude = THREE_OF_CLUBS;
    state.turn = state.seats.find((s) => hands[s].includes(THREE_OF_CLUBS))!;
    return;
  }

  // Lower roles hand over their best cards automatically; higher roles then choose what to return.
  const pairs: [string, string, number][] = [[king, slave, 2]];
  const queen = byRole('queen');
  const peasant = byRole('peasant');
  if (queen && peasant) pairs.push([queen, peasant, 1]);

  for (const [high, low, count] of pairs) {
    const best = hands[low].slice(-count);
    hands[low] = hands[low].slice(0, -count);
    hands[high] = sortCards([...hands[high], ...best]);
    state.received[high] = best;
    state.exchanges.push({ from: high, to: low, count, done: false });
  }
  state.phase = 'exchange';
  state.turn = null;
  state.mustInclude = null;
}

export function isOut(state: GameState, p: string): boolean {
  return state.finished.includes(p) || state.bottom.includes(p);
}

export function activePlayers(state: GameState): string[] {
  return state.seats.filter((s) => !isOut(state, s));
}

function nextActiveAfter(state: GameState, from: string): string {
  const n = state.seats.length;
  const idx = state.seats.indexOf(from);
  for (let i = 1; i <= n; i++) {
    const s = state.seats[(idx + i) % n];
    if (!isOut(state, s)) return s;
  }
  throw new Error('no active players');
}

function clearPile(state: GameState, leader: string) {
  state.pile = null;
  state.passed = [];
  state.turn = leader;
  pushLog(state, { t: 'clear', next: leader });
}

/** Moves the turn on after `from` acted, clearing the pile when everyone else has passed. */
function advance(state: GameState, from: string) {
  const active = activePlayers(state);
  const lp = state.lastPlayer!;
  const lpActive = active.includes(lp);
  const others = active.filter((s) => s !== lp);

  if (others.every((s) => state.passed.includes(s))) {
    clearPile(state, lpActive ? lp : nextActiveAfter(state, lp));
    return;
  }

  const n = state.seats.length;
  const idx = state.seats.indexOf(from);
  for (let i = 1; i <= n; i++) {
    const s = state.seats[(idx + i) % n];
    if (isOut(state, s)) continue;
    if (s === lp) {
      clearPile(state, lp);
      return;
    }
    if (state.settings.passLock && state.passed.includes(s)) continue;
    state.turn = s;
    return;
  }
  clearPile(state, nextActiveAfter(state, lp));
}

function endRound(state: GameState) {
  const remaining = activePlayers(state);
  const order = [...state.finished, ...remaining, ...[...state.bottom].reverse()];
  const n = order.length;
  state.result = order;
  state.roles = Object.fromEntries(order.map((p, i) => [p, roleForPlace(i, n)]));
  order.forEach((p, i) => (state.scores[p] += n - 1 - i));
  state.phase = 'roundEnd';
  state.turn = null;
  state.pile = null;
  state.lastPlayer = null;
  state.passed = [];
  state.mustInclude = null;
  pushLog(state, { t: 'roundEnd', order });
}

function holdsAll(hand: readonly CardId[], cards: readonly CardId[]): boolean {
  return new Set(cards).size === cards.length && cards.every((c) => hand.includes(c));
}

/** Validates and applies one action. Never mutates `prev`. */
export function applyAction(prev: GameState, player: string, action: Action): ActionResult {
  if (!prev.seats.includes(player)) return { ok: false, error: 'unknown_player' };
  const state = structuredClone(prev);
  const hand = state.hands[player];

  if (action.type === 'exchange') {
    if (state.phase !== 'exchange') return { ok: false, error: 'bad_phase' };
    const task = state.exchanges.find((t) => t.from === player && !t.done);
    if (!task) return { ok: false, error: 'no_exchange' };
    if (!Array.isArray(action.cards) || action.cards.length !== task.count) {
      return { ok: false, error: 'bad_count' };
    }
    if (!holdsAll(hand, action.cards)) return { ok: false, error: 'not_in_hand' };
    state.hands[player] = hand.filter((c) => !action.cards.includes(c));
    state.hands[task.to] = sortCards([...state.hands[task.to], ...action.cards]);
    state.received[task.to] = sortCards(action.cards);
    task.done = true;
    pushLog(state, { t: 'exchange', from: player, to: task.to, count: task.count });
    if (state.exchanges.every((t) => t.done)) {
      const slave = state.seats.find((s) => state.roles[s] === 'slave')!;
      state.phase = 'playing';
      state.turn = slave;
    }
    state.version += 1;
    return { ok: true, state };
  }

  if (state.phase !== 'playing') return { ok: false, error: 'bad_phase' };
  if (state.turn !== player) return { ok: false, error: 'not_your_turn' };

  if (action.type === 'pass') {
    if (!state.pile) return { ok: false, error: 'cannot_pass_lead' };
    if (!state.passed.includes(player)) state.passed.push(player);
    pushLog(state, { t: 'pass', p: player });
    advance(state, player);
    state.version += 1;
    return { ok: true, state };
  }

  if (!Array.isArray(action.cards)) return { ok: false, error: 'invalid_combo' };
  const combo = classify(action.cards, state.settings);
  if (!combo) return { ok: false, error: 'invalid_combo' };
  if (!holdsAll(hand, combo.cards)) return { ok: false, error: 'not_in_hand' };
  if (state.mustInclude != null && !combo.cards.includes(state.mustInclude)) {
    return { ok: false, error: 'must_include_3c' };
  }
  if (!canBeat(combo, state.pile, state.revolution)) return { ok: false, error: 'cannot_beat' };

  state.hands[player] = hand.filter((c) => !combo.cards.includes(c));
  state.pile = combo;
  state.lastPlayer = player;
  state.mustInclude = null;
  if (!state.settings.passLock) state.passed = [];
  pushLog(state, { t: 'play', p: player, cards: combo.cards, combo: combo.type });

  if (state.settings.revolution && combo.type === 'quad') {
    state.revolution = !state.revolution;
    pushLog(state, { t: 'revolution', on: state.revolution });
  }

  if (state.hands[player].length === 0) {
    const penalized = state.settings.noTwoFinish && combo.rank === RANK_TWO;
    if (penalized) state.bottom.push(player);
    else state.finished.push(player);
    pushLog(state, {
      t: 'finish',
      p: player,
      place: penalized ? state.seats.length - state.bottom.length : state.finished.length - 1,
      penalized,
    });
  }

  if (activePlayers(state).length <= 1) endRound(state);
  else advance(state, player);

  state.version += 1;
  return { ok: true, state };
}

/** What one player is allowed to see. Other hands are reduced to card counts. */
export interface PlayerView {
  you: string;
  settings: Settings;
  seats: string[];
  phase: Phase;
  round: number;
  turn: string | null;
  pile: Combo | null;
  lastPlayer: string | null;
  passed: string[];
  finished: string[];
  revolution: boolean;
  mustInclude: CardId | null;
  roles: Record<string, Role>;
  handCounts: Record<string, number>;
  myHand: CardId[];
  /** Exchange this player still has to make, if any. */
  myExchange: { to: string; count: number } | null;
  /** Players still choosing cards to give back. */
  pendingExchanges: string[];
  received: CardId[] | null;
  scores: Record<string, number>;
  result: string[] | null;
  version: number;
  log: LogEntry[];
}

export function viewFor(state: GameState, player: string): PlayerView {
  const task = state.exchanges.find((t) => t.from === player && !t.done);
  return {
    you: player,
    settings: state.settings,
    seats: state.seats,
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    pile: state.pile,
    lastPlayer: state.lastPlayer,
    passed: state.passed,
    finished: [...state.finished, ...[...state.bottom].reverse()],
    revolution: state.revolution,
    mustInclude: state.mustInclude,
    roles: state.roles,
    handCounts: Object.fromEntries(state.seats.map((s) => [s, state.hands[s].length])),
    myHand: state.hands[player] ?? [],
    myExchange: task ? { to: task.to, count: task.count } : null,
    pendingExchanges: state.exchanges.filter((t) => !t.done).map((t) => t.from),
    received: state.received[player] ?? null,
    scores: state.scores,
    result: state.result,
    version: state.version,
    log: state.log.slice(-40),
  };
}
