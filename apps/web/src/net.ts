import { io, Socket } from 'socket.io-client';
import { Ack, C2SEvent, C2SPayload, ERROR_TEXT_TH } from '@slave/shared';
import { getState, prefs, setState, toast } from './store';
import { sfx } from './sound';

let socket: Socket | null = null;

export async function ensureGuest(name?: string) {
  const res = await fetch('/api/guest', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name ?? prefs.get('name') ?? undefined }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate_limited' : 'guest_failed');
  const g = (await res.json()) as { guestId: string; name: string };
  prefs.set('name', g.name);
  setState({ guest: { guestId: g.guestId, name: g.name } });
  return g;
}

export function errorText(code: string) {
  return ERROR_TEXT_TH[code] ?? code;
}

export function connect() {
  if (socket) return socket;
  const s = io({ withCredentials: true, transports: ['websocket', 'polling'] });
  socket = s;

  s.on('connect', () => setState({ connected: true }));
  s.on('disconnect', () => setState({ connected: false }));
  s.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') {
      try {
        await ensureGuest();
        s.connect();
      } catch {
        toast('เชื่อมต่อไม่สำเร็จ', 'error');
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
