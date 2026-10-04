import { cn } from "@/lib/cn";

/**
 * ShortClips-merkteken: blauwe gradient-mark met witte play-driehoek, plus
 * het woordmerk. Geen bestandsafhankelijkheid, dus altijd scherp.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="sc-logo-grad" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%" stopColor="#5BC5FF" />
          <stop offset="100%" stopColor="#1B5FE0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#sc-logo-grad)" />
      <path d="M16 13.2 27.4 20 16 26.8V13.2Z" fill="white" />
    </svg>
  );
}

export function Logo({
  size = 32,
  showSubtitle = false,
  onDark = false,
  className,
}: {
  size?: number;
  showSubtitle?: boolean;
  /** Op donkere vlakken moet het woordmerk wit zijn in plaats van indigo. */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <div className="leading-none">
        <span
          className="font-semibold tracking-tight"
          style={{ fontSize: size * 0.55 }}
        >
          <span className={onDark ? "text-white" : "text-[var(--color-ink)]"}>
            Short
          </span>
          <span className={onDark ? "text-[var(--color-brand-300)]" : "text-[var(--color-brand-500)]"}>
            clips
          </span>
        </span>
        {showSubtitle ? (
          <div className={cn("mt-1 text-2xs font-semibold tracking-[0.18em] uppercase", onDark ? "text-white/50" : "text-[var(--color-ink-faint)]")}>
            Operating System
          </div>
        ) : null}
      </div>
    </div>
  );
}
