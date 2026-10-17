/**
 * Klantlogo's betrouwbaar ophalen uit het officiële domein van een klant.
 * Correct-by-construction: het juiste domein levert het juiste logo. We halen
 * het sitepictogram (favicon, hoge resolutie) op en slaan het op als data-URL,
 * consistent met de bestaande LogoPicker. Lukt het niet, dan null → de UI toont
 * de nette initialen-chip (geen willekeurige afbeelding).
 */

/** Maakt van een website/URL een kaal domein (zonder protocol, www of pad). */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const clean = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) ? clean : null;
}

/** Haalt een logo (favicon, 128px) op voor een domein en geeft een data-URL terug. */
export async function fetchLogoDataUrl(domain: string): Promise<string | null> {
  const clean = normalizeDomain(domain);
  if (!clean) return null;
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/png";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Google geeft een klein standaard-globe-icoon terug als er geen echt icoon
    // is; dat is doorgaans heel klein. Onder ~200 bytes beschouwen we als leeg.
    if (buf.length < 200) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
