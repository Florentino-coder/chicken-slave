import { randomBytes } from 'node:crypto';

export interface ServerConfig {
  port: number;
  jwtSecret: string;
  production: boolean;
  /** Delay before a bot (or a bot standing in for a disconnected player) acts. */
  botDelayMs: number;
  /** How long a disconnected player keeps their seat before a bot takes over. */
  graceMs: number;
  nextRoundMs: number;
  quickWaitMs: number;
  /** Rooms with no connected humans are deleted after this long. */
  roomIdleMs: number;
  /** Overrides settings.turnSeconds when set (tests). */
  turnMsOverride: number | null;
  guestPerMinute: number;
  /** Directory with the built web app to serve, if any. */
  staticDir: string | null;
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (production) throw new Error('JWT_SECRET is required in production');
    jwtSecret = randomBytes(32).toString('hex');
  }
  return {
    port: num(env.PORT, 3001),
    jwtSecret,
    production,
    botDelayMs: num(env.BOT_DELAY_MS, 900),
    graceMs: num(env.GRACE_MS, 60_000),
    nextRoundMs: num(env.NEXT_ROUND_MS, 8_000),
    quickWaitMs: num(env.QUICK_WAIT_MS, 15_000),
    roomIdleMs: num(env.ROOM_IDLE_MS, 10 * 60_000),
    turnMsOverride: env.TURN_MS ? Number(env.TURN_MS) : null,
    guestPerMinute: num(env.GUEST_PER_MINUTE, 10),
    staticDir: env.STATIC_DIR ?? null,
    ...overrides,
  };
}
