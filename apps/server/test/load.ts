/**
 * Load test: `npx tsx apps/server/test/load.ts [rooms]`
 * Boots the server in-process, opens ROOMS x 4 socket.io clients (one guest each), every room is
 * created/joined by code, readied, started and played with legal client moves until round 1 ends.
 * Note: clients and server share one event loop, so lag numbers include client-side work.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Player, autoPlay, boot, newPlayer } from './helpers';

const ROOMS = Number(process.argv[2] ?? 100);
const ROOM_TIMEOUT_MS = 90_000;

/** Caps concurrent HTTP/handshake setup: Windows' TCP accept backlog refuses ~170 of 400 simultaneous connects. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const setupSlot = limiter(40);

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const b = await boot({
    botDelayMs: 5,
    nextRoundMs: 600_000, // stay at roundEnd once round 1 finishes
    turnMsOverride: 15_000,
    graceMs: 30_000,
    guestPerMinute: 1_000_000,
    roomIdleMs: 600_000,
  });
  const mem0 = process.memoryUsage();
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const t0 = performance.now();

  const errors: string[] = [];
  let rounds = 0;
  let moves = 0;
  let stale = 0;
  let rateLimited = 0;
  const durations: number[] = [];
  const players: Player[] = [];
  let peakMem = mem0;

  const memTimer = setInterval(() => {
    const m = process.memoryUsage();
    if (m.rss > peakMem.rss) peakMem = m;
  }, 250);

  async function runRoom(i: number) {
    const start = performance.now();
    const ps = await Promise.all([0, 1, 2, 3].map((k) => setupSlot(() => newPlayer(b.base, `R${i}P${k}`))));
    players.push(...ps);
    const c = await ps[0].emit('room:create', {});
    if (!c.ok) throw new Error(`create ${c.error}`);
    for (const p of ps.slice(1)) {
      const j = await p.emit('room:join', { code: c.data.code });
      if (!j.ok) throw new Error(`join ${j.error}`);
      const r = await p.emit('room:ready', { ready: true });
      if (!r.ok) throw new Error(`ready ${r.error}`);
    }
    const s = await ps[0].emit('room:start');
    if (!s.ok) throw new Error(`start ${s.error}`);
    const stats = ps.map((p) => autoPlay(p));
    await Promise.all(
      ps.map((p) => p.until(() => p.game?.round === 1 && p.game.phase === 'roundEnd', ROOM_TIMEOUT_MS, `room ${i} round end`)),
    );
    for (const st of stats) {
      st.stop();
      moves += st.moves;
      stale += st.stale;
      rateLimited += st.rateLimited;
      errors.push(...st.errors.map((e) => `room ${i}: ${e}`));
    }
    for (const p of ps) {
      const bad = p.rejected.filter((r) => r !== 'stale');
      if (bad.length) errors.push(`room ${i}: rejected ${bad.join(',')}`);
    }
    rounds++;
    durations.push(performance.now() - start);
  }

  const results = await Promise.allSettled(Array.from({ length: ROOMS }, (_, i) => runRoom(i)));
  for (const r of results) if (r.status === 'rejected') errors.push(String(r.reason));
  const total = performance.now() - t0;
  clearInterval(memTimer);
  lag.disable();
  const mem1 = process.memoryUsage();
  const stats = b.server.manager.stats();

  durations.sort((x, y) => x - y);
  const pct = (p: number) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(p * durations.length))] : NaN);
  console.log(
    JSON.stringify(
      {
        rooms: ROOMS,
        sockets: players.length,
        totalMs: Math.round(total),
        roundsCompleted: rounds,
        roomDurationMs: { p50: Math.round(pct(0.5)), p95: Math.round(pct(0.95)), max: Math.round(durations.at(-1) ?? NaN) },
        clientMoves: moves,
        staleRaces: stale,
        rateLimitedRetries: rateLimited,
        errors: errors.length,
        errorSamples: errors.slice(0, 10),
        eventLoopLagMs: {
          mean: +(lag.mean / 1e6).toFixed(2),
          p99: +(lag.percentile(99) / 1e6).toFixed(2),
          max: +(lag.max / 1e6).toFixed(2),
        },
        memory: {
          rssBefore: mb(mem0.rss),
          rssPeak: mb(peakMem.rss),
          rssAfter: mb(mem1.rss),
          heapUsedBefore: mb(mem0.heapUsed),
          heapUsedAfter: mb(mem1.heapUsed),
        },
        serverStats: stats,
      },
      null,
      2,
    ),
  );

  for (const p of players) p.disconnect();
  await b.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
