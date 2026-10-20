import { describe, expect, it } from 'vitest';
import { originMatcher } from '../src/util';

describe('originMatcher', () => {
  const ok = originMatcher(['https://chicken-slave.vercel.app', 'https://chicken-slave-*.vercel.app']);
  it('accepts exact and preview origins', () => {
    expect(ok('https://chicken-slave.vercel.app')).toBe(true);
    expect(ok('https://chicken-slave-git-main-florentino.vercel.app')).toBe(true);
  });
  it('rejects look-alikes', () => {
    expect(ok('https://evil.example')).toBe(false);
    expect(ok('https://chicken-slave-x.vercel.app.evil.example')).toBe(false);
    expect(ok('https://chicken-slave-a.b.vercel.app')).toBe(false);
    expect(ok('http://chicken-slave.vercel.app')).toBe(false);
  });
  it('allows nothing when empty', () => {
    expect(originMatcher([])('https://chicken-slave.vercel.app')).toBe(false);
  });
});
