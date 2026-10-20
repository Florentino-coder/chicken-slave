import { z } from 'zod';
import type { BotLevel, PlayerView, Settings } from '@slave/engine';

export const NAME_MAX = 16;
export const CHAT_MAX = 120;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

const card = z.number().int().min(0).max(51);
const cards = z.array(card).min(1).max(13);

export const settingsSchema = z
  .object({
    playerCount: z.number().int().min(3).max(6),
    passLock: z.boolean(),
    allowStraights: z.boolean(),
    revolution: z.boolean(),
    noTwoFinish: z.boolean(),
    bombs: z.boolean(),
    turnSeconds: z.number().int().min(10).max(60),
  })
  .partial();

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));

/** Client to server payloads. Every handler validates with these before touching state. */
export const C2S = {
  'room:create': z.object({ settings: settingsSchema.optional(), password: z.string().max(32).optional() }),
  'room:join': z.object({ code: roomCodeSchema, password: z.string().max(32).optional() }),
  'room:leave': z.object({}),
  'room:ready': z.object({ ready: z.boolean() }),
  'room:settings': z.object({ settings: settingsSchema }),
  'room:addBot': z.object({ level: z.enum(['easy', 'medium']).default('medium') }),
  'room:removeSeat': z.object({ seat: z.number().int().min(0).max(5) }),
  'room:start': z.object({}),
  'quick:join': z.object({}),
  'quick:leave': z.object({}),
  'game:play': z.object({ cards, version: z.number().int() }),
  'game:pass': z.object({ version: z.number().int() }),
  'exchange:give': z.object({ cards, version: z.number().int() }),
  'game:next': z.object({}),
  'chat:send': z.object({ text: z.string().min(1).max(CHAT_MAX) }),
  'profile:update': z.object({ name: z.string().min(1).max(NAME_MAX) }),
} as const;

export type C2SEvent = keyof typeof C2S;
export type C2SPayload<E extends C2SEvent> = z.input<(typeof C2S)[E]>;

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export interface SeatView {
  seat: number;
  guestId: string | null;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  connected: boolean;
  ready: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing';
  quick: boolean;
  hasPassword: boolean;
  settings: Settings;
  seats: SeatView[];
  /** Epoch ms when the current turn or exchange auto-resolves. */
  deadline: number | null;
  /** Epoch ms when the next round auto-starts. */
  nextRoundAt: number | null;
}

export interface ChatMessage {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
}

export interface GuestInfo {
  guestId: string;
  name: string;
  token: string;
}

/** Server to client events. */
export interface S2CEvents {
  'room:state': (room: RoomView | null) => void;
  'game:state': (view: PlayerView | null) => void;
  'game:moveRejected': (e: { reason: string }) => void;
  'chat:message': (m: ChatMessage) => void;
  'quick:status': (s: { queued: boolean; size: number; startsAt: number | null }) => void;
  'session:info': (g: { guestId: string; name: string }) => void;
  error: (e: { message: string }) => void;
}

export type { PlayerView, Settings, BotLevel };
