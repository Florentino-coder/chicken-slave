import { parentPort, workerData } from 'node:worker_threads';
import { runSeeds } from './sim';

const { from, to, fastClone } = workerData as { from: number; to: number; fastClone: boolean };

// Node 22's structuredClone dominates the engine's cost (~0.3 ms per applyAction). GameState is
// plain JSON data, so a JSON round-trip is an equivalent deep copy and ~3x faster overall. The
// in-process slice of property.test.ts always uses the real structuredClone.
if (fastClone) {
  (globalThis as { structuredClone: unknown }).structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
}

try {
  parentPort!.postMessage({ ok: true, stats: runSeeds(from, to) });
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message });
}
