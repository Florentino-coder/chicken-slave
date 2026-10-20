import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RoomView, Settings } from '@slave/shared';
import { act } from '../net';
import { MessageKey, useT } from '../i18n';
import { toast, useStore } from '../store';
import RulesSheet from './RulesSheet';
import Chat from './Chat';
import Icon, { LogoMark, Signature } from './Icon';
import LangToggle from './LangToggle';

const TOGGLES: (keyof Settings)[] = ['passLock', 'allowStraights', 'revolution', 'noTwoFinish'];

export default function Lobby({ room }: { room: RoomView }) {
  const t = useT();
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
        await navigator.share({ title: t('lobby.shareTitle'), url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast(t('lobby.copied'));
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
          <Icon name="back" size={18} />
          {t('lobby.leave')}
        </button>
        <div className="flex flex-col items-center text-center text-gold">
          <LogoMark size={36} />
          <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-white/60">{t('lobby.code')}</p>
          <p className="font-mono text-2xl tracking-[0.3em]" data-testid="room-code">
            {room.code}
          </p>
        </div>
        <div className="flex gap-1.5">
          <LangToggle compact />
          <button className="btn btn-ghost px-2.5" onClick={() => setRules(true)} aria-label={t('lobby.rules')}>
            <Icon name="help" size={18} />
          </button>
        </div>
      </header>

      <section className="panel p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input font-mono text-sm" readOnly value={link} aria-label={t('lobby.inviteLink')} />
          <button className="btn btn-primary shrink-0" onClick={copy}>
            <Icon name="link" size={18} />
            {t('lobby.invite')}
          </button>
        </div>
        {room.hasPassword && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
            <Icon name="lock" size={14} />
            {t('lobby.hasPassword')}
          </p>
        )}
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 flex items-center gap-2 font-medium">
          <Icon name="users" size={18} className="text-gold" />
          {t('lobby.players', { n: filled, max: room.seats.length })}
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {room.seats.map((s) => (
            <li key={s.seat} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2" data-testid="seat">
              {s.name ? (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      name={s.isBot ? 'bot' : s.guestId === room.hostId ? 'host' : 'commoner'}
                      size={18}
                      className="text-gold"
                    />
                    <span className="truncate">
                      {s.name}
                      {s.guestId === me && <span className="text-white/50"> {t('lobby.you')}</span>}
                    </span>
                    {!s.connected && (
                      <span className="flex items-center gap-1 text-xs text-amber-300">
                        <Icon name="offline" size={14} />
                        {t('lobby.offline')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {!s.isBot && (
                      <span className={`flex items-center gap-1 text-xs ${s.ready ? 'text-emerald-300' : 'text-white/50'}`}>
                        {s.ready && <Icon name="check" size={14} />}
                        {s.ready ? t('lobby.ready') : t('lobby.notReady')}
                      </span>
                    )}
                    {isHost && s.guestId !== me && (
                      <button
                        className="rounded-lg p-1 text-white/60 hover:bg-white/10"
                        aria-label={t('lobby.remove', { name: s.name })}
                        onClick={() => act('room:removeSeat', { seat: s.seat })}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </span>
                </>
              ) : (
                <span className="text-white/40">{isHost ? t('lobby.emptyHost') : t('lobby.empty')}</span>
              )}
            </li>
          ))}
        </ul>
        {isHost && filled < room.seats.length && (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => act('room:addBot', { level: 'easy' })}>
              <Icon name="bot" size={18} />
              {t('lobby.addEasy')}
            </button>
            <button className="btn btn-ghost flex-1" onClick={() => act('room:addBot', { level: 'medium' })}>
              <Icon name="bot" size={18} />
              {t('lobby.addMedium')}
            </button>
          </div>
        )}
      </section>

      <section className="panel space-y-3 p-4">
        <h2 className="font-medium">
          {t('lobby.settings')} {!isHost && <span className="text-xs text-white/50">{t('lobby.hostOnly')}</span>}
        </h2>
        <label className="flex items-center justify-between gap-3">
          <span>{t('lobby.playerCount')}</span>
          <select
            className="rounded-lg bg-white px-2 py-1 text-slate-900 disabled:opacity-60"
            value={room.settings.playerCount}
            disabled={!isHost}
            onChange={(e) => set({ playerCount: Number(e.target.value) })}
          >
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {t('lobby.playersN', { n })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>{t('lobby.turnTime')}</span>
          <select
            className="rounded-lg bg-white px-2 py-1 text-slate-900 disabled:opacity-60"
            value={room.settings.turnSeconds}
            disabled={!isHost}
            onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
          >
            {[10, 15, 20, 30, 45, 60].map((n) => (
              <option key={n} value={n}>
                {t('lobby.seconds', { n })}
              </option>
            ))}
          </select>
        </label>
        {TOGGLES.map((key) => (
          <label key={key} className="flex items-center justify-between gap-3">
            <span>
              {t(`rule.${key}` as MessageKey)}
              <span className="block text-xs text-white/50">{t(`rule.${key}.hint` as MessageKey)}</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-amber-400"
              checked={Boolean(room.settings[key])}
              disabled={!isHost}
              onChange={(e) => set({ [key]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <div className="sticky bottom-3 flex gap-2">
        {isHost ? (
          <button className="btn btn-primary flex-1 text-lg" disabled={!humansReady} onClick={() => act('room:start', {})}>
            <Icon name="play" size={22} />
            {t('lobby.start')}
          </button>
        ) : (
          <button
            className={`btn flex-1 text-lg ${mySeat?.ready ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => act('room:ready', { ready: !mySeat?.ready })}
          >
            {mySeat?.ready ? t('lobby.unready') : t('lobby.ready')}
          </button>
        )}
      </div>
      {isHost && !humansReady && <p className="text-center text-sm text-white/60">{t('lobby.waitReady')}</p>}

      <Chat />
      <Signature className="text-center" />
      {rules && <RulesSheet onClose={() => setRules(false)} />}
    </main>
  );
}
