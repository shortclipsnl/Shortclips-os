import { PLATFORM_ICON_PATHS } from "@/components/platform-icon";
import { PLATFORM } from "@/lib/statuses";

/** Achtergrond per merk: de officiële merkkleur (Instagram met het bekende verloop). */
const BG: Record<string, string> = {
  instagram: "linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)",
  tiktok: "#010101",
  facebook: "#1877F2",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
};

/** Subtiele merktint voor kaarten en randen (alleen ter herkenning, huisstijl blijft leidend). */
export const PLATFORM_TINT: Record<string, string> = {
  instagram: "#d62976",
  tiktok: "#25F4EE",
  facebook: "#1877F2",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
};

export const platformName = (p: string) => (p === "youtube" ? "YouTube Shorts" : PLATFORM[p]?.label ?? p.charAt(0).toUpperCase() + p.slice(1));

/**
 * Het officiële platformlogo als app-tegel: wit merkteken op de merkkleur.
 * Herkenbaarder dan een gekleurde stip, in filters, kaarten en bij video's.
 */
export function PlatformBadge({ platform, size = 22, className = "" }: { platform: string; size?: number; className?: string }) {
  const brand = PLATFORM_ICON_PATHS[platform];
  const name = platformName(platform);
  const inner = Math.round(size * (platform === "youtube" ? 0.66 : 0.58));
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), background: BG[platform] ?? "var(--color-ink-muted)" }}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="#fff" aria-hidden>
          <path d={brand.path} />
        </svg>
      ) : (
        <span style={{ color: "#fff", fontSize: size * 0.5, fontWeight: 700 }}>{(platform[0] ?? "?").toUpperCase()}</span>
      )}
    </span>
  );
}
