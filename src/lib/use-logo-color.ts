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
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, pa] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
          if (pa < 200) continue;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // Alleen echte kleur: geen wit, zwart of grijs.
          if (max - min < 40 || max < 40) continue;
          r += pr; g += pg; b += pb; n++;
        }
        let out: string | null = null;
        if (n > 30) {
          // Iets donkerder maken zodat witte tekst erop leesbaar blijft.
          const k = 0.78;
          const hex = (v: number) => Math.round((v / n) * k).toString(16).padStart(2, "0");
          out = `#${hex(r)}${hex(g)}${hex(b)}`;
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
