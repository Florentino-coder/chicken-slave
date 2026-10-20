import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Booted, boot, newPlayer } from './helpers';

let b: Booted;
beforeAll(async () => {
  b = await boot();
});
afterAll(async () => {
  await b.close();
});

describe('bomb setting over the wire', () => {
  it('defaults to on and the host can turn it off before starting', async () => {
    const host = await newPlayer(b.base, 'Host');
    const created = await host.emit('room:create', {});
    expect(created.ok).toBe(true);
    await host.until(() => host.room?.settings.bombs === true, 2000);

    expect(await host.emit('room:settings', { settings: { bombs: false } })).toEqual({ ok: true });
    await host.until(() => host.room?.settings.bombs === false, 2000);

    expect(await host.emit('room:start')).toEqual({ ok: true });
    const g = await host.until(() => host.game ?? null, 2000);
    expect(g.settings.bombs).toBe(false);
    expect(g.trick).toEqual([]);
    host.s.disconnect();
  });

  it('rejects a non-boolean bombs value', async () => {
    const host = await newPlayer(b.base, 'Host2');
    await host.emit('room:create', {});
    expect(await host.emit('room:settings', { settings: { bombs: 'yes' } })).toEqual({ ok: false, error: 'bad_request' });
    host.s.disconnect();
  });
});
