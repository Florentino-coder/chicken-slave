import { FormEvent, useEffect, useState } from 'react';
import { ROOM_CODE_ALPHABET, NAME_MAX } from '@slave/shared';
import { act, ensureGuest, errorText, send } from '../net';
import { toast, useStore } from '../store';
import { useNow } from '../hooks';
import RulesSheet from '../components/RulesSheet';

export default function Home() {
  const guest = useStore((s) => s.guest);
  const quick = useStore((s) => s.quick);
  const connected = useStore((s) => s.connected);
  const [name, setName] = useState(guest?.name ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useNow(500);

  useEffect(() => {
    if (guest && !name) setName(guest.name);
  }, [guest, name]);

  async function saveName() {
    const n = name.trim();
    if (!n || n === guest?.name) return;
    const r = await send('profile:update', { name: n });
    if (r.ok) {
      await ensureGuest(r.data.name);
      setName(r.data.name);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await saveName();
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const create = () => run(() => act('room:create', { password: newPassword || undefined }));
  const quickPlay = () => run(() => act('quick:join', {}));

  async function join(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) {
      toast('รหัสห้องต้องมี 6 ตัว', 'error');
      return;
    }
    await run(async () => {
      const r = await send('room:join', { code: c, password: password || undefined });
      if (r.ok) return;
      if (r.error === 'wrong_password') {
        setNeedPassword(true);
        toast(password ? 'รหัสผ่านไม่ถูกต้อง' : 'ห้องนี้ต้องใช้รหัสผ่าน', 'error');
      } else {
        toast(errorText(r.error), 'error');
      }
    });
  }

  const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <header className="text-center">
        <div className="mb-2 text-5xl" aria-hidden>
          ♠♥♣♦
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">สลาฟ ออนไลน์</h1>
        <p className="mt-1 text-white/70">เล่นกับเพื่อนได้ทันที ไม่ต้องสมัคร ไม่ต้องล็อกอิน</p>
      </header>

      <section className="panel space-y-3 p-4">
        <label className="block text-sm text-white/80" htmlFor="name">
          ชื่อเล่นของคุณ
        </label>
        <input
          id="name"
          className="input"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          placeholder="ตั้งชื่อเล่น"
        />

        {quick.queued ? (
          <div className="rounded-xl bg-white/10 p-3 text-center">
            <p className="font-semibold">กำลังหาผู้เล่น… ({quick.size}/4)</p>
            {quick.startsAt && (
              <p className="text-sm text-white/70">
                เติมบอทใน {Math.max(0, Math.ceil((quick.startsAt - now) / 1000))} วินาที
              </p>
            )}
            <button className="btn btn-ghost mt-2" onClick={() => act('quick:leave', {})}>
              ยกเลิก
            </button>
          </div>
        ) : (
          <button className="btn btn-primary w-full text-lg" disabled={busy || !connected} onClick={quickPlay}>
            ⚡ เล่นด่วน (Quick Play)
          </button>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="font-semibold">สร้างห้องเล่นกับเพื่อน</h2>
        <input
          className="input"
          value={newPassword}
          maxLength={32}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="รหัสผ่านห้อง (ไม่บังคับ)"
          aria-label="รหัสผ่านห้องใหม่"
        />
        <button className="btn btn-ghost w-full" disabled={busy || !connected} onClick={create}>
          ＋ สร้างห้อง
        </button>
      </section>

      <form className="panel space-y-3 p-4" onSubmit={join}>
        <h2 className="font-semibold">เข้าห้องด้วยรหัส</h2>
        <input
          className="input text-center font-mono text-xl tracking-[0.4em] uppercase"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(allowed, ''))}
          placeholder="ABC123"
          aria-label="รหัสห้อง"
          autoCapitalize="characters"
        />
        {needPassword && (
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="รหัสผ่านห้อง"
            aria-label="รหัสผ่านห้อง"
          />
        )}
        <button className="btn btn-ghost w-full" type="submit" disabled={busy || !connected}>
          เข้าห้อง
        </button>
      </form>

      <button className="text-sm text-white/70 underline" onClick={() => setShowRules(true)}>
        กติกาการเล่น
      </button>
      {!connected && <p className="text-center text-sm text-amber-300">กำลังเชื่อมต่อ…</p>}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
    </main>
  );
}
