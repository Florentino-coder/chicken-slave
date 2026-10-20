import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  Action,
  BotLevel,
  DEFAULT_SETTINGS,
  GameState,
  Settings,
  applyAction,
  botAction,
  createGame,
  nextRound,
  timeoutAction,
  viewFor,
} from '@slave/engine';
import type { ChatMessage, RoomView, SeatView } from '@slave/shared';
import type { ServerConfig } from './config';
import { metrics } from './metrics';
import { cryptoRng } from './util';

export interface Seat {
  /** Engine player id: the guestId for humans, `bot:<uuid>` for bots. */
  id: string;
  guestId: string | null;
  name: string;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;
  ready: boolean;
  /** A bot plays for this human (grace expired or they left mid-game). */
  takenOver: boolean;
  left: boolean;
  graceTimer: NodeJS.Timeout | null;
}

export interface RoomHooks {
  /** Called when a guest no longer belongs to this room. */
  onGuestRemoved(guestId: string): void;
  /** Called when the room has no humans left and should be deleted. */
  onAbandoned(): void;
}

export type RoomError =
  | 'room_full'
  | 'already_playing'
  | 'not_host'
  | 'not_in_room'
  | 'not_ready'
  | 'bad_request'
  | 'stale'
  | string;

const BOT_NAMES = ['บอทสมชาย', 'บอทสมหญิง', 'บอทมานี', 'บอทปิติ', 'บอทชูใจ', 'บอทวีระ'];

export class Room {
  status: 'lobby' | 'playing' = 'lobby';
  settings: Settings;
  seats: (Seat | null)[];
  game: GameState | null = null;
  deadline: number | null = null;
  nextRoundAt: number | null = null;
  /** Epoch ms since when no human has been connected; null while someone is. */
  idleSince: number | null = null;
  private timers: NodeJS.Timeout[] = [];
  private chatSeq = 0;
  private destroyed = false;
  private countedRound = 0;
  /** Game state the current timers were set for; rescheduling the same state keeps its deadlines. */
  private scheduledFor: GameState | null = null;

  constructor(
    readonly code: string,
    public hostId: string,
    settings: Partial<Settings>,
    readonly quick: boolean,
    private readonly password: string | null,
    private readonly io: Server,
    private readonly cfg: ServerConfig,
    private readonly hooks: RoomHooks,
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.seats = Array(this.settings.playerCount).fill(null);
  }

  // ---------- membership ----------

  checkPassword(pw: string | undefined): boolean {
    return !this.password || pw === this.password;
  }

  seatOf(guestId: string): Seat | undefined {
    return this.seats.find((s): s is Seat => !!s && s.guestId === guestId && !s.left);
  }

  humans(): Seat[] {
    return this.seats.filter((s): s is Seat => !!s && !!s.guestId && !s.left);
  }

  /** Why `addHuman` would fail for this guest, without changing anything. */
  canAdd(guestId: string): RoomError | null {
    if (this.seatOf(guestId)) return null;
    if (this.status !== 'lobby') return 'already_playing';
    if (!this.seats.includes(null)) return 'room_full';
    return null;
  }

  addHuman(guestId: string, name: string): RoomError | null {
    const existing = this.seatOf(guestId);
    if (existing) {
      this.markConnected(existing);
      return null;
    }
    if (this.status !== 'lobby') return 'already_playing';
    const idx = this.seats.findIndex((s) => s === null);
    if (idx < 0) return 'room_full';
    this.seats[idx] = {
      id: guestId,
      guestId,
      name,
      isBot: false,
      botLevel: 'medium',
      connected: true,
      ready: guestId === this.hostId,
      takenOver: false,
      left: false,
      graceTimer: null,
    };
    this.idleSince = null;
    this.broadcast();
    return null;
  }

  addBot(by: string, level: BotLevel): RoomError | null {
    if (by !== this.hostId) return 'not_host';
    if (this.status !== 'lobby') return 'already_playing';
    const idx = this.seats.findIndex((s) => s === null);
    if (idx < 0) return 'room_full';
    this.seats[idx] = this.makeBot(level);
    this.broadcast();
    return null;
  }

  private makeBot(level: BotLevel): Seat {
    const used = new Set(this.seats.map((s) => s?.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `บอท${this.seats.length}`;
    return {
      id: `bot:${randomUUID()}`,
      guestId: null,
      name,
      isBot: true,
      botLevel: level,
      connected: true,
      ready: true,
      takenOver: false,
      left: false,
      graceTimer: null,
    };
  }

  removeSeat(by: string, index: number): RoomError | null {
    if (by !== this.hostId) return 'not_host';
    if (this.status !== 'lobby') return 'already_playing';
    const seat = this.seats[index];
    if (!seat) return 'bad_request';
    if (seat.guestId === this.hostId) return 'bad_request';
    this.dropSeat(index);
    return null;
  }

  private dropSeat(index: number) {
    const seat = this.seats[index];
    if (!seat) return;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    this.seats[index] = null;
    if (seat.guestId) this.detachGuest(seat.guestId);
    this.afterMembershipChange();
  }

  private detachGuest(guestId: string) {
    this.io.in(`g:${guestId}`).socketsLeave(this.code);
    this.io.to(`g:${guestId}`).emit('room:state', null);
    this.io.to(`g:${guestId}`).emit('game:state', null);
    this.hooks.onGuestRemoved(guestId);
  }

  leave(guestId: string): RoomError | null {
    const seat = this.seatOf(guestId);
    if (!seat) return 'not_in_room';
    if (this.status === 'lobby') {
      this.dropSeat(this.seats.indexOf(seat));
      return null;
    }
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.left = true;
    seat.takenOver = true;
    seat.name = `${seat.name} (บอท)`;
    this.detachGuest(guestId);
    this.afterMembershipChange();
    if (!this.destroyed) this.reschedule();
    return null;
  }

  private afterMembershipChange() {
    const humans = this.humans();
    if (humans.length === 0) {
      this.hooks.onAbandoned();
      return;
    }
    if (!humans.some((h) => h.guestId === this.hostId)) {
      const next = humans.find((h) => h.connected) ?? humans[0];
      this.hostId = next.guestId!;
      next.ready = true;
    }
    this.updateIdle();
    this.broadcast();
  }

  private updateIdle() {
    const anyone = this.humans().some((h) => h.connected);
    if (anyone) this.idleSince = null;
    else if (this.idleSince === null) this.idleSince = Date.now();
  }

  onDisconnect(guestId: string) {
    const seat = this.seatOf(guestId);
    if (!seat) return;
    seat.connected = false;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = setTimeout(() => {
      seat.graceTimer = null;
      if (seat.connected || this.destroyed) return;
      if (this.status === 'lobby') {
        const idx = this.seats.indexOf(seat);
        if (idx >= 0) this.dropSeat(idx);
      } else {
        seat.takenOver = true;
        this.broadcast();
        this.reschedule();
      }
    }, this.cfg.graceMs);
    this.updateIdle();
    this.broadcast();
  }

  /** A socket of this guest (re)connected while they hold a seat. */
  markConnected(seat: Seat) {
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    const wasBot = seat.takenOver;
    seat.connected = true;
    seat.takenOver = false;
    this.idleSince = null;
    this.broadcast();
    if (wasBot && this.game) this.reschedule();
  }

  rename(guestId: string, name: string) {
    const seat = this.seatOf(guestId);
    if (!seat) return;
    seat.name = name;
    this.broadcast();
  }

  setReady(guestId: string, ready: boolean): RoomError | null {
    const seat = this.seatOf(guestId);
    if (!seat) return 'not_in_room';
    if (this.status !== 'lobby') return 'already_playing';
    seat.ready = guestId === this.hostId ? true : ready;
    this.broadcast();
    return null;
  }

  updateSettings(by: string, patch: Partial<Settings>): RoomError | null {
    if (by !== this.hostId) return 'not_host';
    if (this.status !== 'lobby') return 'already_playing';
    const next = { ...this.settings, ...patch };
    const occupied = this.seats.filter((s): s is Seat => !!s);
    if (next.playerCount < occupied.length) return 'room_full';
    this.settings = next;
    this.seats = [...occupied, ...Array(next.playerCount - occupied.length).fill(null)];
    this.broadcast();
    return null;
  }

  // ---------- game ----------

  start(by: string | null): RoomError | null {
    if (by !== null && by !== this.hostId) return 'not_host';
    if (this.status !== 'lobby') return 'already_playing';
    if (by !== null && this.humans().some((h) => !h.ready)) return 'not_ready';
    for (let i = 0; i < this.seats.length; i++) {
      if (!this.seats[i]) this.seats[i] = this.makeBot('medium');
    }
    this.status = 'playing';
    metrics.gamesStarted++;
    this.game = createGame(
      this.seats.map((s) => s!.id),
      this.settings,
      cryptoRng,
    );
    this.afterChange();
    return null;
  }

  act(guestId: string, action: Action, version: number): RoomError | null {
    const seat = this.seatOf(guestId);
    if (!seat) return 'not_in_room';
    if (!this.game) return 'bad_phase';
    // Exchanges by different players are independent, so only turn-based moves need a fresh version.
    if (action.type !== 'exchange' && version !== this.game.version) return 'stale';
    const r = applyAction(this.game, seat.id, action);
    // A failed exchange sent from an older view is a duplicate or late click, not a rules error.
    if (!r.ok) return version !== this.game.version ? 'stale' : r.error;
    this.game = r.state;
    this.afterChange();
    return null;
  }

  private botControlled(seat: Seat): boolean {
    return seat.isBot || seat.takenOver || seat.left;
  }

  private seatById(id: string): Seat | undefined {
    return this.seats.find((s): s is Seat => !!s && s.id === id);
  }

  /** Applies an automatic action, falling back to the timeout move if the bot's choice is rejected. */
  private autoAct(id: string, useBot: boolean) {
    if (!this.game) return;
    const seat = this.seatById(id);
    const preferred = useBot ? botAction(this.game, id, seat?.botLevel ?? 'medium') : null;
    for (const action of [preferred, timeoutAction(this.game, id)]) {
      if (!action) continue;
      const r = applyAction(this.game, id, action);
      if (r.ok) {
        this.game = r.state;
        return;
      }
      console.error(`[room ${this.code}] auto action rejected for ${id}:`, r.error, action);
    }
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(
      setTimeout(() => {
        if (this.destroyed) return;
        try {
          fn();
        } catch (err) {
          console.error(`[room ${this.code}] timer error`, err);
        }
      }, ms),
    );
  }

  private afterChange() {
    this.broadcast();
    this.reschedule();
  }

  private reschedule() {
    this.clearTimers();
    const g = this.game;
    if (!g || this.destroyed) {
      this.deadline = null;
      return;
    }
    const now = Date.now();
    const same = this.scheduledFor === g;
    this.scheduledFor = g;
    if (g.phase === 'roundEnd') {
      if (this.countedRound !== g.round) {
        this.countedRound = g.round;
        metrics.roundsFinished++;
      }
      this.deadline = null;
      if (!same || this.nextRoundAt === null) this.nextRoundAt = now + this.cfg.nextRoundMs;
      this.later(Math.max(0, this.nextRoundAt - now), () => {
        if (this.game !== g) return;
        this.game = nextRound(g, cryptoRng);
        this.afterChange();
      });
      this.broadcastRoom();
      return;
    }
    this.nextRoundAt = null;
    const turnMs = this.cfg.turnMsOverride ?? this.settings.turnSeconds * 1000;
    if (!same || this.deadline === null) this.deadline = now + turnMs;
    const left = Math.max(0, this.deadline - now);

    const actors = g.phase === 'exchange' ? g.exchanges.filter((t) => !t.done).map((t) => t.from) : [g.turn!];
    const botActor = actors.find((id) => {
      const seat = this.seatById(id);
      return !seat || this.botControlled(seat);
    });
    if (botActor) {
      this.later(this.cfg.botDelayMs, () => {
        if (this.game !== g) return;
        this.autoAct(botActor, true);
        this.afterChange();
      });
    }
    this.later(left, () => {
      if (this.game !== g) return;
      for (const id of actors) this.autoAct(id, false);
      this.afterChange();
    });
    this.broadcastRoom();
  }

  // ---------- chat & views ----------

  chat(guestId: string, text: string): RoomError | null {
    const seat = this.seatOf(guestId);
    if (!seat) return 'not_in_room';
    const msg: ChatMessage = { id: ++this.chatSeq, from: guestId, name: seat.name, text, at: Date.now() };
    this.io.to(this.code).emit('chat:message', msg);
    return null;
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      quick: this.quick,
      hasPassword: !!this.password,
      settings: this.settings,
      seats: this.seats.map(
        (s, i): SeatView =>
          s
            ? {
                seat: i,
                guestId: s.isBot || s.left ? null : s.guestId,
                name: s.name,
                isBot: s.isBot || s.takenOver,
                botLevel: s.isBot ? s.botLevel : undefined,
                connected: s.connected,
                ready: s.ready,
              }
            : { seat: i, guestId: null, name: '', isBot: false, connected: false, ready: false },
      ),
      deadline: this.deadline,
      nextRoundAt: this.nextRoundAt,
    };
  }

  /** Player id used by the engine for a guest, so the client can find itself in game views. */
  playerIdOf(guestId: string): string | null {
    return this.seatOf(guestId)?.id ?? null;
  }

  private broadcastRoom() {
    if (this.destroyed) return;
    this.io.to(this.code).emit('room:state', this.view());
  }

  broadcast() {
    if (this.destroyed) return;
    this.broadcastRoom();
    if (!this.game) return;
    for (const h of this.humans()) {
      this.io.to(`g:${h.guestId}`).emit('game:state', viewFor(this.game, h.id));
    }
  }

  /** Sends the current room and game state to one guest (after reconnect or join). */
  sendTo(guestId: string) {
    const seat = this.seatOf(guestId);
    if (!seat) return;
    this.io.to(`g:${guestId}`).emit('room:state', this.view());
    this.io.to(`g:${guestId}`).emit('game:state', this.game ? viewFor(this.game, seat.id) : null);
  }

  destroy() {
    this.destroyed = true;
    this.clearTimers();
    for (const s of this.seats) if (s?.graceTimer) clearTimeout(s.graceTimer);
  }
}
