import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import type { PlayerView } from '@slave/engine';
import { botAction } from '@slave/engine';
import { createApp } from '../src/app';

let server: ReturnType<typeof createApp>;
let base = '';

beforeAll(async () => {
  server = createApp({ botDelayMs: 5, nextRoundMs: 50, graceMs: 200, quickWaitMs: 100, turnMsOverride: 2000 });
  const port = await server.listen(0);
  base = `http://localhost:${port}`;
});

afterAll(async () => {
  await server.close();
});

async function guest(name: string) {
  const res = await fetch(`${base}/api/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as { guestId: string; name: string; token: string };
}

function client(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const emit = (s: Socket, ev: string, data: unknown = {}) =>
  new Promise<any>((resolve) => s.emit(ev, data, resolve));

describe('server smoke', () => {
  it('rejects sockets without a token', async () => {
    await expect(client('nope')).rejects.toThrow('unauthorized');
  });

  it('creates a room, fills with bots, and a human finishes a round', async () => {
    const g = await guest('ทดสอบ');
    const s = await client(g.token);
    let view: PlayerView | null = null;
    s.on('game:state', (v) => (view = v));

    const created = await emit(s, 'room:create', {});
    expect(created.ok).toBe(true);
    expect(created.data.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await emit(s, 'room:start')).toEqual({ ok: true });

    const deadline = Date.now() + 20_000;
    let rounds = 0;
    while (Date.now() < deadline && rounds < 2) {
      await new Promise((r) => setTimeout(r, 10));
      const v = view as PlayerView | null;
      if (!v) continue;
      if (v.round > 1 && v.phase !== 'roundEnd') rounds = Math.max(rounds, v.round - 1);
      const mine = v.phase === 'exchange' ? v.myExchange : v.turn === v.you;
      if (!mine) continue;
      // Rebuild a minimal state for the shared bot so the human plays legal moves.
      const fake: any = {
        phase: v.phase,
        turn: v.turn,
        pile: v.pile,
        revolution: v.revolution,
        mustInclude: v.mustInclude,
        settings: v.settings,
        hands: Object.fromEntries(v.seats.map((p) => [p, p === v.you ? v.myHand : Array(v.handCounts[p]).fill(0)])),
        exchanges: v.myExchange ? [{ from: v.you, to: v.myExchange.to, count: v.myExchange.count, done: false }] : [],
        seats: v.seats,
        finished: v.finished,
        bottom: [],
      };
      const a = botAction(fake, v.you)!;
      const ev = a.type === 'play' ? 'game:play' : a.type === 'pass' ? 'game:pass' : 'exchange:give';
      const r = await emit(s, ev, { ...('cards' in a ? { cards: a.cards } : {}), version: v.version });
      if (!r.ok && r.error !== 'stale') throw new Error(r.error);
      view = null;
    }
    expect(rounds).toBeGreaterThanOrEqual(1);
    s.disconnect();
  });
});
