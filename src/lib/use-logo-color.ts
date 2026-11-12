"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

/**
 * Leidt de merkkleur van een klant af uit zijn logo (gemiddelde van de
 * verzadigde pixels). Geen handwerk: zodra een klant een logo heeft, krijgt zijn
 * blok in Content Research vanzelf zijn eigen kleur. Lukt het niet (geen logo,
 * extern logo zonder CORS, vrijwel zwart/wit logo), dan valt het terug op de
 * vastgelegde klantkleur of het Shortclips-navy.
 */
export function useLogoColor(logoUrl: string | null | undefined, fallback: string | null | undefined): string {
  const base = fallback || "#00003b";
  const [color, setColor] = useState<string>(() => (logoUrl && cache.get(logoUrl)) || base);

  useEffect(() => {
    // Al bekend: de beginwaarde van de state kwam al uit de cache.
    if (!logoUrl || cache.has(logoUrl)) return;
    let cancelled = false;
    const img = new Image();
    if (!logoUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        // Meest voorkomende kleur (in grove emmers), niet het gemiddelde: een
        // gemiddelde van bijv. navy + rood wordt een kleur die het merk niet heeft.
        const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, pa] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
          if (pa < 200) continue;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // Alleen echte kleur: geen wit, zwart of grijs.
          if (max - min < 40 || max < 40) continue;
          const key = `${pr >> 5}-${pg >> 5}-${pb >> 5}`;
          const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
          bk.r += pr; bk.g += pg; bk.b += pb; bk.n++;
          buckets.set(key, bk);
        }
        let best: { r: number; g: number; b: number; n: number } | null = null;
        for (const bk of buckets.values()) if (!best || bk.n > best.n) best = bk;
        let out: string | null = null;
        if (best && best.n > 30) {
          // Licht donkerder als de kleur te licht is voor witte tekst.
          const lum = (0.299 * best.r + 0.587 * best.g + 0.114 * best.b) / best.n;
          const k = lum > 95 ? 95 / lum : 1;
          const hex = (v: number) => Math.round((v / best!.n) * k).toString(16).padStart(2, "0");
          out = `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
        }
        cache.set(logoUrl, out);
        if (!cancelled && out) setColor(out);
      } catch {
        cache.set(logoUrl, null);
      }
    };
    img.onerror = () => cache.set(logoUrl, null);
    img.src = logoUrl;
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  return color;
}
