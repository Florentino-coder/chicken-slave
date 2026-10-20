/**
 * Test helpers shared by integration.test.ts and load.ts.
 *
 * NOTE on the optional `myRoom` shim (off by default): an earlier app.ts called `myRoom()` without
 * defining it (since fixed). Every room-scoped socket event therefore throws a
 * ReferenceError and acks `server_error`. To still exercise the rest of the server, `boot()` can
 * install a test-only shim that defines `globalThis.myRoom` right before each handler runs,
 * emulating the obviously intended `const myRoom = () => manager.roomOf(guestId)`. Once the source
 * is fixed the local definition shadows the global and the shim becomes a harmless no-op.
 */
import { io as connect, Socket } from 'socket.io-client';
import { botAction } from '@slave/engine';
import type { PlayerView } from '@slave/engine';
import type { ChatMessage, RoomView } from '@slave/shared';
import { C2S } from '@slave/shared';
import { createApp } from '../src/app';
import type { ServerConfig } from '../src/config';

export type Server = ReturnType<typeof createApp>;

export interface Booted {
  server: Server;
  base: string;
  close(): Promise<void>;
}

export async function boot(overrides: Partial<ServerConfig> = {}, opts: { shim?: boolean } = {}): Promise<Booted> {
  const server = createApp({
    botDelayMs: 5,
    nextRoundMs: 50,
    graceMs: 300,
    quickWaitMs: 300,
    turnMsOverride: 10_000,
    guestPerMinute: 100_000,
    roomIdleMs: 60_000,
    ...overrides,
  });
  if (opts.shim === true) installMyRoomShim(server);
  const port = await server.listen(0);
  return {
    server,
    base: `http://localhost:${port}`,
    close: () => server.close(),
  };
}

/** Wraps every C2S handler so `globalThis.myRoom` resolves to the calling guest's room. */
export function installMyRoomShim(server: Server) {
  const g = globalThis as any;
  server.io.on('connection', (socket) => {
    const guestId: string = socket.data.guestId;
    for (const ev of Object.keys(C2S)) {
      for (const orig of socket.listeners(ev)) {
        socket.off(ev, orig as any);
        socket.on(ev, (...args: any[]) => {
          g.myRoom = () => server.manager.roomOf(guestId);
          return (orig as any)(...args);
        });
      }
    }
  });
}

export interface GuestRes {
  status: number;
  body: any;
  setCookie: string | null;
}

export async function postGuest(base: string, name?: unknown, headers: Record<string, string> = {}): Promise<GuestRes> {
  const res = await fetch(`${base}/api/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(name === undefined ? {} : { name }),
  });
  return { status: res.status, body: await res.json(), setCookie: res.headers.get('set-cookie') };
}

export async function guest(base: string, name?: string) {
  const r = await postGuest(base, name);
  if (r.status !== 200) throw new Error(`guest failed ${r.status}`);
  return r.body as { guestId: string; name: string; token: string };
}

export const emit = (s: Socket, ev: string, data: unknown = {}, ms = 5000) =>
  new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${ev}`)), ms);
    s.emit(ev, data, (a: any) => {
      clearTimeout(t);
      resolve(a);
    });
  });

/** A connected client that records the latest server state and lets tests wait on conditions. */
export class Player {
  room: RoomView | null | undefined = undefined;
  game: PlayerView | null | undefined = undefined;
  gameStates = 0;
  rawGameStates: string[] = [];
  keepRaw = false;
  chats: ChatMessage[] = [];
  rejected: string[] = [];
  quick: { queued: boolean; size: number; startsAt: number | null }[] = [];
  session: { guestId: string; name: string } | null = null;
  private waiters = new Set<() => boolean>();

  constructor(public s: Socket, public guestId: string, public token: string) {
    s.on('room:state', (r) => {
      this.room = r;
      this.flush();
    });
    s.on('game:state', (v) => {
      this.game = v;
      this.gameStates++;
      if (this.keepRaw && v) this.rawGameStates.push(JSON.stringify(v));
      this.flush();
    });
    s.on('chat:message', (m) => {
      this.chats.push(m);
      this.flush();
    });
    s.on('game:moveRejected', (e) => {
      this.rejected.push(e.reason);
      this.flush();
    });
    s.on('quick:status', (q) => {
      this.quick.push(q);
      this.flush();
    });
    s.on('session:info', (i) => {
      this.session = i;
      this.flush();
    });
    s.on('disconnect', () => this.flush());
  }

  emit(ev: string, data: unknown = {}) {
    return emit(this.s, ev, data);
  }

  private flush() {
    for (const w of [...this.waiters]) w();
  }

  until<T>(fn: () => T | undefined | null | false, ms = 5000, label = 'condition'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const check = () => {
        let v: T | undefined | null | false;
        try {
          v = fn();
        } catch (e) {
          this.waiters.delete(check);
          clearTimeout(timer);
          reject(e);
          return true;
        }
        if (v) {
          this.waiters.delete(check);
          clearTimeout(timer);
          resolve(v);
          return true;
        }
        return false;
      };
      if (check()) return;
      this.waiters.add(check);
      timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`timeout (${ms}ms) waiting for ${label}`));
      }, ms);
    });
  }

  mySeat() {
    return this.room?.seats.find((x) => x.guestId === this.guestId);
  }

  disconnect() {
    this.s.disconnect();
  }
}

export interface ConnectOpts {
  token?: string;
  cookie?: string;
}

export function rawSocket(base: string, opts: ConnectOpts): Socket {
  return connect(base, {
    auth: opts.token ? { token: opts.token } : {},
    extraHeaders: opts.cookie ? { cookie: opts.cookie } : undefined,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
  });
}

export function connectPlayer(base: string, guestId: string, token: string, opts: ConnectOpts = { token }): Promise<Player> {
  const s = rawSocket(base, opts);
  const p = new Player(s, guestId, token);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(p));
    s.once('connect_error', reject);
    s.connect();
  });
}

export async function newPlayer(base: string, name: string): Promise<Player> {
  const g = await guest(base, name);
  return connectPlayer(base, g.guestId, g.token);
}

/** Rebuilds enough GameState from a PlayerView for the engine bot to choose a legal move. */
export function fakeState(v: PlayerView): any {
  return {
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
    roles: v.roles,
  };
}

export function isMyMove(v: PlayerView | null | undefined): boolean {
  if (!v) return false;
  if (v.phase === 'exchange') return !!v.myExchange;
  return v.phase === 'playing' && v.turn === v.you;
}

export interface AutoPlayStats {
  moves: number;
  stale: number;
  errors: string[];
  exchanges: number;
  rateLimited: number;
  stop(): void;
}

/**
 * Plays legal moves for a player whenever it is their move. Each game version is acted on once;
 * a 'stale' reply is expected when another player acted first and is followed by a fresh state.
 */
export function autoPlay(
  p: Player,
  hooks: { beforeExchange?: (v: PlayerView) => Promise<void> } = {},
): AutoPlayStats {
  const sent = new Set<string>();
  let stopped = false;
  const stats: AutoPlayStats = {
    moves: 0,
    stale: 0,
    errors: [],
    exchanges: 0,
    rateLimited: 0,
    stop: () => {
      stopped = true;
      p.s.off('game:state', tick);
    },
  };
  async function tick() {
    const v = p.game;
    if (stopped || !v || !isMyMove(v)) return;
    const key = `${v.round}:${v.version}`;
    if (sent.has(key)) return;
    sent.add(key);
    if (v.phase === 'exchange' && hooks.beforeExchange) await hooks.beforeExchange(v);
    const a = botAction(fakeState(v), v.you);
    if (!a) return;
    const ev = a.type === 'play' ? 'game:play' : a.type === 'pass' ? 'game:pass' : 'exchange:give';
    try {
      const payload = { ...('cards' in a ? { cards: a.cards } : {}), version: v.version };
      let r = await p.emit(ev, payload);
      // Bots-as-clients act far faster than humans; back off on the per-socket event limiter.
      while (!r.ok && r.error === 'rate_limited' && !stopped) {
        stats.rateLimited++;
        await sleep(150);
        r = await p.emit(ev, payload);
      }
      if (r.ok) {
        stats.moves++;
        if (a.type === 'exchange') stats.exchanges++;
      } else if (r.error === 'stale') stats.stale++;
      else stats.errors.push(`${ev}:${r.error}`);
    } catch (e) {
      if (!stopped && p.s.connected) stats.errors.push(String(e));
    }
  }
  p.s.on('game:state', tick);
  void tick();
  return stats;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
