import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parse as parseCookie } from 'cookie';
import express from 'express';
import { Server, Socket } from 'socket.io';
import { Ack, C2S, C2SEvent } from '@slave/shared';
import { TOKEN_COOKIE, TOKEN_TTL_SECONDS, issueToken, newGuestId, verifyToken } from './auth';
import { ServerConfig, loadConfig } from './config';
import { RoomManager } from './manager';
import { metrics } from './metrics';
import { RateLimiter, cleanChat, cleanName, originMatcher, randomGuestName } from './util';

interface SocketData {
  guestId: string;
  name: string;
}

type GameSocket = Socket<any, any, any, SocketData>;

export function createApp(overrides: Partial<ServerConfig> = {}) {
  const cfg = loadConfig(overrides);
  const app = express();
  const http = createServer(app);
  const originAllowed = originMatcher(cfg.allowedOrigins);
  const io = new Server(http, {
    cors: cfg.production
      ? cfg.allowedOrigins.length
        ? { origin: (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, !o || originAllowed(o)), credentials: true }
        : undefined
      : { origin: true, credentials: true },
    // Browsers do not apply CORS to WebSocket upgrades, so check the origin ourselves in production.
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      let sameHost = false;
      try {
        sameHost = !!origin && !!host && new URL(origin).host === host;
      } catch {
        /* malformed Origin header */
      }
      done(null, !cfg.production || !origin || sameHost || originAllowed(origin));
    },
    maxHttpBufferSize: 16_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  const manager = new RoomManager(io, cfg);
  /** Latest display name per guest; tokens may carry an older one. */
  const names = new Map<string, string>();
  const rememberName = (guestId: string, name: string) => {
    names.delete(guestId);
    names.set(guestId, name);
    // Oldest entries first in a Map; drop them once the cache is large.
    if (names.size > 50_000) for (const k of [...names.keys()].slice(0, 10_000)) names.delete(k);
  };
  const guestLimiter = new RateLimiter(cfg.guestPerMinute, cfg.guestPerMinute / 60);
  const eventLimiter = new RateLimiter(20, 10);
  const chatLimiter = new RateLimiter(5, 0.5);

  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...manager.stats(), metrics, uptimeSec: Math.round((Date.now() - metrics.startedAt) / 1000) });
  });

  app.post('/api/guest', (req, res) => {
    const cookies = parseCookie(req.headers.cookie ?? '');
    const existing = verifyToken(cfg.jwtSecret, cookies[TOKEN_COOKIE]);
    const requested = cleanName(req.body?.name);
    if (!existing && !guestLimiter.take(`ip:${req.ip}`)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const guestId = existing?.sub ?? newGuestId();
    if (!existing) metrics.guestsCreated++;
    const name = requested ?? names.get(guestId) ?? existing?.name ?? randomGuestName();
    rememberName(guestId, name);
    manager.roomOf(guestId)?.rename(guestId, name);
    const token = issueToken(cfg.jwtSecret, guestId, name);
    res.cookie(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.production,
      maxAge: TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
    res.json({ guestId, name, token });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const room = manager.rooms.get(String(req.params.code).toUpperCase());
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    const v = room.view();
    res.json({
      exists: true,
      status: v.status,
      hasPassword: v.hasPassword,
      players: v.seats.filter((s) => s.name).length,
      capacity: v.seats.length,
    });
  });

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    const dir = path.resolve(cfg.staticDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const claims = verifyToken(cfg.jwtSecret, socket.handshake.auth?.token) ?? verifyToken(cfg.jwtSecret, cookies[TOKEN_COOKIE]);
    if (!claims) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.guestId = claims.sub;
    socket.data.name = names.get(claims.sub) ?? claims.name;
    rememberName(claims.sub, socket.data.name);
    next();
  });

  io.on('connection', (socket: GameSocket) => {
    const { guestId } = socket.data;
    const nameOf = () => names.get(guestId) ?? socket.data.name;
    socket.join(`g:${guestId}`);
    socket.emit('session:info', { guestId, name: nameOf() });

    const room = manager.roomOf(guestId);
    if (room) {
      socket.join(room.code);
      const seat = room.seatOf(guestId)!;
      room.markConnected(seat);
      room.sendTo(guestId);
    } else {
      socket.emit('room:state', null);
      socket.emit('game:state', null);
    }

    function on<E extends C2SEvent>(event: E, handler: (data: any) => string | null | { data: unknown }) {
      socket.on(event as string, (raw: unknown, ack?: (a: Ack) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!eventLimiter.take(socket.id)) {
          reply({ ok: false, error: 'rate_limited' });
          return;
        }
        const parsed = C2S[event].safeParse(raw ?? {});
        if (!parsed.success) {
          reply({ ok: false, error: 'bad_request' });
          return;
        }
        try {
          const out = handler(parsed.data);
          if (out === null) reply({ ok: true });
          else if (typeof out === 'string') {
            reply({ ok: false, error: out });
            if (event.startsWith('game:') || event.startsWith('exchange:')) socket.emit('game:moveRejected', { reason: out });
          } else reply({ ok: true, data: out.data });
        } catch (err) {
          console.error(`[socket ${event}]`, err);
          reply({ ok: false, error: 'server_error' });
        }
      });
    }

    const myRoom = () => manager.roomOf(guestId);
    /** Runs fn against the guest's room. Handlers return null on success, so '??' cannot be used. */
    const inRoom = (fn: (r: NonNullable<ReturnType<typeof myRoom>>) => string | null) => {
      const r = myRoom();
      return r ? fn(r) : 'not_in_room';
    };

    on('room:create', (d) => {
      const r = manager.createRoom(guestId, d.settings ?? {}, { password: d.password });
      const err = manager.join(r, guestId, nameOf());
      return err ?? { data: { code: r.code } };
    });

    on('room:join', (d) => {
      const r = manager.rooms.get(d.code);
      if (!r) return 'room_not_found';
      if (!r.seatOf(guestId) && !r.checkPassword(d.password)) return 'wrong_password';
      return manager.join(r, guestId, nameOf()) ?? { data: { code: r.code } };
    });

    on('room:leave', () => manager.leave(guestId));
    on('room:ready', (d) => inRoom((r) => r.setReady(guestId, d.ready)));
    on('room:settings', (d) => inRoom((r) => r.updateSettings(guestId, d.settings)));
    on('room:addBot', (d) => inRoom((r) => r.addBot(guestId, d.level)));
    on('room:removeSeat', (d) => inRoom((r) => r.removeSeat(guestId, d.seat)));
    on('room:start', () => inRoom((r) => r.start(guestId)));

    on('quick:join', () => {
      manager.joinQueue(guestId, nameOf());
      return null;
    });
    on('quick:leave', () => {
      manager.leaveQueue(guestId);
      return null;
    });

    on('game:play', (d) => inRoom((r) => r.act(guestId, { type: 'play', cards: d.cards }, d.version)));
    on('game:pass', (d) => inRoom((r) => r.act(guestId, { type: 'pass' }, d.version)));
    on('exchange:give', (d) => inRoom((r) => r.act(guestId, { type: 'exchange', cards: d.cards }, d.version)));
    on('game:next', () => null);

    on('chat:send', (d) => {
      if (!chatLimiter.take(guestId)) return 'rate_limited';
      const text = cleanChat(d.text);
      if (!text) return 'bad_request';
      return inRoom((r) => r.chat(guestId, text));
    });

    on('profile:update', (d) => {
      const name = cleanName(d.name);
      if (!name) return 'bad_request';
      rememberName(guestId, name);
      socket.data.name = name;
      myRoom()?.rename(guestId, name);
      return { data: { name } };
    });

    socket.on('disconnect', () => {
      eventLimiter.delete(socket.id);
      const stillHere = io.sockets.adapter.rooms.get(`g:${guestId}`)?.size ?? 0;
      if (stillHere > 0) return;
      manager.leaveQueue(guestId);
      manager.roomOf(guestId)?.onDisconnect(guestId);
    });
  });

  return {
    app,
    http,
    io,
    manager,
    cfg,
    listen(port = cfg.port) {
      return new Promise<number>((resolve) => {
        http.listen(port, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    async close() {
      manager.shutdown();
      io.close();
      if (http.listening) await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
