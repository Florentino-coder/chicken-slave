import {
  Action,
  BotLevel,
  CardId,
  GameState,
  Settings,
  activePlayers,
  applyAction,
  botAction,
  createGame,
  isOut,
  isValidCard,
  nextRound,
  roleForPlace,
  seededRng,
  timeoutAction,
} from '../src';

/**
 * Randomised whole-game simulation. Every move is chosen by a bot (or occasionally the timeout
 * fallback) and every resulting state is checked against the rule invariants.
 */
const MAX_ACTIONS_PER_ROUND = 2000;

function fail(msg: string, ctx: unknown): never {
  throw new Error(`${msg}\n${JSON.stringify(ctx)}`);
}

function checkState(g: GameState, played: Set<CardId>, ctx: unknown) {
  const seen = new Set<CardId>(played);
  let total = played.size;
  for (const s of g.seats) {
    const h = g.hands[s];
    for (let i = 0; i < h.length; i++) {
      const c = h[i];
      if (!isValidCard(c)) fail(`invalid card ${c} in ${s}`, ctx);
      if (i > 0 && h[i - 1] >= c) fail(`hand of ${s} not strictly sorted`, ctx);
      if (seen.has(c)) fail(`duplicate card ${c}`, ctx);
      seen.add(c);
    }
    total += h.length;
  }
  if (total !== 52 || seen.size !== 52) fail(`card conservation broken: ${total}`, ctx);

  for (const s of g.finished) if (g.bottom.includes(s)) fail('finished and bottom overlap', ctx);
  for (const s of g.seats) {
    const out = isOut(g, s);
    if (g.phase === 'playing' && out !== (g.hands[s].length === 0)) fail(`out/empty-hand mismatch for ${s}`, ctx);
  }
  if (!g.settings.revolution && g.revolution) fail('revolution on while disabled', ctx);

  if (g.phase === 'playing') {
    const t = g.turn;
    if (t == null || !g.seats.includes(t)) fail('no turn while playing', ctx);
    if (isOut(g, t)) fail(`turn on finished player ${t}`, ctx);
    if (activePlayers(g).length < 2) fail('playing with < 2 active players', ctx);
    if (g.settings.passLock && g.pile && g.passed.includes(t)) fail('turn on pass-locked player', ctx);
    if (g.pile) for (const c of g.pile.cards) if (!played.has(c)) fail('pile card not marked played', ctx);
    if (!g.pile && g.passed.length) fail('passed list not cleared with pile', ctx);
    if (g.mustInclude != null && !g.hands[t].includes(g.mustInclude)) fail('mustInclude not in leader hand', ctx);
  } else if (g.phase === 'exchange') {
    if (g.turn !== null) fail('turn set during exchange', ctx);
  } else if (g.turn !== null) fail('turn set at round end', ctx);
}

export interface Stats {
  games: number;
  rounds: number;
  actions: number;
  revolutions: number;
  penalized: number;
  straights: number;
}

export function simulateGame(seed: number, stats: Stats) {
  const rng = seededRng(seed);
  const n = 3 + rng(4);
  const settings: Partial<Settings> = {
    passLock: rng(4) !== 0,
    allowStraights: rng(2) === 0,
    revolution: rng(2) === 0,
    noTwoFinish: rng(2) === 0,
  };
  const seats = Array.from({ length: n }, (_, i) => `s${i}`);
  const level: Record<string, BotLevel> = Object.fromEntries(seats.map((s) => [s, rng(2) ? 'easy' : 'medium']));
  const rounds = rng(5) === 0 ? 3 : 2;

  let g = createGame(seats, settings, seededRng(seed * 7919 + 1));
  for (let r = 1; r <= rounds; r++) {
    const ctx = () => ({ seed, n, settings, round: r, version: g.version, log: g.log.slice(-12) });
    if (r > 1) {
      const prev = g;
      g = nextRound(g, seededRng(seed * 31 + r));
      if (g.version !== prev.version + 1) fail('nextRound version', ctx());
      checkExchangeStart(g, n, ctx());
    }
    if (g.round !== r) fail('round counter', ctx());
    const played = new Set<CardId>();
    const scoresBefore = { ...g.scores };
    checkState(g, played, ctx());

    let actions = 0;
    while (g.phase !== 'roundEnd') {
      if (++actions > MAX_ACTIONS_PER_ROUND) fail('round stalled', ctx());
      let p: string;
      if (g.phase === 'exchange') {
        const pending = g.exchanges.filter((t) => !t.done);
        p = pending[rng(pending.length)].from;
      } else p = g.turn!;

      const useTimeout = rng(10) === 0;
      const action: Action | null = useTimeout ? timeoutAction(g, p) : botAction(g, p, level[p]);
      if (!action) fail(`${useTimeout ? 'timeout' : 'bot'} returned null on its move (${p})`, ctx());

      const snapshot = actions % 64 === 0 ? JSON.stringify(g) : null;
      let res;
      try {
        res = applyAction(g, p, action);
      } catch (e) {
        fail(`applyAction threw: ${(e as Error).message}`, { ...ctx(), p, action });
      }
      if (!res.ok) fail(`illegal ${useTimeout ? 'timeout' : level[p]} action: ${res.error}`, { ...ctx(), p, action });
      if (snapshot !== null && JSON.stringify(g) !== snapshot) fail('applyAction mutated its input', ctx());
      if (res.state.version !== g.version + 1) fail('version did not increment by 1', ctx());

      const next = res.state;
      if (action.type === 'play') {
        for (const c of action.cards) played.add(c);
        if (next.pile && next.pile.type === 'straight') stats.straights++;
        if (next.revolution !== g.revolution) stats.revolutions++;
      }
      g = next;
      stats.actions++;
      checkState(g, played, { ...ctx(), p, action });
    }

    // Round result: full ordering, roles and scores.
    const order = g.result!;
    if (!order || order.length !== n || new Set(order).size !== n || !order.every((s) => seats.includes(s))) {
      fail('round result is not a full ordering of seats', ctx());
    }
    stats.penalized += g.bottom.length;
    const tail = [...g.bottom].reverse();
    if (JSON.stringify(order.slice(n - tail.length)) !== JSON.stringify(tail)) fail('penalized players not at bottom', ctx());
    if (JSON.stringify(order.slice(0, g.finished.length)) !== JSON.stringify(g.finished)) fail('finishers out of order', ctx());
    order.forEach((s, i) => {
      if (g.roles[s] !== roleForPlace(i, n)) fail(`role mismatch for ${s}`, ctx());
      if (g.scores[s] - scoresBefore[s] !== n - 1 - i) fail(`score mismatch for ${s}`, ctx());
    });
    const survivors = seats.filter((s) => g.hands[s].length > 0);
    if (survivors.length !== 1 || survivors[0] !== order[g.finished.length]) fail('exactly the last active player keeps cards', ctx());
    stats.rounds++;
  }
  stats.games++;
}

function checkExchangeStart(g: GameState, n: number, ctx: unknown) {
  const by = (role: string) => g.seats.filter((s) => g.roles[s] === role);
  const [king] = by('king');
  const [slave] = by('slave');
  if (!king || !slave || by('king').length !== 1 || by('slave').length !== 1) fail('king/slave missing', ctx);
  if (g.phase !== 'exchange') fail('round 2+ must start in exchange', ctx);
  const expectedTasks = n >= 4 ? 2 : 1;
  if (g.exchanges.length !== expectedTasks) fail('wrong number of exchange tasks', ctx);
  // Slave's two best went to the king: everything left in the slave's hand is lower.
  const toKing = g.received[king];
  if (toKing.length !== 2 || Math.max(...g.hands[slave]) > Math.min(...toKing)) fail('slave did not give 2 highest', ctx);
  if (n >= 4) {
    const [queen] = by('queen');
    const [peasant] = by('peasant');
    const toQueen = g.received[queen];
    if (toQueen.length !== 1 || Math.max(...g.hands[peasant]) > toQueen[0]) fail('peasant did not give highest', ctx);
  } else if (by('queen').length || by('peasant').length) fail('3-player game has queen/peasant', ctx);
}

export function newStats(): Stats {
  return { games: 0, rounds: 0, actions: 0, revolutions: 0, penalized: 0, straights: 0 };
}

/** Simulates seeds [from, to). Throws on the first violated invariant. */
export function runSeeds(from: number, to: number, stats: Stats = newStats()): Stats {
  for (let seed = from; seed < to; seed++) simulateGame(seed, stats);
  return stats;
}
