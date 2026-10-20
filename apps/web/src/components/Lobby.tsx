import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RoomView, Settings } from '@slave/shared';
import { act } from '../net';
import { toast, useStore } from '../store';
import RulesSheet from './RulesSheet';
import Chat from './Chat';

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'passLock', label: 'ผ่านแล้วลงซ้ำไม่ได้', hint: 'จนกว่าจะเปิดกองใหม่' },
  { key: 'allowStraights', label: 'ลงเรียงได้', hint: 'ตั้งแต่ 3 ใบขึ้นไป ห้ามมี 2' },
  { key: 'revolution', label: 'ปฏิวัติ', hint: 'ลงโฟร์แล้วลำดับไพ่กลับด้าน' },
  { key: 'noTwoFinish', label: 'ห้ามจบด้วย 2', hint: 'จบด้วย 2 จะตกไปท้ายสุด' },
];

export default function Lobby({ room }: { room: RoomView }) {
  const me = useStore((s) => s.guest?.guestId);
  const navigate = useNavigate();
  const [rules, setRules] = useState(false);
  const isHost = room.hostId === me;
  const mySeat = room.seats.find((s) => s.guestId === me);
  const link = `${window.location.origin}/r/${room.code}`;
  const filled = room.seats.filter((s) => s.name).length;
  const humansReady = room.seats.filter((s) => s.guestId && !s.isBot).every((s) => s.ready);

  async function copy() {
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'มาเล่นสลาฟกัน', url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      toast(link);
    }
  }

  async function leave() {
    await act('room:leave', {});
    navigate('/', { replace: true });
  }

  const set = (patch: Partial<Settings>) => act('room:settings', { settings: patch });

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-2">
        <button className="btn btn-ghost" onClick={leave}>
          ← ออก
        </button>
        <div className="text-center">
          <p className="text-xs text-white/60">รหัสห้อง</p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em]" data-testid="room-code">
            {room.code}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setRules(true)}>
          กติกา
        </button>
      </header>

      <section className="panel p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input font-mono text-sm" readOnly value={link} aria-label="ลิงก์ชวนเพื่อน" />
          <button className="btn btn-primary shrink-0" onClick={copy}>
            ชวนเพื่อน
          </button>
        </div>
        {room.hasPassword && <p className="mt-2 text-xs text-white/60">🔒 ห้องนี้มีรหัสผ่าน</p>}
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-semibold">
          ผู้เล่น {filled}/{room.seats.length}
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {room.seats.map((s) => (
            <li key={s.seat} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2" data-testid="seat">
              {s.name ? (
                <>
                  <span className="flex items-center gap-2 truncate">
                    <span aria-hidden>{s.isBot ? '🤖' : s.guestId === room.hostId ? '👑' : '🙂'}</span>
                    <span className="truncate">
                      {s.name}
                      {s.guestId === me && <span className="text-white/50"> (คุณ)</span>}
                    </span>
                    {!s.connected && <span className="text-xs text-amber-300">หลุด</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {!s.isBot && (
                      <span className={`text-xs ${s.ready ? 'text-emerald-300' : 'text-white/50'}`}>
                        {s.ready ? 'พร้อม' : 'ยังไม่พร้อม'}
                      </span>
                    )}
                    {isHost && s.guestId !== me && (
                      <button
                        className="rounded-lg px-2 text-white/60 hover:bg-white/10"
                        aria-label={`เอา ${s.name} ออก`}
                        onClick={() => act('room:removeSeat', { seat: s.seat })}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </>
              ) : (
                <span className="text-white/40">ว่าง {isHost ? '(จะเติมบอทเมื่อเริ่ม)' : ''}</span>
              )}
            </li>
          ))}
        </ul>
        {isHost && filled < room.seats.length && (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => act('room:addBot', { level: 'easy' })}>
              + บอทง่าย
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => act('room:addBot', { level: 'medium' })}>
              + บอทกลาง
            </button>
          </div>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="font-semibold">ตั้งค่ากติกา {!isHost && <span className="text-xs text-white/50">(เฉพาะเจ้าของห้อง)</span>}</h2>
        <label className="flex items-center justify-between gap-3">
          <span>จำนวนผู้เล่น</span>
          <select
            className="rounded-lg bg-white px-2 py-1 text-slate-900 disabled:opacity-60"
            value={room.settings.playerCount}
            disabled={!isHost}
            onChange={(e) => set({ playerCount: Number(e.target.value) })}
          >
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} คน
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>เวลาต่อตา</span>
          <select
            className="rounded-lg bg-white px-2 py-1 text-slate-900 disabled:opacity-60"
            value={room.settings.turnSeconds}
            disabled={!isHost}
            onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
          >
            {[10, 15, 20, 30, 45, 60].map((n) => (
              <option key={n} value={n}>
                {n} วินาที
              </option>
            ))}
          </select>
        </label>
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center justify-between gap-3">
            <span>
              {t.label}
              <span className="block text-xs text-white/50">{t.hint}</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-amber-400"
              checked={Boolean(room.settings[t.key])}
              disabled={!isHost}
              onChange={(e) => set({ [t.key]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <div className="sticky bottom-3 flex gap-2">
        {isHost ? (
          <button
            className="btn btn-primary flex-1 text-lg"
            disabled={!humansReady}
            onClick={() => act('room:start', {})}
            title={humansReady ? '' : 'รอผู้เล่นกดพร้อม'}
          >
            เริ่มเกม
          </button>
        ) : (
          <button
            className={`btn flex-1 text-lg ${mySeat?.ready ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => act('room:ready', { ready: !mySeat?.ready })}
          >
            {mySeat?.ready ? 'ยกเลิกพร้อม' : 'พร้อม'}
          </button>
        )}
      </div>
      {isHost && !humansReady && <p className="text-center text-sm text-white/60">รอผู้เล่นทุกคนกดพร้อม</p>}

      <Chat />
      {rules && <RulesSheet onClose={() => setRules(false)} />}
    </main>
  );
}
