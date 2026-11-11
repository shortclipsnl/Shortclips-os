import { useId } from "react";
import { CATEGORIES, METALS, type AwardDef } from "@/lib/milestones";

const SHAPE = { bereik: "circle", content: "hex", samenwerking: "shield" } as const;

/**
 * De award als SVG-string. Eén generator voor de pagina én de deelbare
 * LinkedIn-afbeelding, zodat ze er altijd hetzelfde uitzien.
 */
export function badgeSvg(a: Pick<AwardDef, "category" | "metal" | "big" | "unit">, uid: string, size?: number): string {
  const id = `b${uid.replace(/[^a-zA-Z0-9]/g, "")}`;
  const m = METALS[a.metal].stops;
  const shape = SHAPE[a.category];
  let outer: string, inner: string, ring: string, deco = "";
  if (shape === "circle") {
    outer = `<circle cx="50" cy="50" r="48"/>`;
    inner = `<circle cx="50" cy="50" r="41"/>`;
    ring = `<circle cx="50" cy="50" r="36.5"/>`;
    for (let i = 0; i < 72; i++) {
      const t = (i * 5 * Math.PI) / 180, r1 = i % 6 === 0 ? 38.6 : 39.4, r2 = 40.4;
      deco += `<line x1="${(50 + r1 * Math.cos(t)).toFixed(2)}" y1="${(50 + r1 * Math.sin(t)).toFixed(2)}" x2="${(50 + r2 * Math.cos(t)).toFixed(2)}" y2="${(50 + r2 * Math.sin(t)).toFixed(2)}"/>`;
    }
    deco = `<g stroke="url(#${id}m)" stroke-width=".55" opacity=".7">${deco}</g>`;
  } else if (shape === "hex") {
    const pts = (r: number) => [0, 1, 2, 3, 4, 5].map((i) => { const t = ((-90 + 60 * i) * Math.PI) / 180; return `${(50 + r * Math.cos(t)).toFixed(2)},${(50 + r * Math.sin(t)).toFixed(2)}`; }).join(" ");
    outer = `<polygon points="${pts(49)}" stroke-linejoin="round"/>`;
    inner = `<polygon points="${pts(42)}"/>`;
    ring = `<polygon points="${pts(37.5)}"/>`;
    deco = `<g fill="url(#${id}m)" opacity=".8">${[0, 1, 2, 3, 4, 5].map((i) => { const t = ((-90 + 60 * i) * Math.PI) / 180; return `<circle cx="${(50 + 39.8 * Math.cos(t)).toFixed(2)}" cy="${(50 + 39.8 * Math.sin(t)).toFixed(2)}" r=".9"/>`; }).join("")}</g>`;
  } else {
    const p = "M50 2 L91 15 V47 C91 72 73 89 50 98 C27 89 9 72 9 47 V15 Z";
    outer = `<path d="${p}"/>`;
    inner = `<path d="${p}" transform="translate(50 51) scale(.85) translate(-50 -50)"/>`;
    ring = `<path d="${p}" transform="translate(50 51) scale(.76) translate(-50 -50)"/>`;
    deco = `<g fill="none" stroke="url(#${id}m)" stroke-width=".7" opacity=".75"><path d="M28 76 q-8 -10 -6 -24"/><path d="M72 76 q8 -10 6 -24"/></g>`;
  }
  const fs = a.big.length >= 4 ? 21 : a.big.length === 3 ? 24 : 29;
  const ty = shape === "shield" ? 58 : 57;
  const sz = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${sz} aria-hidden="true">
<defs>
<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m[0]}"/><stop offset=".38" stop-color="${m[1]}"/><stop offset=".68" stop-color="${m[2]}"/><stop offset="1" stop-color="${m[3]}"/></linearGradient>
<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m[0]}"/><stop offset=".55" stop-color="${m[1]}"/><stop offset="1" stop-color="${m[3]}"/></linearGradient>
<radialGradient id="${id}f" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#14185a"/><stop offset=".6" stop-color="#00003b"/><stop offset="1" stop-color="#000026"/></radialGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}c">${outer}</clipPath>
</defs>
<g fill="url(#${id}m)">${outer}</g>
<g fill="url(#${id}f)">${inner}</g>
<g fill="none" stroke="url(#${id}m)" stroke-width=".8" opacity=".75">${ring}</g>
${deco}
<path d="M50 24.5 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" fill="url(#${id}m)"/>
<text x="50" y="${ty}" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs}" letter-spacing="-.5" fill="url(#${id}t)">${a.big}</text>
<text x="50" y="${ty + 11.5}" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-weight="600" font-size="5.6" letter-spacing="1.6" fill="url(#${id}m)">${a.unit.replace("'", "&#39;")}</text>
<g clip-path="url(#${id}c)"><rect class="ms-sheen" x="0" y="-10" width="26" height="120" fill="url(#${id}s)"/></g>
</svg>`;
}

/** De award als element (unieke gradient-id's per exemplaar). */
export function AwardBadge({ award, className = "" }: { award: Pick<AwardDef, "category" | "metal" | "big" | "unit" | "name">; className?: string }) {
  const uid = useId();
  return (
    <span
      role="img"
      aria-label={`${award.name}, ${CATEGORIES[award.category].label.toLowerCase()}award in ${METALS[award.metal].label.toLowerCase()}`}
      className={`block [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: badgeSvg(award, uid) }}
    />
  );
}
