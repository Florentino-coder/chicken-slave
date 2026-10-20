import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NAME_MAX } from '@slave/shared';
import { ensureGuest, errorText, send } from '../net';
import { toast, useStore } from '../store';
import Lobby from '../components/Lobby';
import Table from '../components/Table';

interface RoomInfo {
  exists: boolean;
  status?: 'lobby' | 'playing';
  hasPassword?: boolean;
  players?: number;
  capacity?: number;
}

export default function RoomPage() {
  const { code = '' } = useParams();
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);

  if (room && room.code === code.toUpperCase()) {
    return room.status === 'lobby' ? <Lobby room={room} /> : <Table room={room} />;
  }
  if (!connected) return <div className="flex h-full items-center justify-center opacity-70">กำลังเชื่อมต่อ…</div>;
  return <Invite code={code.toUpperCase()} />;
}

/** Landing page for an invite link: set a nickname and join. */
function Invite({ code }: { code: string }) {
  const guest = useStore((s) => s.guest);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [name, setName] = useState(guest?.name ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`/api/rooms/${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ exists: false }));
  }, [code]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const n = name.trim();
      if (n && n !== guest?.name) {
        const r = await send('profile:update', { name: n });
        if (r.ok) await ensureGuest(r.data.name);
      }
      const r = await send('room:join', { code, password: password || undefined });
      if (!r.ok && r.error === 'wrong_password' && !password) toast('ห้องนี้ต้องใช้รหัสผ่าน', 'error');
      else if (!r.ok) toast(errorText(r.error), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="flex h-full items-center justify-center opacity-70">กำลังโหลดห้อง…</div>;

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 px-4 py-8">
      <div className="panel space-y-4 p-5">
        <div className="text-center">
          <p className="text-sm text-white/70">คุณได้รับเชิญเข้าห้อง</p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em]">{code}</p>
        </div>
        {!info.exists ? (
          <>
            <p className="text-center text-amber-300">ไม่พบห้องนี้ หรือห้องถูกปิดไปแล้ว</p>
            <button className="btn btn-primary w-full" onClick={() => navigate('/')}>
              กลับหน้าแรก
            </button>
          </>
        ) : info.status === 'playing' ? (
          <>
            <p className="text-center text-amber-300">ห้องนี้กำลังเล่นอยู่ เข้าร่วมกลางเกมไม่ได้</p>
            <Link to="/" className="btn btn-primary block w-full text-center">
              กลับหน้าแรก
            </Link>
          </>
        ) : (
          <form className="space-y-3" onSubmit={join}>
            <p className="text-center text-sm text-white/70">
              ผู้เล่น {info.players}/{info.capacity}
            </p>
            <input
              className="input"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อเล่นของคุณ"
              aria-label="ชื่อเล่น"
            />
            {info.hasPassword && (
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="รหัสผ่านห้อง"
                aria-label="รหัสผ่านห้อง"
              />
            )}
            <button className="btn btn-primary w-full" type="submit" disabled={busy}>
              เข้าห้อง
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
