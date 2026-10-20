import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { Stats, runSeeds } from './sim';

/**
 * Bot-driven whole-game simulation (invariants live in ./sim.ts).
 *
 * Each applyAction structuredClones the whole state (incl. a log of up to 200 entries), which costs
 * ~0.1-0.2 ms, so ~1.3M actions for 10k games take ~4-5 min on one thread. The run is therefore
 * split: a slice runs in-process (so it counts toward coverage), the rest is sharded across
 * worker threads that load the TypeScript sources through tsx (and, unless SIM_REAL_CLONE=1, swap
 * structuredClone for an equivalent JSON deep copy; see sim-worker.ts).
 */
const GAMES = Number(process.env.SIM_GAMES ?? 10_000);
const IN_PROCESS = Math.min(GAMES, Number(process.env.SIM_IN_PROCESS ?? 150));

function merge(into: Stats, s: Stats) {
  for (const k of Object.keys(into) as (keyof Stats)[]) into[k] += s[k];
}

function runShard(from: number, to: number): Promise<Stats> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./sim-worker.ts', import.meta.url), {
      workerData: { from, to, fastClone: process.env.SIM_REAL_CLONE !== '1' },
      execArgv: ['--import', 'tsx'],
    });
    w.once('message', (m: { ok: boolean; stats?: Stats; error?: string }) => {
      void w.terminate();
      if (m.ok) resolve(m.stats!);
      else reject(new Error(`seeds [${from}, ${to}): ${m.error}`));
    });
    w.once('error', reject);
  });
}

describe('property: bot-driven full games', () => {
  it(`${GAMES} seeded games (3-6 players, random settings, 2 rounds, 20% get a 3rd) keep every invariant`, async () => {
    const t0 = performance.now();
    const shards: Promise<Stats>[] = [];
    const rest = GAMES - IN_PROCESS;
    if (rest > 0) {
      const workers = Math.max(1, Math.min(8, availableParallelism() - 1));
      const per = Math.ceil(rest / workers);
      for (let from = IN_PROCESS + 1; from <= GAMES; from += per) {
        shards.push(runShard(from, Math.min(GAMES + 1, from + per)));
      }
    }
    // Workers run in the background while this thread simulates its own slice.
    const stats = runSeeds(1, IN_PROCESS + 1);
    for (const s of await Promise.all(shards)) merge(stats, s);

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[property] ${JSON.stringify(stats)} in ${secs}s`);
    expect(stats.games).toBe(GAMES);
    expect(stats.rounds).toBeGreaterThanOrEqual(GAMES * 2);
    if (GAMES >= 500) {
      // the random settings must actually exercise the optional rules
      expect(stats.revolutions).toBeGreaterThan(0);
      expect(stats.penalized).toBeGreaterThan(0);
      expect(stats.straights).toBeGreaterThan(0);
    }
  }, 600_000);
});
