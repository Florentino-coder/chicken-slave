import { io, Socket } from 'socket.io-client';
import { Ack, C2SEvent, C2SPayload } from '@slave/shared';
import { errorText, t } from './i18n';
import { getState, prefs, setState, toast } from './store';
import { sfx } from './sound';

let socket: Socket | null = null;
/** Latest guest token; sent in the socket handshake so a socket on another origin (Render) can authenticate. */
let token: string | null = null;
/** Set when the web app is hosted apart from the game server (e.g. Vercel + Render). Same origin when empty. */
const SOCKET_URL: string | undefined = import.meta.env.VITE_SOCKET_URL || undefined;

export async function ensureGuest(name?: string) {
  const res = await fetch('/api/guest', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name ?? prefs.get('name') ?? undefined }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate_limited' : 'guest_failed');
  const g = (await res.json()) as { guestId: string; name: string; token: string };
  token = g.token;
  prefs.set('name', g.name);
  setState({ guest: { guestId: g.guestId, name: g.name } });
  return g;
}

export { errorText };

export function connect() {
  if (socket) return socket;
  const s = io(SOCKET_URL ?? '', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    auth: (cb) => cb(token ? { token } : {}),
  });
  socket = s;

  s.on('connect', () => setState({ connected: true }));
  s.on('disconnect', () => setState({ connected: false }));
  s.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') {
      try {
        await ensureGuest();
        s.connect();
      } catch {
        toast(t('err.connect'), 'error');
      }
    }
  });
  s.on('session:info', (g) => setState({ guest: g }));
  s.on('room:state', (room) => {
    setState((st) => ({ room, chat: room && st.room?.code === room.code ? st.chat : [] }));
  });
  s.on('game:state', (game) => {
    const prev = getState().game;
    if (game && prev && game.turn === game.you && prev.turn !== game.you) sfx.turn();
    if (game && prev && game.log.length && game.version !== prev.version) {
      const last = game.log[game.log.length - 1];
      if (last.t === 'play') sfx.card();
      if (last.t === 'roundEnd') sfx.win();
    }
    setState({ game });
  });
  s.on('game:moveRejected', (e) => toast(errorText(e.reason), 'error'));
  s.on('chat:message', (m) => setState((st) => ({ chat: [...st.chat, m].slice(-50) })));
  s.on('quick:status', (q) => setState({ quick: q }));
  return s;
}

export function send<E extends C2SEvent>(event: E, data: C2SPayload<E>): Promise<Ack<any>> {
  const s = connect();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
    s.emit(event, data, (ack: Ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/** Sends and shows a toast on failure. */
export async function act<E extends C2SEvent>(event: E, data: C2SPayload<E>) {
  const r = await send(event, data);
  if (!r.ok && r.error !== 'stale') toast(errorText(r.error), 'error');
  return r;
}
