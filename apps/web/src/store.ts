import { useSyncExternalStore } from 'react';
import type { ChatMessage, PlayerView, RoomView } from '@slave/shared';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface AppState {
  guest: { guestId: string; name: string } | null;
  connected: boolean;
  room: RoomView | null;
  game: PlayerView | null;
  chat: ChatMessage[];
  quick: { queued: boolean; size: number; startsAt: number | null };
  toasts: Toast[];
}

let state: AppState = {
  guest: null,
  connected: false,
  room: null,
  game: null,
  chat: [],
  quick: { queued: false, size: 0, startsAt: null },
  toasts: [],
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-3) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
}

/** Small persisted preferences; storage may be unavailable (private mode). */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`slave:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`slave:${key}`, value);
    } catch {
      /* ignore */
    }
  },
};
