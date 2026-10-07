import { cn } from "@/lib/cn";

/** Verhouding van het officiële logo-bestand (564×279). */
const LOGO_RATIO = 564 / 279;

/**
 * Het officiële ShortClips-merkteken (alleen de play-mark), als SVG — handig
 * voor kleine icoonplekken. Het volledige logo met woordmerk: <Logo />.
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

/**
 * Het officiële ShortClips-logo (play-mark + woordmerk). `size` is de hoogte in
 * pixels. Op donkere vlakken het witte woordmerk (`onDark`), op lichte vlakken
 * het navy woordmerk — zelfde logo, overal consistent.
 */
export function Logo({
  size = 32,
  onDark = false,
  className,
}: {
  size?: number;
  onDark?: boolean;
  className?: string;
}) {
  const height = Math.round(size * 1.15);
  const width = Math.round(height * LOGO_RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={onDark ? "/shortclips-logo-ondark.png" : "/shortclips-logo-onlight.png"}
      alt="ShortClips"
      width={width}
      height={height}
      style={{ height, width }}
      className={cn("block shrink-0 select-none", className)}
      draggable={false}
    />
  );
}
