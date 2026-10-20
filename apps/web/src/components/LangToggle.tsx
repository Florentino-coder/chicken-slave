import { setLang, useT } from '../i18n';
import { useStore } from '../store';
import Icon from './Icon';

export default function LangToggle({ compact = false }: { compact?: boolean }) {
  const lang = useStore((s) => s.lang);
  const t = useT();
  return (
    <button
      className={`btn btn-ghost ${compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5 text-sm'}`}
      onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
      aria-label={t('lang.label')}
      data-testid="lang-toggle"
    >
      <Icon name="globe" size={18} />
      {!compact && <span>{t('lang.switch')}</span>}
    </button>
  );
}
