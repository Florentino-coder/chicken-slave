import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LogEntry, PlayerView } from '@slave/engine';
import {
  Booted,
  Player,
  autoPlay,
  boot,
  connectPlayer,
  guest,
  newPlayer,
  postGuest,
  rawSocket,
  sleep,
} from './helpers';

/** Players opened by the current test; disconnected after each test so state never leaks. */
const opened: Player[] = [];
async function player(b: Booted, name: string) {
  const p = await newPlayer(b.base, name);
  opened.push(p);
  return p;
}
async function reconnect(b: Booted, p: Player) {
  const q = await connectPlayer(b.base, p.guestId, p.token);
  opened.push(q);
  return q;
}
afterEach(() => {
  for (const p of opened.splice(0)) p.disconnect();
});

/** Host creates a room, others join by code and ready up. Returns the room code. */
async function setupRoom(host: Player, others: Player[], create: Record<string, unknown> = {}) {
  const c = await host.emit('room:create', create);
  expect(c).toMatchObject({ ok: true });
  const code: string = c.data.code;
  for (const o of others) {
    const j = await o.emit('room:join', { code, password: (create as any).password });
    expect(j).toEqual({ ok: true, data: { code } });
  }
  for (const o of others) expect(await o.emit('room:ready', { ready: true })).toEqual({ ok: true });
  return code;
}

// ---------------------------------------------------------------------------------------------
// Regression: room-scoped events must not throw (app.ts once lost its `myRoom` declaration).
// ---------------------------------------------------------------------------------------------
describe('regression: room-scoped events do not crash', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({}, { shim: false });
  });
  afterAll(() => b.close());

  const cases: [string, unknown][] = [
    ['room:ready', { ready: true }],
    ['room:settings', { settings: { turnSeconds: 30 } }],
    ['room:addBot', { level: 'easy' }],
    ['room:start', {}],
    ['chat:send', { text: 'hi' }],
    ['profile:update', { name: 'Neo' }],
  ];
  for (const [ev, payload] of cases) {
    it(`${ev} is handled without server_error`, async () => {
      const p = await player(b, 'Raw');
      expect((await p.emit('room:create', {})).ok).toBe(true);
      const r = await p.emit(ev, payload);
      expect(r).toMatchObject({ ok: true });
    });
  }
});

// ---------------------------------------------------------------------------------------------
describe('HTTP guest sessions', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot();
  });
  afterAll(() => b.close());

  it('issues a JWT in an httpOnly cookie and in JSON', async () => {
    const r = await postGuest(b.base, 'Alice');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Alice' });
    expect(r.body.guestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.token.split('.')).toHaveLength(3);
    const c = r.setCookie!;
    expect(c).toContain(`slave_token=${r.body.token}`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/SameSite=Lax/i);
  });

  it('re-posting with the cookie keeps the guestId (and name unless a new one is sent)', async () => {
    const first = await postGuest(b.base, 'Bob');
    const cookie = `slave_token=${first.body.token}`;
    const again = await postGuest(b.base, undefined, { cookie });
    expect(again.body.guestId).toBe(first.body.guestId);
    expect(again.body.name).toBe('Bob');
    const renamed = await postGuest(b.base, 'Bobby', { cookie });
    expect(renamed.body.guestId).toBe(first.body.guestId);
    expect(renamed.body.name).toBe('Bobby');
    const fresh = await postGuest(b.base, 'Bob');
    expect(fresh.body.guestId).not.toBe(first.body.guestId);
  });

  it('sanitizes names: control/format chars, whitespace, length 16, profanity', async () => {
    const name = async (n: unknown) => (await postGuest(b.base, n)).body.name as string;
    expect(await name('a\u0000b\u0007c​d‮')).toBe('abcd');
    expect(await name('  spaced \t\n  out  ')).toBe('spaced out');
    expect([...(await name('x'.repeat(40)))]).toHaveLength(16);
    expect([...(await name('ก'.repeat(40)))]).toHaveLength(16);
    expect(await name('fuckface')).toBe('****face');
    expect(await name('f\u0000uck')).toBe('****');
    expect(await name('ไอ้ควย')).not.toContain('ควย');
    const empty = await name('\u0000\u0001  ');
    expect(empty.length).toBeGreaterThan(0);
    expect(empty).not.toMatch(/[\u0000-\u001f]/);
    expect((await name(12345)).length).toBeGreaterThan(0);
  });

  it('profile:update sanitizes and renames the seat', async () => {
    const p = await player(b, 'Before');
    await p.emit('room:create', {});
    const r = await p.emit('profile:update', { name: 'shit\u0000head' });
    expect(r).toEqual({ ok: true, data: { name: '****head' } });
    await p.until(() => p.mySeat()?.name === '****head', 2000, 'seat renamed');
    expect((await p.emit('profile:update', { name: '\u0000' })).error).toBe('bad_request');
  });

  it('rate limits guest creation per IP with 429, but not refreshes with a valid cookie', async () => {
    const rl = await boot({ guestPerMinute: 3 });
    try {
      const codes: number[] = [];
      let token = '';
      for (let i = 0; i < 3; i++) {
        const r = await postGuest(rl.base, `g${i}`);
        codes.push(r.status);
        token = r.body.token ?? token;
      }
      const blocked = await postGuest(rl.base, 'g4');
      expect(codes).toEqual([200, 200, 200]);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ error: 'rate_limited' });
      const refresh = await postGuest(rl.base, 'again', { cookie: `slave_token=${token}` });
      expect(refresh.status).toBe(200);
    } finally {
      await rl.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('socket authentication', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot();
  });
  afterAll(() => b.close());

  const fails = (opts: { token?: string; cookie?: string }) =>
    new Promise<string>((resolve, reject) => {
      const s = rawSocket(b.base, opts);
      s.once('connect', () => {
        s.disconnect();
        reject(new Error('connected'));
      });
      s.once('connect_error', (e) => {
        s.disconnect();
        resolve(e.message);
      });
      s.connect();
    });

  it('rejects missing, garbage and foreign-signed tokens with unauthorized', async () => {
    expect(await fails({})).toBe('unauthorized');
    expect(await fails({ token: 'nope' })).toBe('unauthorized');
    expect(await fails({ cookie: 'slave_token=nope' })).toBe('unauthorized');
    const other = await boot();
    const foreign = await guest(other.base, 'X');
    await other.close();
    expect(await fails({ token: foreign.token })).toBe('unauthorized');
  });

  it('accepts handshake auth.token and the cookie', async () => {
    const g = await guest(b.base, 'Tok');
    const viaToken = await connectPlayer(b.base, g.guestId, g.token, { token: g.token });
    const viaCookie = await connectPlayer(b.base, g.guestId, g.token, { cookie: `slave_token=${g.token}` });
    opened.push(viaToken, viaCookie);
    await viaToken.until(() => viaToken.session, 2000);
    await viaCookie.until(() => viaCookie.session, 2000);
    expect(viaToken.session).toEqual({ guestId: g.guestId, name: 'Tok' });
    expect(viaCookie.session?.guestId).toBe(g.guestId);
    expect(viaCookie.room).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('rooms, lobby and game authority', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({ graceMs: 300, turnMsOverride: 10_000 });
  });
  afterAll(() => b.close());

  it('password rooms', async () => {
    const [a, x] = [await player(b, 'A'), await player(b, 'X')];
    const c = await a.emit('room:create', { password: 'pw1' });
    const code = c.data.code;
    const info = await (await fetch(`${b.base}/api/rooms/${code.toLowerCase()}`)).json();
    expect(info).toEqual({ exists: true, status: 'lobby', hasPassword: true, players: 1, capacity: 4 });
    expect(await x.emit('room:join', { code })).toEqual({ ok: false, error: 'wrong_password' });
    expect(await x.emit('room:join', { code, password: 'nope' })).toEqual({ ok: false, error: 'wrong_password' });
    expect(await x.emit('room:join', { code: code.toLowerCase(), password: 'pw1' })).toEqual({ ok: true, data: { code } });
    await a.until(() => a.room?.seats.filter((s) => s.guestId).length === 2, 2000);
    expect(a.room!.hasPassword).toBe(true);
    expect(JSON.stringify(a.room)).not.toContain('pw1');
  });

  it('unknown and malformed codes', async () => {
    const x = await player(b, 'X');
    expect(await x.emit('room:join', { code: 'ZZZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    expect(await x.emit('room:join', { code: 'bad' })).toEqual({ ok: false, error: 'bad_request' });
    expect((await fetch(`${b.base}/api/rooms/ZZZZZZ`)).status).toBe(404);
  });

  it('room_full', async () => {
    const [a, p2, p3, p4] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'C'), await player(b, 'D')];
    const code = await setupRoom(a, [p2, p3], { settings: { playerCount: 3 } });
    expect(await p4.emit('room:join', { code })).toEqual({ ok: false, error: 'room_full' });
    expect(await a.emit('room:addBot', {})).toEqual({ ok: false, error: 'room_full' });
  });

  it('a failed join (room_full) must not kick the guest out of their current room', async () => {
    const [a, p2, p3, d] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'C'), await player(b, 'D')];
    const full = await setupRoom(a, [p2, p3], { settings: { playerCount: 3 } });
    const mine = (await d.emit('room:create', {})).data.code;
    expect(await d.emit('room:join', { code: full })).toEqual({ ok: false, error: 'room_full' });
    expect(b.server.manager.roomOf(d.guestId)?.code).toBe(mine);
    expect(d.room?.code).toBe(mine);
  });

  it('a failed join mid-game must not abandon the running game to a bot', async () => {
    const [a, p2, p3, d] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'C'), await player(b, 'D')];
    const full = await setupRoom(a, [p2, p3], { settings: { playerCount: 3 } });
    const mine = (await d.emit('room:create', {})).data.code;
    expect(await d.emit('room:start')).toEqual({ ok: true });
    await d.until(() => d.game, 2000);
    expect(await d.emit('room:join', { code: full })).toEqual({ ok: false, error: 'room_full' });
    expect(d.room?.code).toBe(mine);
    expect(b.server.manager.rooms.get(mine)?.seatOf(d.guestId)).toBeDefined();
  });

  it('already_playing, not_host, not_ready and start filling bots', async () => {
    const [a, p2, late] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'Late')];
    const c = await a.emit('room:create', {});
    const code = c.data.code;
    await p2.emit('room:join', { code });
    expect(await p2.emit('room:start')).toEqual({ ok: false, error: 'not_host' });
    expect(await p2.emit('room:settings', { settings: { turnSeconds: 30 } })).toEqual({ ok: false, error: 'not_host' });
    expect(await p2.emit('room:addBot', {})).toEqual({ ok: false, error: 'not_host' });
    expect(await p2.emit('room:removeSeat', { seat: 0 })).toEqual({ ok: false, error: 'not_host' });
    expect(await a.emit('room:start')).toEqual({ ok: false, error: 'not_ready' });
    expect(await p2.emit('room:ready', { ready: true })).toEqual({ ok: true });
    expect(await a.emit('room:start')).toEqual({ ok: true });
    const room = await p2.until(() => (p2.room?.status === 'playing' ? p2.room : null), 2000);
    expect(room.seats.map((s) => s.isBot)).toEqual([false, false, true, true]);
    expect(room.seats.every((s) => s.name)).toBe(true);
    expect(await a.emit('room:start')).toEqual({ ok: false, error: 'already_playing' });
    expect(await a.emit('room:settings', { settings: { turnSeconds: 30 } })).toEqual({ ok: false, error: 'already_playing' });
    expect(await a.emit('room:addBot', {})).toEqual({ ok: false, error: 'already_playing' });
    expect(await p2.emit('room:ready', { ready: false })).toEqual({ ok: false, error: 'already_playing' });
    expect(await late.emit('room:join', { code })).toEqual({ ok: false, error: 'already_playing' });
  });

  it('settings (host, lobby only), addBot and removeSeat', async () => {
    const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
    const code = (await a.emit('room:create', {})).data.code;
    await p2.emit('room:join', { code });
    expect(await a.emit('room:settings', { settings: { turnSeconds: 30, allowStraights: true } })).toEqual({ ok: true });
    await p2.until(() => p2.room?.settings.turnSeconds === 30 && p2.room.settings.allowStraights, 2000);
    expect(await a.emit('room:settings', { settings: { playerCount: 9 } })).toEqual({ ok: false, error: 'bad_request' });
    expect(await a.emit('room:settings', { settings: { playerCount: 3 } })).toEqual({ ok: true });
    await p2.until(() => p2.room?.seats.length === 3, 2000);
    expect(await a.emit('room:addBot', { level: 'easy' })).toEqual({ ok: true });
    await p2.until(() => p2.room?.seats[2].isBot, 2000);
    expect(p2.room!.seats[2].botLevel).toBe('easy');
    expect(await a.emit('room:settings', { settings: { playerCount: 2 } })).toEqual({ ok: false, error: 'bad_request' });
    expect(await a.emit('room:removeSeat', { seat: 0 })).toEqual({ ok: false, error: 'bad_request' }); // host itself
    expect(await a.emit('room:removeSeat', { seat: 2 })).toEqual({ ok: true });
    await p2.until(() => p2.room?.seats[2].name === '', 2000);
    expect(await a.emit('room:removeSeat', { seat: 1 })).toEqual({ ok: true }); // kick human
    await p2.until(() => p2.room === null, 2000);
    expect(b.server.manager.roomOf(p2.guestId)).toBeUndefined();
  });

  it('host leaving transfers host; room deleted when no humans remain', async () => {
    const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
    const code = (await a.emit('room:create', {})).data.code;
    await p2.emit('room:join', { code });
    expect(await a.emit('room:leave')).toEqual({ ok: true });
    await p2.until(() => p2.room?.hostId === p2.guestId, 2000, 'host transfer');
    expect(p2.mySeat()!.ready).toBe(true);
    expect(await a.emit('room:leave')).toEqual({ ok: false, error: 'not_in_room' });
    expect(await p2.emit('room:leave')).toEqual({ ok: true });
    expect(b.server.manager.rooms.has(code)).toBe(false);
    expect((await fetch(`${b.base}/api/rooms/${code}`)).status).toBe(404);
  });

  it('leaving mid-game hands the seat to a bot; room deleted when last human leaves', async () => {
    const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
    const code = await setupRoom(a, [p2]);
    expect(await a.emit('room:start')).toEqual({ ok: true });
    autoPlay(p2);
    await p2.until(() => p2.game, 2000);
    expect(await a.emit('room:leave')).toEqual({ ok: true });
    const r = await p2.until(() => (p2.room?.seats[0].isBot ? p2.room : null), 2000, 'seat 0 bot');
    expect(r.hostId).toBe(p2.guestId);
    await a.until(() => a.room === null && a.game === null, 2000);
    const v0 = p2.game!.version;
    await p2.until(() => p2.game!.version > v0 + 2, 5000, 'game continues');
    expect(await p2.emit('room:leave')).toEqual({ ok: true });
    expect(b.server.manager.rooms.has(code)).toBe(false);
  });

  it('server is authoritative: wrong turn, cards not held, 3♣ rule, stale and duplicate versions', async () => {
    const ps = [await player(b, 'P1'), await player(b, 'P2'), await player(b, 'P3'), await player(b, 'P4')];
    await setupRoom(ps[0], ps.slice(1));
    expect(await ps[0].emit('room:start')).toEqual({ ok: true });
    for (const p of ps) await p.until(() => p.game?.phase === 'playing', 2000);
    const v = ps[0].game!;
    const t = ps.find((p) => p.game!.you === v.turn)!;
    const n = ps.find((p) => p !== t)!;
    const hand = t.game!.myHand;
    expect(hand).toContain(0); // round 1 starts with the 3♣ holder
    const version = v.version;

    expect(await n.emit('game:play', { cards: [n.game!.myHand[0]], version })).toEqual({ ok: false, error: 'not_your_turn' });
    const notHeld = [...Array(52).keys()].find((c) => !hand.includes(c))!;
    expect(await t.emit('game:play', { cards: [notHeld], version })).toEqual({ ok: false, error: 'not_in_hand' });
    expect(await t.emit('game:play', { cards: [hand[1]], version })).toEqual({ ok: false, error: 'must_include_3c' });
    expect(await t.emit('game:play', { cards: [0, 0], version })).toEqual({ ok: false, error: 'invalid_combo' });
    expect(await t.emit('game:pass', { version })).toEqual({ ok: false, error: 'cannot_pass_lead' });
    expect(await t.emit('exchange:give', { cards: [0], version })).toEqual({ ok: false, error: 'bad_phase' });
    expect(await t.emit('game:play', { cards: [0], version: version - 1 })).toEqual({ ok: false, error: 'stale' });
    expect(await t.emit('game:play', { cards: [99], version })).toEqual({ ok: false, error: 'bad_request' });
    expect(await t.emit('game:play', { cards: 'x', version })).toEqual({ ok: false, error: 'bad_request' });

    expect(await t.emit('game:play', { cards: [0], version })).toEqual({ ok: true });
    expect(await t.emit('game:play', { cards: [0], version })).toEqual({ ok: false, error: 'stale' }); // duplicate
    await t.until(() => t.game!.version === version + 1, 2000);
    expect(await t.emit('game:pass', { version: version + 1 })).toEqual({ ok: false, error: 'not_your_turn' });
    expect(t.game!.myHand).not.toContain(0);
    expect(t.game!.handCounts[t.game!.you]).toBe(12);

    await t.until(() => t.rejected.length >= 8, 2000);
    expect(t.rejected).toEqual(
      expect.arrayContaining(['not_in_hand', 'must_include_3c', 'invalid_combo', 'cannot_pass_lead', 'bad_phase', 'stale', 'not_your_turn']),
    );
    expect(n.rejected).toEqual(['not_your_turn']);
  });

  it('game:state never contains other players cards', async () => {
    const ps = [await player(b, 'P1'), await player(b, 'P2'), await player(b, 'P3'), await player(b, 'P4')];
    for (const p of ps) p.keepRaw = true;
    await setupRoom(ps[0], ps.slice(1));
    await ps[0].emit('room:start');
    for (const p of ps) await p.until(() => p.game?.phase === 'playing', 2000);
    const all = ps.flatMap((p) => p.game!.myHand);
    expect(new Set(all).size).toBe(52);
    for (const p of ps) {
      const v = p.game!;
      expect(Object.keys(v)).not.toContain('hands');
      expect(v.myHand).toHaveLength(13);
      expect(Object.values(v.handCounts)).toEqual([13, 13, 13, 13]);
      for (const raw of p.rawGameStates) {
        const parsed = JSON.parse(raw) as PlayerView;
        expect(raw).not.toContain('"hands"');
        // No array in the payload other than myHand / log / received may contain another player's card set.
        const others = ps.filter((o) => o !== p).map((o) => JSON.stringify(o.game!.myHand));
        for (const o of others) expect(raw).not.toContain(o);
        expect(parsed.myHand.length).toBe(parsed.handCounts[parsed.you]);
      }
      expect(JSON.stringify(p.room)).not.toMatch(/myHand|hands/);
    }
  });

  it('reconnect with the same token gets the same seat and state (lobby and game)', async () => {
    const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
    await setupRoom(a, [p2]);
    const seatBefore = p2.mySeat()!.seat;
    p2.disconnect();
    await a.until(() => a.room?.seats[seatBefore].connected === false, 2000, 'disconnected flag');
    const back = await reconnect(b, p2);
    await back.until(() => back.room, 2000);
    expect(back.mySeat()?.seat).toBe(seatBefore);
    expect(back.mySeat()?.connected).toBe(true);
    expect(back.mySeat()?.ready).toBe(true);

    expect(await a.emit('room:start')).toEqual({ ok: true });
    await back.until(() => back.game?.phase === 'playing', 2000);
    const hand = back.game!.myHand;
    back.disconnect();
    const again = await reconnect(b, p2);
    const g = await again.until(() => again.game, 2000);
    expect(g.you).toBe(p2.guestId);
    expect(g.myHand).toEqual(hand);
    expect(again.mySeat()?.seat).toBe(seatBefore);
    expect(again.mySeat()?.isBot).toBe(false);
  });

  it('after grace a bot takes over in game; reconnecting reclaims the seat', async () => {
    const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
    await setupRoom(a, [p2]);
    await a.emit('room:start');
    autoPlay(a);
    await p2.until(() => p2.game, 2000);
    const seat = p2.mySeat()!.seat;
    p2.disconnect();
    const t0 = Date.now();
    await a.until(() => a.room?.seats[seat].isBot === true, 3000, 'takeover');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(a.room!.seats[seat].guestId).toBe(p2.guestId);
    // The bot plays B's turns long before the 10s turn timer.
    await a.until(() => a.game?.turn === p2.guestId, 5000, "B's turn");
    const tTurn = Date.now();
    await a.until(() => a.game?.turn !== p2.guestId, 2000, 'bot acted for B');
    expect(Date.now() - tTurn).toBeLessThan(1000);

    const back = await reconnect(b, p2);
    await back.until(() => back.mySeat()?.isBot === false && back.mySeat()?.connected, 2000, 'reclaimed');
    expect(back.mySeat()!.seat).toBe(seat);
    const g = await back.until(() => back.game, 2000);
    expect(g.you).toBe(p2.guestId);
    expect(g.myHand.length).toBe(g.handCounts[g.you]);
    await a.until(() => a.room?.seats[seat].isBot === false, 2000);
    // Now the bot must no longer act for B.
    await back.until(() => back.game?.turn === p2.guestId || back.game?.phase === 'roundEnd', 5000, "B's turn again");
    if (back.game!.phase !== 'roundEnd') {
      const ver = back.game!.version;
      await sleep(300);
      expect(back.game!.version).toBe(ver);
      expect(back.game!.turn).toBe(p2.guestId);
    }
  });

  it('lobby: disconnected player is removed after grace; disconnected host transfers', async () => {
    const [a, p2, p3] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'C')];
    const code = await setupRoom(a, [p2, p3]);
    p3.disconnect();
    const t0 = Date.now();
    await a.until(() => !a.room?.seats.some((s) => s.guestId === p3.guestId), 3000, 'C removed');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(b.server.manager.roomOf(p3.guestId)).toBeUndefined();
    a.disconnect();
    await p2.until(() => p2.room?.hostId === p2.guestId, 3000, 'host transfer after grace');
    expect(p2.room!.seats.filter((s) => s.guestId)).toHaveLength(1);
    p2.disconnect();
    await sleep(500);
    expect(b.server.manager.rooms.has(code)).toBe(false);
  });

  it('chat: broadcast to room only, censored, control chars stripped, max 120', async () => {
    const [a, p2, outsider] = [await player(b, 'A'), await player(b, 'B'), await player(b, 'O')];
    await setupRoom(a, [p2]);
    await outsider.emit('room:create', {});
    expect(await outsider.emit('chat:send', { text: 'x'.repeat(10) })).toEqual({ ok: true });
    expect(await a.emit('chat:send', { text: 'hello\u0007  fuck\nworld' })).toEqual({ ok: true });
    const m = await p2.until(() => p2.chats.find((c) => c.from === a.guestId), 2000);
    expect(m.text).toBe('hello **** world');
    expect(m.name).toBe('A');
    await a.until(() => a.chats.length === 1, 2000);
    const long = 'y'.repeat(120);
    expect(await p2.emit('chat:send', { text: long })).toEqual({ ok: true });
    await a.until(() => a.chats.some((c) => c.text === long), 2000);
    expect(await p2.emit('chat:send', { text: long + 'z' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await p2.emit('chat:send', { text: '\u0000\u0001' })).toEqual({ ok: false, error: 'bad_request' });
    await sleep(50);
    expect(outsider.chats.every((c) => c.from === outsider.guestId)).toBe(true);
    expect(a.chats.some((c) => c.from === outsider.guestId)).toBe(false);
    const lone = await player(b, 'Lone');
    expect(await lone.emit('chat:send', { text: 'hi' })).toEqual({ ok: false, error: 'not_in_room' });
  });

  it('chat is rate limited per guest', async () => {
    const a = await player(b, 'Spam');
    await a.emit('room:create', {});
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => a.emit('chat:send', { text: `m${i}` })));
    expect(res.filter((r) => r.ok)).toHaveLength(5);
    expect(res.filter((r) => r.error === 'rate_limited').length).toBe(3);
  });

  it('socket events are rate limited: >20 burst -> rate_limited', async () => {
    const a = await player(b, 'Burst');
    const res = await Promise.all(Array.from({ length: 30 }, () => a.emit('game:next')));
    const ok = res.filter((r) => r.ok).length;
    expect(ok).toBeGreaterThanOrEqual(20);
    expect(ok).toBeLessThanOrEqual(21);
    expect(res.filter((r) => r.error === 'rate_limited').length).toBe(30 - ok);
  });
});

// ---------------------------------------------------------------------------------------------
describe('full game: 4 real clients, 2+ rounds with exchange', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({ nextRoundMs: 50, turnMsOverride: 10_000 });
  });
  afterAll(() => b.close());

  it('plays round 1, the exchange phase and round 2 to completion with legal client moves', async () => {
    const ps = [await player(b, 'North'), await player(b, 'East'), await player(b, 'South'), await player(b, 'West')];
    for (const p of ps) p.keepRaw = true;
    const code = await setupRoom(ps[0], ps.slice(1));
    expect(await ps[0].emit('room:start')).toEqual({ ok: true });
    for (const p of ps) await p.until(() => p.game?.phase === 'playing' && p.game.round === 1, 2000);
    expect(new Set(ps.flatMap((p) => p.game!.myHand)).size).toBe(52);

    const cheat: string[] = [];
    const sawExchange = new Set<string>();
    const stats = ps.map((p) =>
      autoPlay(p, {
        beforeExchange: async (v) => {
          sawExchange.add(v.you);
          const tooMany = v.myHand.slice(0, v.myExchange!.count + 1);
          cheat.push((await p.emit('exchange:give', { cards: tooMany, version: v.version })).error);
          const notMine = [...Array(52).keys()].filter((c) => !v.myHand.includes(c)).slice(0, v.myExchange!.count);
          cheat.push((await p.emit('exchange:give', { cards: notMine, version: v.version })).error);
        },
      }),
    );

    const r1 = await ps[0].until(() => (ps[0].game?.round === 1 && ps[0].game.phase === 'roundEnd' ? ps[0].game : null), 20_000, 'round 1 end');
    expect(r1.result).toHaveLength(4);
    expect(Object.values(r1.scores).reduce((x, y) => x + y, 0)).toBe(6);
    expect(Object.values(r1.roles).sort()).toEqual(['king', 'peasant', 'queen', 'slave']);

    for (const p of ps) {
      await p.until(
        () => (p.game!.round === 2 && p.game!.phase === 'roundEnd') || p.game!.round >= 3,
        20_000,
        `round 2 end for ${p.game?.you}`,
      );
    }
    for (const s of stats) s.stop();

    // Round 2 had a real exchange phase where king and queen (humans) chose cards to return.
    const king = Object.entries(r1.roles).find(([, r]) => r === 'king')![0];
    const queen = Object.entries(r1.roles).find(([, r]) => r === 'queen')![0];
    expect([...sawExchange].sort()).toEqual([king, queen].sort());
    expect(stats.reduce((n, s) => n + s.exchanges, 0)).toBeGreaterThanOrEqual(2);
    const exLog = ps[0].rawGameStates
      .map((r) => JSON.parse(r) as PlayerView)
      .flatMap((v) => v.log)
      .filter((e): e is Extract<LogEntry, { t: 'exchange' }> => e.t === 'exchange');
    expect(exLog.some((e) => e.from === king && e.count === 2)).toBe(true);
    expect(exLog.some((e) => e.from === queen && e.count === 1)).toBe(true);

    // Cheating attempts in the exchange were rejected. The test client is faster than any human, so the
    // per-socket rate limit may answer one of them first; that is a rejection too.
    expect(cheat.length).toBeGreaterThanOrEqual(4);
    expect(cheat.every((e) => ['bad_count', 'not_in_hand', 'stale', 'rate_limited'].includes(e))).toBe(true);
    expect(cheat).toContain('bad_count');

    // Only legal moves were made: no errors other than benign 'stale' races.
    expect(stats.flatMap((s) => s.errors)).toEqual([]);
    for (const p of ps) expect(p.rejected.every((r) => ['bad_count', 'not_in_hand', 'stale'].includes(r))).toBe(true);
    expect(stats.reduce((n, s) => n + s.moves, 0)).toBeGreaterThan(20);

    // Privacy across the whole game.
    for (const p of ps) for (const raw of p.rawGameStates) expect(raw).not.toContain('"hands"');
    expect(b.server.manager.rooms.get(code)?.status).toBe('playing');
  }, 45_000);
});

// ---------------------------------------------------------------------------------------------
describe('turn timer during grace and turn timeout', () => {
  it('a disconnected player in grace times out normally (no bot), then auto-pass', async () => {
    const b = await boot({ graceMs: 4000, turnMsOverride: 400 });
    try {
      const [a, p2] = [await player(b, 'A'), await player(b, 'B')];
      await setupRoom(a, [p2]);
      await a.emit('room:start');
      autoPlay(a);
      await p2.until(() => p2.game, 2000);
      const seat = p2.mySeat()!.seat;
      p2.disconnect();
      await a.until(() => a.room?.seats[seat].connected === false, 2000);
      await a.until(() => a.game?.turn === p2.guestId, 4000, "B's turn");
      const t0 = Date.now();
      const v0 = a.game!.version;
      await a.until(() => a.game!.version > v0, 2000, 'timeout move');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
      expect(a.room!.seats[seat].isBot).toBe(false);
      const last = a.game!.log.filter((e) => 'p' in e && e.p === p2.guestId).at(-1)!;
      expect(['pass', 'play']).toContain(last.t);
    } finally {
      await b.close();
    }
  });

  it('turn timeout auto-passes and auto-leads for an idle connected player', async () => {
    const b = await boot({ turnMsOverride: 120, botDelayMs: 2, nextRoundMs: 30 });
    try {
      const a = await player(b, 'Idle');
      expect((await a.emit('room:create', {})).ok).toBe(true);
      expect(await a.emit('room:start')).toEqual({ ok: true });
      const seen = new Set<string>();
      const mine = (e: LogEntry) => 'p' in e && e.p === a.guestId;
      await a.until(
        () => {
          for (const e of a.game?.log ?? []) if (mine(e)) seen.add(e.t);
          return seen.has('pass') && seen.has('play');
        },
        20_000,
        'auto pass and auto lead',
      );
      expect(a.room!.seats[0].isBot).toBe(false);
    } finally {
      await b.close();
    }
  }, 25_000);
});

// ---------------------------------------------------------------------------------------------
describe('quick play', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({ quickWaitMs: 600 });
  });
  afterAll(() => b.close());

  it('4 queued players get an instant room together, auto-started, no bots', async () => {
    const ps = [await player(b, 'Q1'), await player(b, 'Q2'), await player(b, 'Q3'), await player(b, 'Q4')];
    const t0 = Date.now();
    const acks = await Promise.all(ps.map((p) => p.emit('quick:join')));
    expect(acks.every((a) => a.ok)).toBe(true);
    const rooms = await Promise.all(ps.map((p) => p.until(() => (p.room?.status === 'playing' ? p.room : null), 3000)));
    expect(Date.now() - t0).toBeLessThan(600);
    expect(new Set(rooms.map((r) => r.code)).size).toBe(1);
    expect(rooms[0].quick).toBe(true);
    expect(rooms[0].seats.map((s) => s.isBot)).toEqual([false, false, false, false]);
    await Promise.all(ps.map((p) => p.until(() => p.game, 2000)));
    expect(b.server.manager.stats().queued).toBe(0);
  });

  it('a lone player gets a bot-filled room after quickWaitMs', async () => {
    const p = await player(b, 'Solo');
    const t0 = Date.now();
    await p.emit('quick:join');
    await p.until(() => p.quick.some((q) => q.queued && q.size === 1 && q.startsAt), 1000);
    const room = await p.until(() => (p.room?.status === 'playing' ? p.room : null), 3000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    expect(room.quick).toBe(true);
    expect(room.seats.filter((s) => s.isBot)).toHaveLength(3);
    await p.until(() => p.game, 2000);
  });

  it('quick:leave dequeues', async () => {
    const p = await player(b, 'Leaver');
    await p.emit('quick:join');
    await p.until(() => p.quick.some((q) => q.queued), 1000);
    expect(await p.emit('quick:leave')).toEqual({ ok: true });
    await p.until(() => p.quick.at(-1)?.queued === false, 1000);
    await sleep(800);
    expect(p.room ?? null).toBeNull();
    expect(b.server.manager.stats().queued).toBe(0);
  });
});
