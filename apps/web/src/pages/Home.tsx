import { FormEvent, useEffect, useState } from 'react';
import { ROOM_CODE_ALPHABET, NAME_MAX } from '@slave/shared';
import { act, ensureGuest, errorText, send } from '../net';
import { useT } from '../i18n';
import { toast, useStore } from '../store';
import { useNow } from '../hooks';
import RulesSheet from '../components/RulesSheet';
import Icon, { Logo, Signature } from '../components/Icon';
import LangToggle from '../components/LangToggle';

export default function Home() {
  const t = useT();
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
      toast(t('home.codeLength'), 'error');
      return;
    }
    await run(async () => {
      const r = await send('room:join', { code: c, password: password || undefined });
      if (r.ok) return;
      if (r.error === 'wrong_password') {
        setNeedPassword(true);
        toast(password ? t('home.wrongPassword') : t('home.needPassword'), 'error');
      } else {
        toast(errorText(r.error), 'error');
      }
    });
  }

  const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex justify-end">
        <LangToggle />
      </div>
      <header className="flex flex-col items-center text-center">
        <Logo size={88} />
        <p className="mt-3 text-sm text-white/65">{t('app.tagline')}</p>
      </header>

      <section className="panel space-y-3 p-4">
        <label className="block text-sm text-white/80" htmlFor="name">
          {t('home.nameLabel')}
        </label>
        <input
          id="name"
          className="input"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          placeholder={t('home.namePlaceholder')}
        />

        {quick.queued ? (
          <div className="rounded-xl bg-white/10 p-3 text-center">
            <p className="font-medium">{t('home.searching', { n: quick.size })}</p>
            {quick.startsAt && (
              <p className="text-sm text-white/70">
                {t('home.fillBots', { s: Math.max(0, Math.ceil((quick.startsAt - now) / 1000)) })}
              </p>
            )}
            <button className="btn btn-ghost mt-2" onClick={() => act('quick:leave', {})}>
              {t('home.cancel')}
            </button>
          </div>
        ) : (
          <button className="btn btn-primary w-full text-lg" disabled={busy || !connected} onClick={quickPlay}>
            <Icon name="quick" size={22} />
            {t('home.quick')}
          </button>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="font-medium">{t('home.createTitle')}</h2>
        <input
          className="input"
          value={newPassword}
          maxLength={32}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t('home.passwordOptional')}
          aria-label={t('home.newPasswordLabel')}
        />
        <button className="btn btn-ghost w-full" disabled={busy || !connected} onClick={create}>
          <Icon name="plus" size={18} />
          {t('home.create')}
        </button>
      </section>

      <form className="panel space-y-3 p-4" onSubmit={join}>
        <h2 className="font-medium">{t('home.joinTitle')}</h2>
        <input
          className="input text-center font-mono text-xl tracking-[0.4em] uppercase"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(allowed, ''))}
          placeholder="ABC123"
          aria-label={t('home.codeLabel')}
          autoCapitalize="characters"
        />
        {needPassword && (
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('home.password')}
            aria-label={t('home.password')}
          />
        )}
        <button className="btn btn-ghost w-full" type="submit" disabled={busy || !connected}>
          <Icon name="enter" size={18} />
          {t('home.join')}
        </button>
      </form>

      <button className="mx-auto inline-flex items-center gap-1.5 text-sm text-white/70 underline-offset-4 hover:underline" onClick={() => setShowRules(true)}>
        <Icon name="help" size={16} />
        {t('home.rules')}
      </button>
      {!connected && <p className="text-center text-sm text-amber-300">{t('app.connecting')}</p>}
      <footer className="pt-2 text-center">
        <Signature />
      </footer>
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
    </main>
  );
}
