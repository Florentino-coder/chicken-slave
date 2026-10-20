import type { Server } from 'socket.io';
import type { Settings } from '@slave/engine';
import type { ServerConfig } from './config';
import { metrics } from './metrics';
import { Room } from './room';
import { randomRoomCode } from './util';

interface QueueEntry {
  guestId: string;
  name: string;
}

const QUICK_SIZE = 4;

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private guestRoom = new Map<string, string>();
  private queue: QueueEntry[] = [];
  private queueTimer: NodeJS.Timeout | null = null;
  private queueStartsAt: number | null = null;
  private sweeper: NodeJS.Timeout;

  constructor(private io: Server, private cfg: ServerConfig) {
    this.sweeper = setInterval(() => this.sweep(), Math.min(30_000, Math.max(1_000, cfg.roomIdleMs / 4)));
    this.sweeper.unref?.();
  }

  roomOf(guestId: string): Room | undefined {
    const code = this.guestRoom.get(guestId);
    const room = code ? this.rooms.get(code) : undefined;
    if (code && (!room || !room.seatOf(guestId))) {
      this.guestRoom.delete(guestId);
      return undefined;
    }
    return room;
  }

  createRoom(hostId: string, settings: Partial<Settings>, opts: { quick?: boolean; password?: string } = {}): Room {
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();
    const room: Room = new Room(code, hostId, settings, !!opts.quick, opts.password || null, this.io, this.cfg, {
      onGuestRemoved: (g) => {
        if (this.guestRoom.get(g) === code) this.guestRoom.delete(g);
      },
      onAbandoned: () => this.deleteRoom(code),
    });
    this.rooms.set(code, room);
    metrics.roomsCreated++;
    return room;
  }

  deleteRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
    for (const [g, c] of this.guestRoom) if (c === code) this.guestRoom.delete(g);
    this.io.in(code).socketsLeave(code);
  }

  /** Seats a guest, leaving any previous room first. */
  join(room: Room, guestId: string, name: string): string | null {
    const current = this.roomOf(guestId);
    if (current && current !== room) {
      // Check the target first so a failed join never costs the guest their current seat.
      const blocked = room.canAdd(guestId);
      if (blocked) return blocked;
      current.leave(guestId);
    }
    this.leaveQueue(guestId);
    const err = room.addHuman(guestId, name);
    if (err) {
      if (room.humans().length === 0) this.deleteRoom(room.code);
      return err;
    }
    this.guestRoom.set(guestId, room.code);
    this.io.in(`g:${guestId}`).socketsJoin(room.code);
    room.sendTo(guestId);
    return null;
  }

  leave(guestId: string): string | null {
    this.leaveQueue(guestId);
    const room = this.roomOf(guestId);
    if (!room) return 'not_in_room';
    return room.leave(guestId);
  }

  // ---------- quick play ----------

  joinQueue(guestId: string, name: string) {
    const current = this.roomOf(guestId);
    if (current) current.leave(guestId);
    if (!this.queue.some((q) => q.guestId === guestId)) this.queue.push({ guestId, name });
    if (this.queue.length >= QUICK_SIZE) {
      this.launchQuick(this.queue.splice(0, QUICK_SIZE));
    } else if (!this.queueTimer) {
      this.queueStartsAt = Date.now() + this.cfg.quickWaitMs;
      this.queueTimer = setTimeout(() => {
        this.queueTimer = null;
        this.queueStartsAt = null;
        if (this.queue.length) this.launchQuick(this.queue.splice(0, QUICK_SIZE));
      }, this.cfg.quickWaitMs);
    }
    this.emitQueue();
  }

  leaveQueue(guestId: string) {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.guestId !== guestId);
    if (before !== this.queue.length) {
      this.io.to(`g:${guestId}`).emit('quick:status', { queued: false, size: 0, startsAt: null });
      if (this.queue.length === 0 && this.queueTimer) {
        clearTimeout(this.queueTimer);
        this.queueTimer = null;
        this.queueStartsAt = null;
      }
      this.emitQueue();
    }
  }

  isQueued(guestId: string) {
    return this.queue.some((q) => q.guestId === guestId);
  }

  private emitQueue() {
    for (const q of this.queue) {
      this.io.to(`g:${q.guestId}`).emit('quick:status', {
        queued: true,
        size: this.queue.length,
        startsAt: this.queueStartsAt,
      });
    }
  }

  private launchQuick(entries: QueueEntry[]) {
    if (this.queue.length === 0 && this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
      this.queueStartsAt = null;
    }
    metrics.quickMatches++;
    const room = this.createRoom(entries[0].guestId, { playerCount: QUICK_SIZE }, { quick: true });
    for (const e of entries) {
      this.io.to(`g:${e.guestId}`).emit('quick:status', { queued: false, size: 0, startsAt: null });
      this.join(room, e.guestId, e.name);
    }
    if (this.rooms.has(room.code)) room.start(null);
    this.emitQueue();
  }

  // ---------- housekeeping ----------

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.idleSince !== null && now - room.idleSince > this.cfg.roomIdleMs) this.deleteRoom(room.code);
    }
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.status === 'playing') playing++;
    return { rooms: this.rooms.size, playing, queued: this.queue.length, guestsSeated: this.guestRoom.size };
  }

  shutdown() {
    clearInterval(this.sweeper);
    if (this.queueTimer) clearTimeout(this.queueTimer);
    for (const code of [...this.rooms.keys()]) this.deleteRoom(code);
  }
}
