import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const TOKEN_COOKIE = 'slave_token';
export const TOKEN_TTL_SECONDS = 30 * 24 * 3600;

export interface GuestClaims {
  sub: string;
  name: string;
}

export function issueToken(secret: string, guestId: string, name: string): string {
  return jwt.sign({ name }, secret, { subject: guestId, algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(secret: string, token: unknown): GuestClaims | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof p.sub !== 'string' || typeof p.name !== 'string') return null;
    return { sub: p.sub, name: p.name };
  } catch {
    return null;
  }
}

export function newGuestId(): string {
  return randomUUID();
}
