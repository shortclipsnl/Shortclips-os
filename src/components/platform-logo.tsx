/**
 * Herkenbare platform-logo's (Instagram, TikTok, Facebook, YouTube, LinkedIn)
 * als compacte, gekleurde glyphs. Eenvoudig gehouden, in de merkkleur, zodat
 * ze in filters en bij video's direct herkenbaar zijn.
 */
export function PlatformLogo({ platform, size = 22 }: { platform: string; size?: number }) {
  const p = platform.toLowerCase();
  const r = Math.round(size * 0.28);
  const box = (bg: string, children: React.ReactNode) => (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: r, background: bg }}
      title={PLATFORM_LABEL[p] ?? platform}
      aria-label={PLATFORM_LABEL[p] ?? platform}
    >
      {children}
    </span>
  );
  const s = Math.round(size * 0.62);

  if (p === "instagram") {
    return box("linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)", (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2}>
        <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.3" cy="6.7" r="1.1" fill="#fff" stroke="none" />
      </svg>
    ));
  }
  if (p === "tiktok") {
    return box("#010101", (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff"><path d="M16.5 3c.3 2 1.6 3.6 3.5 3.9v2.6c-1.3 0-2.6-.4-3.7-1.1v5.9c0 3-2.4 5.4-5.4 5.4S5.5 17.3 5.5 14.3c0-2.8 2.1-5.1 4.9-5.4v2.7c-1.3.2-2.2 1.3-2.2 2.7 0 1.5 1.2 2.7 2.7 2.7s2.7-1.2 2.7-2.7V3h2.9Z" /></svg>
    ));
  }
  if (p === "facebook") {
    return box("#1877F2", (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff"><path d="M13.5 21v-7h2.3l.4-2.8h-2.7V9.4c0-.8.3-1.4 1.5-1.4h1.3V5.5c-.6-.1-1.4-.2-2.2-.2-2.2 0-3.6 1.3-3.6 3.7v2.2H8v2.8h2.2V21h3.3Z" /></svg>
    ));
  }
  if (p === "youtube") {
    return box("#FF0000", (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff"><path d="M10 9l5 3-5 3V9Z" /></svg>
    ));
  }
  if (p === "linkedin") {
    return box("#0A66C2", (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff"><path d="M7 9v8H4.3V9H7ZM5.6 4.5A1.6 1.6 0 1 1 4 6.1a1.6 1.6 0 0 1 1.6-1.6ZM20 17h-2.7v-4.2c0-1.1-.4-1.8-1.4-1.8-.8 0-1.2.5-1.4 1-.1.2-.1.5-.1.8V17H11.7V9h2.6v1.1c.4-.5 1-1.3 2.6-1.3 1.9 0 3.1 1.2 3.1 3.9V17Z" /></svg>
    ));
  }
  // Onbekend platform → neutrale cirkel met eerste letter.
  return box("var(--color-ink-muted)", <span style={{ color: "#fff", fontSize: size * 0.5, fontWeight: 700 }}>{(platform[0] ?? "?").toUpperCase()}</span>);
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn",
};
