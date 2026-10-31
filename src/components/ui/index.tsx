import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { teamPhotoSrc } from "@/lib/team-photos";

/* ------------------------------ Kaart ------------------------------ */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn("sc-card", padded && "p-5", className)}>{children}</div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ Badge ------------------------------ */

const TONES = {
  neutral: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  info: "bg-[var(--color-info-soft)] text-[#0060a8]",
  good: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  warn: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  bad: "bg-[var(--color-bad-soft)] text-[#a3271c]",
  lime: "bg-[var(--color-lime-soft)] text-[#54700a]",
  // Paars = uitsluitend "interne controle / te checken" — overal dezelfde betekenis.
  violet: "bg-[var(--color-violet-soft)] text-[#5636c4]",
  ink: "bg-[var(--color-indigo-ink)] text-white",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          className="size-1.5 rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}

/* ------------------------------ Knop ------------------------------- */

const BUTTON_VARIANTS = {
  primary:
    "bg-[var(--color-indigo-ink)] text-white hover:bg-[var(--color-indigo-soft)] disabled:bg-[var(--color-ink-faint)]",
  accent:
    "bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)] disabled:bg-[var(--color-ink-faint)]",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]",
  ghost:
    "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]",
  danger: "bg-[var(--color-bad)] text-white hover:brightness-95",
} as const;

const BUTTON_SIZES = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
} as const;

type ButtonBase = {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  className?: string;
  children: ReactNode;
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: Omit<ButtonBase, "children">) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  children,
  ...rest
}: ButtonBase & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
}: ButtonBase & { href: string }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })}>
      {children}
    </Link>
  );
}

/* --------------------------- Kerncijfer ---------------------------- */

/**
 * Toon → kleuraccent voor KPI-blokken. Subtiele getinte achtergrond + gekleurde
 * linkerrand + gekleurd cijfer, zodat functie (goed/aandacht/urgent) in één
 * oogopslag leesbaar is zonder felle vlakken. `neutral` blijft rustig wit.
 */
const STAT_ACCENT: Record<Tone, { bar: string; bg: string; value: string; chip: string }> = {
  neutral: { bar: "", bg: "", value: "text-[var(--color-ink)]", chip: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
  info: { bar: "var(--color-info)", bg: "bg-[var(--color-info-soft)]", value: "text-[#0060a8]", chip: "bg-[var(--color-info-soft)] text-[#0060a8]" },
  good: { bar: "var(--color-good)", bg: "bg-[var(--color-good-soft)]", value: "text-[#1d6b4c]", chip: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  warn: { bar: "var(--color-warn)", bg: "bg-[var(--color-warn-soft)]", value: "text-[#8a5300]", chip: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  bad: { bar: "var(--color-bad)", bg: "bg-[var(--color-bad-soft)]", value: "text-[#a3271c]", chip: "bg-[var(--color-bad-soft)] text-[#a3271c]" },
  lime: { bar: "var(--color-lime)", bg: "bg-[var(--color-lime-soft)]", value: "text-[#54700a]", chip: "bg-[var(--color-lime-soft)] text-[#54700a]" },
  violet: { bar: "var(--color-violet)", bg: "bg-[var(--color-violet-soft)]", value: "text-[#5636c4]", chip: "bg-[var(--color-violet-soft)] text-[#5636c4]" },
  ink: { bar: "var(--color-indigo-ink)", bg: "bg-[var(--color-neutral-soft)]", value: "text-[var(--color-ink)]", chip: "bg-[var(--color-indigo-ink)] text-white" },
};

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
  icon,
  delta,
  emphasis = false,
  onClick,
  active = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
  /** Optioneel icoon rechtsboven in een getinte chip. */
  icon?: ReactNode;
  /** Optionele trend; goodWhenUp bepaalt of stijgen groen of rood is. */
  delta?: { value: number; suffix?: string; goodWhenUp?: boolean } | null;
  /** Grotere nadruk voor het belangrijkste/urgente blok. */
  emphasis?: boolean;
  /** Maakt de tegel klikbaar (bijv. als filter). Negeert `href`. */
  onClick?: () => void;
  /** Toont de tegel als actief geselecteerd (alleen met `onClick`). */
  active?: boolean;
}) {
  const a = STAT_ACCENT[tone];
  const toned = tone !== "neutral";

  let deltaEl: ReactNode = null;
  if (delta && delta.value !== 0) {
    const up = delta.value > 0;
    const goodWhenUp = delta.goodWhenUp ?? true;
    const positive = up === goodWhenUp;
    deltaEl = (
      <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", positive ? "text-[var(--color-good)]" : "text-[var(--color-bad)]")}>
        {up ? "▲" : "▼"} {Math.abs(delta.value)}{delta.suffix ?? "%"}
      </span>
    );
  }

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
          {label}
        </p>
        {icon ? (
          <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5", a.chip)}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className={cn("font-semibold tabular-nums", emphasis ? "text-3xl" : "text-2xl", toned ? a.value : "text-[var(--color-ink)]")}>
          {value}
        </p>
        {deltaEl}
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      ) : null}
    </>
  );

  const style = toned ? { borderLeft: `3px solid ${a.bar}` } : undefined;
  const cls = cn("sc-card p-4", toned && a.bg);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(cls, "block w-full cursor-pointer text-left transition hover:shadow-[var(--shadow-raised)]", active && "shadow-[var(--shadow-raised)] ring-2 ring-[var(--color-indigo-ink)] ring-offset-1 ring-offset-[var(--color-bg)]")}
        style={style}
      >
        {body}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={cn(cls, "block transition-shadow hover:shadow-[var(--shadow-raised)]")} style={style}>
        {body}
      </Link>
    );
  }
  return <div className={cls} style={style}>{body}</div>;
}

/* ------------------------- Lege toestand --------------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="text-[var(--color-ink-faint)]">{icon}</div> : null}
      <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-ink-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------------------------- Skeleton ----------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("sc-skeleton", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/* ----------------------------- Avatar ------------------------------ */

export function Avatar({
  name,
  color,
  size = 28,
  src,
}: {
  name: string;
  color?: string | null;
  size?: number;
  src?: string | null;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        title={name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="inline-block shrink-0 rounded-full object-cover"
      />
    );
  }
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color ?? "var(--color-indigo-soft)",
        fontSize: Math.round(size * 0.38),
      }}
      title={name}
    >
      {letters}
    </span>
  );
}

/* ---------------------------- Klantlogo ---------------------------- */

/**
 * Centrale weergave van een klant: het bedrijfslogo op een nette witte chip met
 * dunne rand (zodat ook transparante logo's leesbaar blijven op lichte én
 * donkere achtergronden), of een nette initialen-fallback op de klantkleur.
 * Nooit een willekeurige afbeelding. Rechthoekig-afgerond, want logo's zijn
 * zelden rond.
 */
export function ClientLogo({
  name,
  logoUrl,
  color,
  size = 28,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  size?: number;
}) {
  const radius = Math.max(6, Math.round(size * 0.28));
  if (logoUrl) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden border border-[var(--color-line)] bg-white"
        style={{ width: size, height: size, borderRadius: radius }}
        title={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name}
          width={size}
          height={size}
          className="size-full object-contain p-[12%]"
          loading="lazy"
        />
      </span>
    );
  }
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color ?? "var(--color-indigo-soft)",
        fontSize: Math.round(size * 0.36),
      }}
      title={name}
    >
      {letters}
    </span>
  );
}

/* --------------------------- Teamavatar ---------------------------- */

/**
 * Teamlid-avatar met de juiste foto: opgeslagen `avatarUrl` → bekende
 * portretfoto in public/team/ → initialen op de persoonskleur. Eén plek i.p.v.
 * losse foto-mappings per pagina.
 */
export function TeamAvatar({
  name,
  avatarUrl,
  color,
  size = 28,
}: {
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  size?: number;
}) {
  return <Avatar name={name} color={color} size={size} src={teamPhotoSrc(name, avatarUrl)} />;
}

/* --------------------------- Paginakop ----------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------ Tabel ------------------------------ */

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse">
        <thead className="border-b border-[var(--color-line)]">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">{children}</tbody>
      </table>
    </div>
  );
}

/* --------------------------- Foutmelding --------------------------- */

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[#a3271c]"
    >
      {children}
    </p>
  );
}

export function InfoNote({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-sm)] px-3 py-2 text-sm",
        TONES[tone],
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------- Kwaliteitsrichtlijn -------------------------- */

const GUIDELINE_ACCENT: Record<Tone, string> = {
  neutral: "var(--color-line-strong)",
  info: "var(--color-info)",
  good: "var(--color-good)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  lime: "var(--color-lime)",
  violet: "var(--color-violet)",
  ink: "var(--color-indigo-ink)",
};

/**
 * Compact, uitklapbaar richtlijnblok in de huisstijl. Bedoeld om kort naast de
 * taak zelf te tonen (scripts, contentplanning, dashboard) — standaard dicht,
 * met één klik open. Werkt zonder JS (native <details>) en leest goed op mobiel.
 *
 * `icon` is optioneel (bijv. een lucide-icoon). `items` rendert als korte
 * checklist; vrije inhoud kan ook via `children`.
 */
export function GuidelineNote({
  title,
  icon,
  tone = "info",
  defaultOpen = false,
  items,
  footer,
  children,
}: {
  title: string;
  icon?: ReactNode;
  tone?: Tone;
  defaultOpen?: boolean;
  items?: ReactNode[];
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group sc-card overflow-hidden"
      style={{ boxShadow: `inset 3px 0 0 ${GUIDELINE_ACCENT[tone]}` }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">
        {icon ? <span className="shrink-0 text-[var(--color-ink-muted)]">{icon}</span> : null}
        <span className="min-w-0 flex-1">{title}</span>
        <svg
          className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-[var(--color-line)] px-3.5 py-3 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {items && items.length > 0 ? (
          <ul className="space-y-1.5">
            {items.map((it, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[2px] shrink-0 text-[var(--color-ink-faint)]" style={{ color: GUIDELINE_ACCENT[tone] }} aria-hidden>✓</span>
                <span className="min-w-0">{it}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {children}
        {footer ? <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">{footer}</p> : null}
      </div>
    </details>
  );
}
