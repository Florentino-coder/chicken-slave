import { FormEvent, useEffect, useRef, useState } from 'react';
import { CHAT_MAX } from '@slave/shared';
import { act } from '../net';
import { useStore } from '../store';

const REACTIONS = ['👍', '😂', '😱', '🔥', 'GG', 'เร็วๆ'];

export default function Chat({ compact = false }: { compact?: boolean }) {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.guest?.guestId);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    act('chat:send', { text: t });
    setText('');
  }

  return (
    <section className={`panel flex flex-col gap-2 p-3 ${compact ? 'h-full' : ''}`}>
      <div ref={listRef} className={`space-y-1 overflow-y-auto text-sm ${compact ? 'min-h-0 flex-1' : 'max-h-40'}`}>
        {chat.length === 0 && <p className="text-white/40">ยังไม่มีข้อความ</p>}
        {chat.map((m) => (
          <p key={m.id} className="break-words">
            <span className={m.from === me ? 'text-amber-300' : 'text-emerald-300'}>{m.name}:</span> {m.text}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {REACTIONS.map((r) => (
          <button key={r} className="rounded-lg bg-white/10 px-2 py-1 text-sm" onClick={() => act('chat:send', { text: r })}>
            {r}
          </button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={submit}>
        <input
          className="input py-1.5 text-sm"
          value={text}
          maxLength={CHAT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="พิมพ์ข้อความ…"
          aria-label="ข้อความแชต"
        />
        <button className="btn btn-ghost py-1.5" type="submit">
          ส่ง
        </button>
      </form>
    </section>
  );
}
