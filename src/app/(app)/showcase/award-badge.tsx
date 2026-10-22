import type { CSSProperties } from "react";
import type { AwardTier } from "@/server/awards/config";

// Zeshoek-punten: SVG (viewBox 100) en de bijbehorende clip-path in procenten.
const HEX_POINTS = "50,1 99,25 99,75 50,99 1,75 1,25";
const HEX_INNER = "50,12 84,30 84,70 50,88 16,70 16,30";
const HEX_CLIP = "polygon(50% 1%, 99% 25%, 99% 75%, 50% 99%, 1% 75%, 1% 25%)";

/** Donkere tekst op een lichte badge, witte tekst op een donkere. */
function textColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a1d24" : "#ffffff";
}

export function AwardBadge({
  tier,
  earned,
  size = 84,
  delayIndex = 0,
  sparkle = false,
}: {
  tier: AwardTier;
  earned: boolean;
  size?: number;
  delayIndex?: number;
  sparkle?: boolean;
}) {
  const fill = earned ? tier.color : "#363b45";
  const txt = earned ? textColor(tier.color) : "#8a92a0";
  const style = {
    width: size,
    height: size,
    "--award-color": tier.color,
    "--shine-delay": `${(delayIndex % 5) * 0.8}s`,
  } as CSSProperties;

  return (
    <span className={earned ? "award-badge-wrap earned" : "award-badge-wrap"} style={style}>
      <span className="award-badge" style={{ clipPath: HEX_CLIP }}>
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
          <polygon points={HEX_POINTS} fill={fill} stroke={earned ? "rgba(255,255,255,0.4)" : "#4b525e"} strokeWidth="2" />
          <polygon points={HEX_INNER} fill="none" stroke={earned ? "rgba(255,255,255,0.5)" : "#5a626f"} strokeWidth="1.25" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize={tier.badge.length > 2 ? 24 : 32} fontWeight={700} fill={txt} style={{ fontFamily: "var(--font-poppins), sans-serif" }}>
            {tier.badge}
          </text>
        </svg>
        {earned ? <span className="award-shine" aria-hidden="true" /> : null}
      </span>
      {earned && sparkle ? <span className="award-sparkle" aria-hidden="true" /> : null}
    </span>
  );
}
