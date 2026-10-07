import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

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

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      ) : null}
    </>
  );

  const accent =
    tone === "bad"
      ? "border-l-[3px] border-l-[var(--color-bad)]"
      : tone === "warn"
        ? "border-l-[3px] border-l-[var(--color-warn)]"
        : tone === "good"
          ? "border-l-[3px] border-l-[var(--color-good)]"
          : "";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "sc-card block p-4 transition-shadow hover:shadow-[var(--shadow-raised)]",
          accent,
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={cn("sc-card p-4", accent)}>{body}</div>;
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
