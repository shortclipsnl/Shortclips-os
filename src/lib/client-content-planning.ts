/**
 * Klantweergave van de interne contentplanning (pure helpers, zonder database).
 *
 * De klant ziet exact dezelfde planningsitems als het team (`content_calendar`),
 * alleen vertaald naar klanttaal: een schone titel, drie heldere statussen en
 * geen interne gegevens. Er bestaat geen aparte klantplanning.
 */

export type ClientPostStatus = "published" | "scheduled" | "tentative";

export const CLIENT_POST_STATUS: Record<ClientPostStatus, { label: string; tone: "green" | "blue" | "orange"; hint: string }> = {
  published: { label: "Gepubliceerd", tone: "green", hint: "De video staat online." },
  scheduled: { label: "Ingepland", tone: "blue", hint: "De video is klaar en de publicatiedatum is definitief." },
  tentative: { label: "Voorlopig gepland", tone: "orange", hint: "De publicatiedatum is nog niet definitief." },
};

/** Interne publicatiestatus → klantstatus. Zelfde bron als de interne planning. */
export function clientPostStatus(internal: string | null | undefined): ClientPostStatus {
  if (internal === "published") return "published";
  if (internal === "scheduled" || internal === "ready") return "scheduled";
  return "tentative"; // to_prepare, failed of onbekend
}

/** Mag de caption al getoond worden? Alleen als de video klaar of online is. */
export function captionIsFinal(internal: string | null | undefined): boolean {
  return internal === "published" || internal === "scheduled" || internal === "ready";
}

const PLACEHOLDER = /^(nnb|n\.?n\.?b\.?|tbd|tba|nog niet bekend|onbekend|idee|#?\d+)$/i;

/**
 * Interne agendatitel ("Marco van beek short online > 16:00 - onderhoud")
 * → klanttitel ("Onderhoud"). Lege of nietszeggende titels geven "" terug,
 * zodat de aanroeper kan terugvallen op de caption of een vaste tekst.
 */
export function clientPostTitle(raw: string | null | undefined, clientName?: string | null): string {
  if (!raw) return "";
  let t = String(raw).replace(/<[^>]+>/g, " ").trim();
  // Tijden overal weg ("> 16:00", "om 15.30 uur").
  t = t.replace(/[>|·]?\s*(om\s*)?\d{1,2}[:.]\d{2}\s*(uur)?/gi, " ");
  t = t.replace(/\b(short\s*video'?s?|shorts?|online\s+zetten|online|intern|concept|publiceren|publicatie|post)\b/gi, " ");
  if (clientName) {
    // Klantnaam weg, ook als alleen het begin gebruikt wordt ("Marco van beek").
    const words = clientName.trim().split(/\s+/);
    for (let n = words.length; n >= 1; n--) {
      const esc = words.slice(0, n).join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      if (n === 1 && words[0]!.length < 4) break;
      // Alleen aan het begin: "Onderhoud bij Marco van Beek" blijft heel.
      const re = new RegExp(`^\\s*${esc}(?=$|[^\\p{L}])`, "iu");
      if (re.test(t)) {
        t = t.replace(re, " ");
        break;
      }
    }
  }
  t = t.replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s>|·:–\-#]+|[\s>|·:–\-]+$/g, "").trim();
  if (!t || PLACEHOLDER.test(t)) return "";
  // Volledig in hoofdletters alleen bij zinnen omzetten; "AMG" of "BMW M5" blijven staan.
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t) && t.split(/\s+/).length >= 3) t = t.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Eerste betekenisvolle regel van een caption, zonder hashtags en links. */
export function captionHeadline(caption: string | null | undefined): string {
  if (!caption) return "";
  const line =
    caption
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l.replace(/[#@][\w-]+|https?:\S+|www\.\S+|[^\p{L}\p{N}]/gu, "").length > 3) ?? "";
  const t = line.replace(/https?:\S+|www\.\S+/g, "").replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s{2,}/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87).trimEnd()}…` : t;
}

/* ---------- Datums (ISO YYYY-MM-DD, rekenen in UTC-middag) ---------- */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export function isoWeekNumber(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

export const isIsoDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
export const isIsoMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Alle dagen van de maandkalender (volledige weken, ma t/m zo). */
export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const d = new Date(`${first}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  const last = d.toISOString().slice(0, 10);
  const end = addDays(mondayOf(last), 6);
  const days: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return days;
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Standaard kanalen van Shortclips als er nog niets bekend is. */
export const DEFAULT_PLATFORMS = ["instagram", "tiktok", "facebook", "youtube"] as const;
export const PLATFORM_ORDER = ["instagram", "tiktok", "facebook", "youtube", "linkedin"];
export const sortPlatforms = (ps: Iterable<string>) =>
  [...new Set(ps)].sort((a, b) => (PLATFORM_ORDER.indexOf(a) + 99) % 99 - (PLATFORM_ORDER.indexOf(b) + 99) % 99);
