import { ICONS, IconName, LOGO_MARK } from '../icons/paths';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible name; without it the icon is decorative and hidden from screen readers. */
  title?: string;
}

export default function Icon({ name, size = 20, className, title }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className ?? ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      // Paths are static strings from icons/paths.ts, never user input.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function LogoMark({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
      dangerouslySetInnerHTML={{ __html: LOGO_MARK }}
    />
  );
}

/** Mark plus wordmark. */
export function Logo({ size = 72, stacked = true }: { size?: number; stacked?: boolean }) {
  return (
    <div className={`flex items-center text-gold ${stacked ? 'flex-col gap-3' : 'gap-2'}`}>
      <LogoMark size={size} />
      <span
        className={`font-light uppercase text-gold ${stacked ? 'text-3xl tracking-[0.28em] sm:text-4xl' : 'text-base tracking-[0.2em]'}`}
      >
        Chicken Slave
      </span>
    </div>
  );
}

export function Signature({ className = '' }: { className?: string }) {
  return <p className={`text-[11px] font-light uppercase tracking-[0.35em] text-gold/60 ${className}`}>By Florentino</p>;
}
