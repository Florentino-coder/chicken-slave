import { MessageKey, useT } from '../i18n';
import { Signature } from './Icon';

const LINES = Array.from({ length: 11 }, (_, i) => `rules.${i + 1}` as MessageKey);

export default function RulesSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-gold/20 bg-[#0a1a13] p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('rules.title')}
      >
        <h2 className="mb-3 text-xl font-normal tracking-wide text-gold">{t('rules.title')}</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-white/85">
          {LINES.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <button className="btn btn-primary mt-5 w-full" onClick={onClose}>
          {t('rules.ok')}
        </button>
        <Signature className="mt-4 text-center" />
      </div>
    </div>
  );
}
