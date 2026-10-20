import { prefs } from './store';

let ctx: AudioContext | null = null;

function beep(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.06) {
  if (prefs.get('muted') === '1') return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  card: () => beep(520, 90, 'triangle'),
  turn: () => {
    beep(660, 120);
    setTimeout(() => beep(880, 140), 120);
  },
  win: () => [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 180), i * 140)),
};

export function isMuted() {
  return prefs.get('muted') === '1';
}

export function setMuted(m: boolean) {
  prefs.set('muted', m ? '1' : '0');
}
