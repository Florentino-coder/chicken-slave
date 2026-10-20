import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CardId, LogEntry, Role, canBeat, cardLabel, classify, legalMoves } from '@slave/engine';
import type { PlayerView, RoomView } from '@slave/shared';
import { act } from '../net';
import { toast, useStore } from '../store';
import { useNow } from '../hooks';
import { isMuted, setMuted } from '../sound';
import PlayingCard, { CardBack } from './PlayingCard';
import Chat from './Chat';
import RulesSheet from './RulesSheet';

export const ROLE_TEXT: Record<Role, { icon: string; label: string }> = {
  king: { icon: '👑', label: 'กษัตริย์' },
  queen: { icon: '🎩', label: 'ขุนนาง' },
  commoner: { icon: '🙂', label: 'ประชาชน' },
  peasant: { icon: '🌾', label: 'ไพร่' },
  slave: { icon: '⛓️', label: 'ทาส' },
};

const COMBO_TEXT = { single: 'เดี่ยว', pair: 'คู่', triple: 'ตอง', quad: 'โฟร์', straight: 'เรียง' } as const;

function useNames(room: RoomView, game: PlayerView | null) {
  return useMemo(() => {
    const m: Record<string, string> = {};
    game?.seats.forEach((id, i) => (m[id] = room.seats[i]?.name || '?'));
    return m;
  }, [room, game]);
}

function logText(e: LogEntry, name: (id: string) => string): string {
  switch (e.t) {
    case 'round':
      return `— เริ่มรอบที่ ${e.round} —`;
    case 'play':
      return `${name(e.p)} ลง${COMBO_TEXT[e.combo]} ${e.cards.map(cardLabel).join(' ')}`;
    case 'pass':
      return `${name(e.p)} ผ่าน`;
    case 'clear':
      return `ทุกคนผ่าน ${name(e.next)} เปิดกองใหม่`;
    case 'finish':
      return `${name(e.p)} หมดมือ! อันดับ ${e.place + 1}${e.penalized ? ' (จบด้วย 2 โดนปรับตกท้าย)' : ''}`;
    case 'revolution':
      return e.on ? '⚡ ปฏิวัติ! ลำดับไพ่กลับด้าน' : '⚡ ปฏิวัติซ้อน ลำดับไพ่กลับปกติ';
    case 'exchange':
      return `${name(e.from)} คืนไพ่ ${e.count} ใบให้ ${name(e.to)}`;
    case 'roundEnd':
      return `จบรอบ: ${e.order.map(name).join(' > ')}`;
  }
}

export default function Table({ room }: { room: RoomView }) {
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

  if (!game) return <div className="flex h-full items-center justify-center opacity-70">กำลังแจกไพ่…</div>;

  const name = (id: string) => names[id] ?? '?';
  const me = game.you;
  const myIndex = game.seats.indexOf(me);
  const others = [...game.seats.slice(myIndex + 1), ...game.seats.slice(0, myIndex)];
  const myTurn = game.phase === 'playing' && game.turn === me;
  const turnMs = room.settings.turnSeconds * 1000;
  const remaining = room.deadline ? Math.max(0, room.deadline - now) : 0;

  const combo = selected.length ? classify(selected, game.settings) : null;
  const canPlay =
    myTurn &&
    !!combo &&
    canBeat(combo, game.pile, game.revolution) &&
    (game.mustInclude == null || selected.includes(game.mustInclude));
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
    });
    if (!moves.length) {
      toast('ไม่มีไพ่ที่ลงได้ ต้องผ่าน');
      return;
    }
    const strength = (h: number) => (game.revolution ? 51 - h : h);
    moves.sort((a, b) => strength(a.high) - strength(b.high) || b.size - a.size);
    setSelected(moves[0].cards);
  }

  async function leave() {
    if (!confirm('ออกจากเกม? บอทจะเล่นแทนคุณ')) return;
    await act('room:leave', {});
    navigate('/', { replace: true });
  }

  const status = (() => {
    if (game.phase === 'exchange') {
      if (game.myExchange) return `เลือกไพ่ ${game.myExchange.count} ใบเพื่อคืนให้ ${name(game.myExchange.to)}`;
      return `รอ ${game.pendingExchanges.map(name).join(', ')} เลือกไพ่คืน`;
    }
    if (game.phase === 'roundEnd') return 'จบรอบ';
    if (myTurn) {
      if (game.mustInclude != null) return 'ตาคุณ! ต้องลงไพ่ที่มี 3♣';
      return game.pile ? 'ตาคุณ! ลงไพ่ที่ใหญ่กว่า หรือผ่าน' : 'ตาคุณ! เปิดกองใหม่';
    }
    return `รอ ${name(game.turn ?? '')}`;
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="table">
      {/* Top bar */}
      <header className="flex items-center gap-1.5 px-2 pt-2 text-sm whitespace-nowrap sm:gap-2 sm:px-3">
        <button className="btn btn-ghost px-2.5 py-1.5" onClick={leave} aria-label="ออกจากเกม">
          ←
        </button>
        <span className="hidden font-mono tracking-widest text-white/70 sm:inline">{room.code}</span>
        <span className="text-white/70">รอบ {game.round}</span>
        {game.revolution && <span className="rounded bg-fuchsia-600 px-2 py-0.5 text-xs font-bold">⚡ ปฏิวัติ</span>}
        <span className="ml-auto flex gap-1">
          <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => setPanel(panel === 'log' ? 'none' : 'log')} aria-label="บันทึกการเล่น">
            📜<span className="hidden sm:inline"> บันทึก</span>
          </button>
          <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => setPanel(panel === 'chat' ? 'none' : 'chat')} aria-label="แชต">
            💬<span className="hidden sm:inline"> แชต</span>
          </button>
          <button
            className="btn btn-ghost px-2.5 py-1.5"
            aria-label={muted ? 'เปิดเสียง' : 'ปิดเสียง'}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => setRules(true)} aria-label="กติกา">
            ?
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
              className={`panel min-w-[92px] flex-1 basis-0 p-2 text-center sm:max-w-[160px] ${active ? 'ring-2 ring-amber-400' : ''}`}
            >
              <p className="truncate text-sm font-semibold">
                {role && <span title={ROLE_TEXT[role].label}>{ROLE_TEXT[role].icon} </span>}
                {name(id)}
              </p>
              <p className="text-xs text-white/60">
                {seat?.isBot ? '🤖 ' : ''}
                {seat && !seat.connected ? 'หลุด · ' : ''}
                {game.handCounts[id]} ใบ
              </p>
              <div className="mt-1 flex justify-center -space-x-4">
                {Array.from({ length: Math.min(game.handCounts[id], 8) }).map((_, i) => (
                  <CardBack key={i} />
                ))}
              </div>
              <p className="mt-1 h-4 text-xs">
                {finishedAt >= 0 ? (
                  <span className="text-emerald-300">หมดมือ #{finishedAt + 1}</span>
                ) : game.passed.includes(id) ? (
                  <span className="text-white/50">ผ่าน</span>
                ) : null}
              </p>
              {active && room.deadline && (
                <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-amber-400 transition-[width] duration-200" style={{ width: `${(remaining / turnMs) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Pile */}
      <section className="flex flex-1 flex-col items-center justify-center gap-2 px-3" data-testid="pile">
        <AnimatePresence mode="popLayout">
          {game.pile ? (
            <motion.div
              key={game.pile.cards.join(',')}
              initial={{ scale: 0.6, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="flex gap-1">
                {game.pile.cards.map((c) => (
                  <PlayingCard key={c} id={c} />
                ))}
              </div>
              <p className="text-sm text-white/70">
                {name(game.lastPlayer ?? '')} ลง{COMBO_TEXT[game.pile.type]}
              </p>
            </motion.div>
          ) : (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-white/50">
              กองว่าง
            </motion.p>
          )}
        </AnimatePresence>
      </section>

      {/* Status & my info */}
      <section className="px-3 text-center">
        <p className={`text-lg font-semibold ${myTurn || game.myExchange ? 'text-amber-300' : ''}`} data-testid="status">
          {status}
        </p>
        <p className="text-xs text-white/60">
          {game.roles[me] && `${ROLE_TEXT[game.roles[me]].icon} ${ROLE_TEXT[game.roles[me]].label} · `}
          คะแนน {game.scores[me] ?? 0}
          {(myTurn || game.myExchange) && room.deadline ? ` · เหลือ ${Math.ceil(remaining / 1000)} วิ` : ''}
        </p>
        {game.phase === 'exchange' && game.received?.length ? (
          <p className="text-xs text-sky-300">ได้รับ: {game.received.map(cardLabel).join(' ')}</p>
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

      {/* Actions */}
      <section className="flex gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {game.phase === 'exchange' && game.myExchange ? (
          <button className="btn btn-primary flex-1" disabled={!canExchange || sending} onClick={() => send('exchange')}>
            ให้ไพ่ {selected.length}/{game.myExchange.count}
          </button>
        ) : (
          <>
            <button className="btn btn-ghost flex-1" disabled={!myTurn || !game.pile || sending} onClick={() => send('pass')}>
              ผ่าน
            </button>
            <button className="btn btn-ghost" disabled={!myTurn} onClick={hint}>
              💡
            </button>
            <button className="btn btn-ghost" disabled={!selected.length} onClick={() => setSelected([])} aria-label="ล้างที่เลือก">
              ✕
            </button>
            <button className="btn btn-primary flex-1" disabled={!canPlay || sending} onClick={() => send('play')}>
              ลงไพ่{combo ? ` (${COMBO_TEXT[combo.type]})` : ''}
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
            className="fixed inset-y-0 right-0 z-30 flex w-[min(360px,90vw)] flex-col gap-2 bg-slate-950/95 p-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {panel === 'log' ? 'บันทึกการเล่น' : 'แชต'}
                <span className="ml-2 font-mono text-sm tracking-widest text-white/60">ห้อง {room.code}</span>
              </h2>
              <button className="btn btn-ghost px-3 py-1" onClick={() => setPanel('none')}>
                ✕
              </button>
            </div>
            {panel === 'log' ? (
              <ol className="flex-1 space-y-1 overflow-y-auto text-sm">
                {[...game.log].reverse().map((e, i) => (
                  <li key={i} className="text-white/80">
                    {logText(e, name)}
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
  const order = game.result ?? [];
  const left = room.nextRoundAt ? Math.max(0, Math.ceil((room.nextRoundAt - now) / 1000)) : 0;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" data-testid="round-summary">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm rounded-2xl bg-slate-900 p-5">
        <h2 className="mb-3 text-center text-xl font-bold">จบรอบที่ {game.round}</h2>
        <ol className="space-y-2">
          {order.map((id, i) => (
            <li key={id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${id === game.you ? 'bg-amber-400/20' : 'bg-white/5'}`}>
              <span>
                {i + 1}. {ROLE_TEXT[game.roles[id]]?.icon} {name(id)}
                <span className="ml-1 text-xs text-white/60">{ROLE_TEXT[game.roles[id]]?.label}</span>
              </span>
              <span className="font-mono">{game.scores[id]}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-center text-sm text-white/70">รอบต่อไปเริ่มใน {left} วินาที</p>
      </motion.div>
    </div>
  );
}
