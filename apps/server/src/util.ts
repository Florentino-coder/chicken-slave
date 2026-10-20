import { randomInt } from 'node:crypto';
import { NAME_MAX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@slave/shared';
import type { Rng } from '@slave/engine';

export const cryptoRng: Rng = (n) => randomInt(n);

const BANNED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigger', 'nigga', 'asshole',
  // Short words like หี/สัด/กู are left out: they are parts of ordinary words (หีบ, สัดส่วน, กูเกิล).
  'เหี้ย', 'ควย', 'เย็ด', 'สัส', 'ไอ้สัตว์', 'มึง', 'แม่ง', 'ชิบหาย', 'จัญไร',
];
const BANNED_RE = new RegExp(BANNED.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

export function censor(text: string): string {
  return text.replace(BANNED_RE, (m) => '*'.repeat([...m].length));
}

/** Strips control characters, collapses spaces, censors, and clamps length. Empty result returns null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = censor(raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim());
  const clipped = [...s].slice(0, NAME_MAX).join('').trim();
  return clipped.length ? clipped : null;
}

export function cleanChat(raw: string): string {
  return censor(raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim());
}

const ANIMALS = [
  'เสือดาว', 'ช้างน้อย', 'แมวส้ม', 'นกฮูก', 'กระต่าย', 'จระเข้', 'หมีควาย', 'ลิงซน',
  'ปลาวาฬ', 'ม้าลาย', 'แพนด้า', 'หมาจิ้งจอก', 'นกยูง', 'กวางป่า', 'เต่าทอง', 'ยีราฟ',
];

export function randomGuestName(): string {
  return `${ANIMALS[randomInt(ANIMALS.length)]}#${String(randomInt(10000)).padStart(4, '0')}`;
}

export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

/**
 * Origin allowlist matcher. Entries are exact origins, or contain '*' standing for one DNS label,
 * e.g. https://chicken-slave-*.vercel.app for Vercel preview deployments.
 */
export function originMatcher(allowed: string[]): (origin: string) => boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = allowed.map((a) =>
    a.includes('*') ? new RegExp(`^${a.split('*').map(escape).join('[a-z0-9-]+')}$`, 'i') : a,
  );
  return (origin) => patterns.some((p) => (typeof p === 'string' ? p === origin : p.test(origin)));
}

/** Token bucket: `capacity` burst, refilled at `perSecond`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private perSecond: number) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.prune(now);
    return true;
  }

  delete(key: string) {
    this.buckets.delete(key);
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 60_000) this.buckets.delete(k);
  }
}
