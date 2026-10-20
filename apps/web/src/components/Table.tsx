import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CardId, Combo, LogEntry, PlayerView as View, Role, canBeat, cardLabel, classify, isBomb, legalMoves } from '@slave/engine';
import type { PlayerView, RoomView } from '@slave/shared';
import { act } from '../net';
import { MessageKey, useT } from '../i18n';
import { toast, useStore } from '../store';
import { useNow } from '../hooks';
import { isMuted, setMuted } from '../sound';
import type { IconName } from '../icons/paths';
import PlayingCard, { CardBack } from './PlayingCard';
import Chat from './Chat';
import RulesSheet from './RulesSheet';
import Icon from './Icon';
import TrickPile from './TrickPile';

type T = ReturnType<typeof useT>;

/** Why the selected cards cannot be played right now, or null when they can (or nothing is selected). */
function blockedReason(t: T, game: View, selected: CardId[], combo: Combo | null): string | null {
  if (!selected.length || game.phase !== 'playing' || game.turn !== game.you) return null;
  if (!combo) return t('reason.invalid');
  if (game.mustInclude != null && !selected.includes(game.mustInclude)) return t('reason.mustThree');
  const pile = game.pile;
  const bombs = game.settings.bombs ?? false;
  if (!pile || canBeat(combo, pile, game.revolution, bombs)) return null;
  if (bombs && pile.type === 'pair' && combo.type === 'triple') return t('reason.tripleOnPair');
  if (bombs && pile.type === 'single' && combo.type === 'quad') return t('reason.quadOnSingle');
  const extra = bombs && pile.type === 'single' ? t('reason.orTriple') : bombs && pile.type === 'pair' ? t('reason.orQuad') : '';
  return t('reason.beat', { combo: t(`combo.${pile.type}` as MessageKey), card: cardLabel(pile.high) }) + extra;
}

/** Role icons share the court set; the engine's 'queen' is shown as the Noble. */
export const ROLE_ICON: Record<Role, IconName> = {
  king: 'king',
  queen: 'noble',
  commoner: 'commoner',
  peasant: 'peasant',
  slave: 'slave',
};

const roleLabel = (t: T, r: Role) => t(`role.${r}` as MessageKey);
const comboLabel = (t: T, c: string) => t(`combo.${c}` as MessageKey);

function useNames(room: RoomView, game: PlayerView | null) {
  return useMemo(() => {
    const m: Record<string, string> = {};
    game?.seats.forEach((id, i) => (m[id] = room.seats[i]?.name || '?'));
    return m;
  }, [room, game]);
}

function logText(t: T, e: LogEntry, name: (id: string) => string): string {
  switch (e.t) {
    case 'round':
      return t('log.round', { n: e.round });
    case 'play':
      return t(e.bomb ? 'log.bomb' : 'log.play', {
        name: name(e.p),
        combo: comboLabel(t, e.combo),
        cards: e.cards.map(cardLabel).join(' '),
      });
    case 'pass':
      return t('log.pass', { name: name(e.p) });
    case 'clear':
      return t('log.clear', { name: name(e.next) });
    case 'finish':
      return t('log.finish', { name: name(e.p), n: e.place + 1 }) + (e.penalized ? t('log.penalized') : '');
    case 'revolution':
      return e.on ? t('log.revOn') : t('log.revOff');
    case 'exchange':
      return t('log.exchange', { from: name(e.from), to: name(e.to), n: e.count });
    case 'roundEnd':
      return t('log.roundEnd', { order: e.order.map(name).join(' > ') });
  }
}

export default function Table({ room }: { room: RoomView }) {
  const t = useT();
  const game = useStore((s) => s.game);
  const navigate = useNavigate();
  const now = useNow(200);
  const names = useNames(room, game);
  const [selected, setSelected] = useState<CardId[]>([]);
  const [panel, setPanel] = useState<'none' | 'log' | 'chat'>('none');
  const [rules, setRules] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [sending, setSending] = useState(false);

  // Drop selections that are no longer in hand (after playing or exchanging).
  useEffect(() => {
    if (game) setSelected((sel) => sel.filter((c) => game.myHand.includes(c)));
  }, [game?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) return <div className="flex h-full items-center justify-center opacity-70">{t('table.dealing')}</div>;

  const name = (id: string) => names[id] ?? '?';
  const me = game.you;
  const myIndex = game.seats.indexOf(me);
  const others = [...game.seats.slice(myIndex + 1), ...game.seats.slice(0, myIndex)];
  const myTurn = game.phase === 'playing' && game.turn === me;
  const turnMs = room.settings.turnSeconds * 1000;
  const remaining = room.deadline ? Math.max(0, room.deadline - now) : 0;

  const combo = selected.length ? classify(selected, game.settings) : null;
  const bombs = game.settings.bombs ?? false;
  const canPlay =
    myTurn &&
    !!combo &&
    canBeat(combo, game.pile, game.revolution, bombs) &&
    (game.mustInclude == null || selected.includes(game.mustInclude));
  const bombing = !!combo && canPlay && isBomb(combo, game.pile, bombs);
  const reason = blockedReason(t, game, selected, combo);
  const canExchange = !!game.myExchange && selected.length === game.myExchange.count;

  const toggle = (c: CardId) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  async function send(kind: 'play' | 'pass' | 'exchange') {
    if (sending || !game) return;
    setSending(true);
    try {
      if (kind === 'pass') await act('game:pass', { version: game.version });
      else if (kind === 'play') await act('game:play', { cards: selected, version: game.version });
      else await act('exchange:give', { cards: selected, version: game.version });
      if (kind !== 'pass') setSelected([]);
    } finally {
      setSending(false);
    }
  }

  function hint() {
    if (!game) return;
    const moves = legalMoves(game.myHand, {
      pile: game.pile,
      revolution: game.revolution,
      mustInclude: game.mustInclude,
      allowStraights: game.settings.allowStraights,
      bombs,
    });
    if (!moves.length) {
      toast(t('table.noMove'));
      return;
    }
    const strength = (h: number) => (game.revolution ? 51 - h : h);
    // Suggest a normal follow before a bomb, then the weakest cards.
    const bombRank = (m: Combo) => (isBomb(m, game.pile, bombs) ? 1 : 0);
    moves.sort((a, b) => bombRank(a) - bombRank(b) || strength(a.high) - strength(b.high) || b.size - a.size);
    setSelected(moves[0].cards);
  }

  async function leave() {
    if (!confirm(t('table.leaveConfirm'))) return;
    await act('room:leave', {});
    navigate('/', { replace: true });
  }

  const status = (() => {
    if (game.phase === 'exchange') {
      if (game.myExchange) return t('status.chooseGive', { n: game.myExchange.count, name: name(game.myExchange.to) });
      return t('status.waitExchange', { names: game.pendingExchanges.map(name).join(', ') });
    }
    if (game.phase === 'roundEnd') return t('status.roundEnd');
    if (myTurn) {
      if (game.mustInclude != null) return t('status.mustThree');
      return game.pile ? t('status.beat') : t('status.lead');
    }
    return t('status.wait', { name: name(game.turn ?? '') });
  })();

  const iconBtn = 'btn btn-ghost px-2.5 py-1.5';

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="table">
      {/* Top bar */}
      <header className="flex items-center gap-1.5 whitespace-nowrap px-2 pt-2 text-sm sm:gap-2 sm:px-3">
        <button className={iconBtn} onClick={leave} aria-label={t('table.leave')}>
          <Icon name="back" size={18} />
        </button>
        <span className="hidden font-mono tracking-widest text-white/70 sm:inline">{room.code}</span>
        <span className="text-white/70">{t('table.round', { n: game.round })}</span>
        {game.revolution && (
          <span className="inline-flex items-center gap-1 rounded bg-fuchsia-700/80 px-2 py-0.5 text-xs font-medium">
            <Icon name="revolution" size={14} />
            {t('table.revolution')}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button className={iconBtn} onClick={() => setPanel(panel === 'log' ? 'none' : 'log')} aria-label={t('table.logTitle')}>
            <Icon name="log" size={18} />
            <span className="hidden sm:inline">{t('table.log')}</span>
          </button>
          <button className={iconBtn} onClick={() => setPanel(panel === 'chat' ? 'none' : 'chat')} aria-label={t('table.chat')}>
            <Icon name="chat" size={18} />
            <span className="hidden sm:inline">{t('table.chat')}</span>
          </button>
          <button
            className={iconBtn}
            aria-label={muted ? t('table.unmute') : t('table.mute')}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            <Icon name={muted ? 'mute' : 'sound'} size={18} />
          </button>
          <button className={iconBtn} onClick={() => setRules(true)} aria-label={t('table.rules')}>
            <Icon name="help" size={18} />
          </button>
        </span>
      </header>

      {/* Opponents */}
      <section className="flex justify-center gap-2 overflow-x-auto px-3 py-3">
        {others.map((id) => {
          const seat = room.seats[game.seats.indexOf(id)];
          const active = game.turn === id || game.pendingExchanges.includes(id);
          const finishedAt = game.finished.indexOf(id);
          const role = game.roles[id];
          return (
            <div
              key={id}
              data-testid="opponent"
              className={`panel min-w-[92px] flex-1 basis-0 p-2 text-center sm:max-w-[160px] ${active ? 'ring-2 ring-gold' : ''}`}
            >
              <p className="flex items-center justify-center gap-1 truncate text-sm font-medium">
                {role && <Icon name={ROLE_ICON[role]} size={16} className="text-gold" title={roleLabel(t, role)} />}
                <span className="truncate">{name(id)}</span>
              </p>
              <p className="flex items-center justify-center gap-1 text-xs text-white/60">
                {seat?.isBot && <Icon name="bot" size={13} title={t('table.bot')} />}
                {seat && !seat.connected && <Icon name="offline" size={13} className="text-amber-300" title={t('table.offline')} />}
                {t('table.cards', { n: game.handCounts[id] })}
              </p>
              <div className="mt-1 flex justify-center -space-x-4">
                {Array.from({ length: Math.min(game.handCounts[id], 8) }).map((_, i) => (
                  <CardBack key={i} />
                ))}
              </div>
              <p className="mt-1 h-4 text-xs">
                {finishedAt >= 0 ? (
                  <span className="text-emerald-300">{t('table.out', { n: finishedAt + 1 })}</span>
                ) : game.passed.includes(id) ? (
                  <span className="text-white/50">{t('table.passed')}</span>
                ) : null}
              </p>
              {active && room.deadline && (
                <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${(remaining / turnMs) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Pile */}
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden px-3" data-testid="pile">
        <TrickPile trick={game.trick ?? []} name={name} round={game.round} />
        {game.pile && (
          <p className="text-sm text-white/70">
            {t('table.played', { name: name(game.lastPlayer ?? ''), combo: comboLabel(t, game.pile.type) })}
          </p>
        )}
      </section>

      {/* Status & my info */}
      <section className="px-3 text-center">
        <p className={`text-lg font-normal ${myTurn || game.myExchange ? 'text-gold' : ''}`} data-testid="status">
          {status}
        </p>
        <p className="flex items-center justify-center gap-1 text-xs text-white/60">
          {game.roles[me] && (
            <>
              <Icon name={ROLE_ICON[game.roles[me]]} size={14} className="text-gold" />
              {roleLabel(t, game.roles[me])} ·
            </>
          )}
          <span>{t('table.score', { n: game.scores[me] ?? 0 })}</span>
          {(myTurn || game.myExchange) && room.deadline ? <span>· {t('table.timeLeft', { n: Math.ceil(remaining / 1000) })}</span> : null}
        </p>
        {game.phase === 'exchange' && game.received?.length ? (
          <p className="text-xs text-sky-300">{t('table.received', { cards: game.received.map(cardLabel).join(' ') })}</p>
        ) : null}
      </section>

      {/* Hand */}
      <section className="overflow-x-auto px-3 pt-6 pb-2" data-testid="hand">
        <div className="mx-auto flex w-max -space-x-6 sm:-space-x-5">
          {game.myHand.map((c) => (
            <PlayingCard
              key={c}
              id={c}
              selected={selected.includes(c)}
              highlight={game.phase === 'exchange' && !!game.received?.includes(c)}
              onClick={() => toggle(c)}
            />
          ))}
        </div>
      </section>

      {reason && (
        <p className="px-3 pb-1 text-center text-xs text-amber-300" role="status" data-testid="play-reason">
          {reason}
        </p>
      )}

      {/* Actions */}
      <section className="flex gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {game.phase === 'exchange' && game.myExchange ? (
          <button className="btn btn-primary flex-1" disabled={!canExchange || sending} onClick={() => send('exchange')}>
            {t('table.give', { n: selected.length, max: game.myExchange.count })}
          </button>
        ) : (
          <>
            <button className="btn btn-ghost flex-1" disabled={!myTurn || !game.pile || sending} onClick={() => send('pass')}>
              <Icon name="pass" size={18} />
              {t('table.pass')}
            </button>
            <button className="btn btn-ghost" disabled={!myTurn} onClick={hint} aria-label={t('table.hint')}>
              <Icon name="hint" size={20} />
            </button>
            <button className="btn btn-ghost" disabled={!selected.length} onClick={() => setSelected([])} aria-label={t('table.clear')}>
              <Icon name="close" size={18} />
            </button>
            <button
              className={`btn flex-1 ${bombing ? 'bg-orange-500 text-white' : 'btn-primary'}`}
              disabled={!canPlay || sending}
              onClick={() => send('play')}
            >
              <Icon name={bombing ? 'quick' : 'play'} size={18} />
              {bombing ? t('table.bomb') : t('table.play')}
              {combo ? ` (${comboLabel(t, combo.type)})` : ''}
            </button>
          </>
        )}
      </section>

      {/* Side panel: log or chat */}
      <AnimatePresence>
        {panel !== 'none' && (
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="fixed inset-y-0 right-0 z-30 flex w-[min(360px,90vw)] flex-col gap-2 border-l border-gold/20 bg-[#06140e]/95 p-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">
                {panel === 'log' ? t('table.logTitle') : t('table.chat')}
                <span className="ml-2 font-mono text-sm tracking-widest text-white/60">{t('table.room', { code: room.code })}</span>
              </h2>
              <button className="btn btn-ghost px-2.5 py-1" onClick={() => setPanel('none')} aria-label={t('common.close')}>
                <Icon name="close" size={18} />
              </button>
            </div>
            {panel === 'log' ? (
              <ol className="flex-1 space-y-1 overflow-y-auto text-sm">
                {[...game.log].reverse().map((e, i) => (
                  <li key={i} className="text-white/80">
                    {logText(t, e, name)}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="min-h-0 flex-1">
                <Chat compact />
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {game.phase === 'roundEnd' && <RoundSummary game={game} room={room} name={name} now={now} />}
      {rules && <RulesSheet onClose={() => setRules(false)} />}
    </div>
  );
}

function RoundSummary({ game, room, name, now }: { game: PlayerView; room: RoomView; name: (id: string) => string; now: number }) {
  const t = useT();
  const order = game.result ?? [];
  const left = room.nextRoundAt ? Math.max(0, Math.ceil((room.nextRoundAt - now) / 1000)) : 0;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" data-testid="round-summary">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-2xl border border-gold/25 bg-[#0a1a13] p-5"
      >
        <h2 className="mb-3 flex items-center justify-center gap-2 text-xl font-normal tracking-wide text-gold">
          <Icon name="trophy" size={22} />
          {t('summary.title', { n: game.round })}
        </h2>
        <ol className="space-y-2">
          {order.map((id, i) => {
            const role = game.roles[id];
            return (
              <li
                key={id}
                className={`flex items-center justify-between rounded-xl px-3 py-2 ${id === game.you ? 'bg-gold/15' : 'bg-white/5'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-4 text-white/50">{i + 1}</span>
                  {role && <Icon name={ROLE_ICON[role]} size={18} className="text-gold" />}
                  {name(id)}
                  {role && <span className="text-xs text-white/60">{roleLabel(t, role)}</span>}
                </span>
                <span className="font-mono">{game.scores[id]}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-center text-sm text-white/70">{t('summary.next', { n: left })}</p>
      </motion.div>
    </div>
  );
}
