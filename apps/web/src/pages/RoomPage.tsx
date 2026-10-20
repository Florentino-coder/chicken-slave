import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NAME_MAX } from '@slave/shared';
import { ensureGuest, errorText, send } from '../net';
import { useT } from '../i18n';
import { toast, useStore } from '../store';
import Lobby from '../components/Lobby';
import Table from '../components/Table';
import { LogoMark, Signature } from '../components/Icon';
import LangToggle from '../components/LangToggle';

interface RoomInfo {
  exists: boolean;
  status?: 'lobby' | 'playing';
  hasPassword?: boolean;
  players?: number;
  capacity?: number;
}

export default function RoomPage() {
  const t = useT();
  const { code = '' } = useParams();
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);

  if (room && room.code === code.toUpperCase()) {
    return room.status === 'lobby' ? <Lobby room={room} /> : <Table room={room} />;
  }
  if (!connected) return <div className="flex h-full items-center justify-center opacity-70">{t('app.connecting')}</div>;
  return <Invite code={code.toUpperCase()} />;
}

/** Landing page for an invite link: set a nickname and join. */
function Invite({ code }: { code: string }) {
  const t = useT();
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
      if (!r.ok && r.error === 'wrong_password' && !password) toast(t('home.needPassword'), 'error');
      else if (!r.ok) toast(errorText(r.error), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="flex h-full items-center justify-center opacity-70">{t('invite.loading')}</div>;

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 px-4 py-8">
      <div className="flex justify-end">
        <LangToggle />
      </div>
      <div className="panel space-y-4 p-5">
        <div className="flex flex-col items-center text-center text-gold">
          <LogoMark size={56} />
          <p className="mt-2 text-sm text-white/70">{t('invite.invited')}</p>
          <p className="font-mono text-3xl tracking-[0.3em]">{code}</p>
        </div>
        {!info.exists ? (
          <>
            <p className="text-center text-amber-300">{t('invite.notFound')}</p>
            <button className="btn btn-primary w-full" onClick={() => navigate('/')}>
              {t('invite.home')}
            </button>
          </>
        ) : info.status === 'playing' ? (
          <>
            <p className="text-center text-amber-300">{t('invite.playing')}</p>
            <Link to="/" className="btn btn-primary w-full">
              {t('invite.home')}
            </Link>
          </>
        ) : (
          <form className="space-y-3" onSubmit={join}>
            <p className="text-center text-sm text-white/70">{t('invite.players', { n: info.players ?? 0, max: info.capacity ?? 4 })}</p>
            <input
              className="input"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('invite.nickname')}
              aria-label={t('invite.nickname')}
            />
            {info.hasPassword && (
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('home.password')}
                aria-label={t('home.password')}
              />
            )}
            <button className="btn btn-primary w-full" type="submit" disabled={busy}>
              {t('home.join')}
            </button>
          </form>
        )}
      </div>
      <Signature className="text-center" />
    </main>
  );
}
