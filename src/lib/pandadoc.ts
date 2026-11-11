/**
 * Pure hulpfuncties voor de PandaDoc-koppeling (geen netwerk, geen database),
 * zodat ze los te testen zijn. PandaDoc blijft leidend: deze functies vertalen
 * alleen wat PandaDoc teruggeeft, ze verzinnen niets.
 */

export type PortalQuoteStatus = "concept" | "verzonden" | "bekeken" | "ondertekend" | "afgewezen" | "verlopen";

/** "document.viewed", "Viewed", "Waiting for approval" → "viewed", "waiting_approval". */
export function normalizePandaDocStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/^document\./, "").replace(/\s+/g, "_");
  if (s === "waiting_for_approval") return "waiting_approval";
  if (s === "waiting_for_payment") return "waiting_pay";
  return s;
}

/** PandaDoc-status → portaalstatus. Onbekende statussen vallen terug op concept. */
export function mapPandaDocStatus(raw: string | null | undefined): PortalQuoteStatus {
  switch (normalizePandaDocStatus(raw)) {
    case "sent":
      return "verzonden";
    case "viewed":
      return "bekeken";
    case "completed":
    case "paid":
    case "waiting_pay":
      return "ondertekend";
    case "declined":
      return "afgewezen";
    case "voided":
    case "expired":
      return "verlopen";
    default:
      // draft, uploaded, waiting_approval, approved, rejected, external_review, scheduled
      return "concept";
  }
}

/** Handmatige statuswijzigingen die de PandaDoc-API toestaat (PATCH /documents/{id}/status). */
export const PANDADOC_SETTABLE = {
  ondertekend: { code: 2, label: "Markeer als ondertekend" },
  verlopen: { code: 11, label: "Markeer als verlopen" },
  afgewezen: { code: 12, label: "Markeer als afgewezen" },
} as const;
export type SettableStatus = keyof typeof PANDADOC_SETTABLE;

/** Welke handmatige wijzigingen zinvol zijn vanuit de huidige status. */
export function allowedManualStatuses(current: PortalQuoteStatus): SettableStatus[] {
  if (current === "verzonden" || current === "bekeken") return ["ondertekend", "afgewezen", "verlopen"];
  return [];
}

/** Audittrail-acties van PandaDoc (vastgesteld op echte documenten). */
export const AUDIT_ACTION: Record<number, { type: string; label: string }> = {
  1: { type: "created", label: "Offerte aangemaakt" },
  6: { type: "sent", label: "Offerte verzonden" },
  8: { type: "opened", label: "Klant heeft de offerte geopend" },
  9: { type: "signature", label: "Handtekening gezet" },
  7: { type: "signed", label: "Offerte volledig ondertekend" },
};

/** Nederlands of Engels geformatteerd eurobedrag → getal. "10.708,50" → 10708.5. */
export function parseEuro(raw: string): number | null {
  let s = raw.replace(/[€\s ]/g, "").replace(/,-$/, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Alle eurobedragen in een tekst ("€ 8.850", "€ 1.858,50"). */
export function findEuroAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /€\s*([\d.,]+\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseEuro(m[1]!);
    if (n != null && n > 0) out.push(n);
  }
  return out;
}

/**
 * Leest het totaalbedrag uit de offertetekst, maar alleen als het zichzelf
 * bewijst: er moet een bedrag X staan én een bedrag ≈ X × 1,21 (incl. 21% btw).
 * Zo nemen we nooit per ongeluk een maandbedrag of een los getal over. Bij
 * meerdere kandidaten winnen we het grootste (het eindtotaal).
 */
export function extractTotalFromText(text: string): { exclVat: number; inclVat: number } | null {
  const amounts = [...new Set(findEuroAmounts(text))];
  let best: { exclVat: number; inclVat: number } | null = null;
  for (const x of amounts) {
    const incl = amounts.find((y) => Math.abs(y - x * 1.21) <= 0.02);
    if (incl == null) continue;
    if (!best || x > best.exclVat) best = { exclVat: x, inclVat: incl };
  }
  return best;
}

/** Bedrijfsnaam uit de documenttitel: "Offerte - ZOCON - Shortclips.2026" → "ZOCON". */
export function companyFromTitle(title: string): string | null {
  const parts = title.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
  const skip = /^(offerte|shortclips(\.\d{4})?|shortclips\s*-?\s*\d{4}|\d{4}|shortclips advertentie creatives|advertentie creatives|organisch.*|ads.*|\(?\d+\)?)$/i;
  const cand = parts.filter((p) => !skip.test(p) && !/^shortclips/i.test(p) && !/^(\d+ shorts|€)/i.test(p));
  return cand[0] ?? null;
}

/** Type dienstverlening uit titel en tekst. Alleen bij een duidelijk signaal. */
export function serviceTypeFrom(title: string, text?: string | null): string | null {
  const t = `${title} ${text ?? ""}`.toLowerCase();
  const ads = /advertentie|\bads\b|creatives/.test(t);
  const organic = /organisch|short content afdeling|organische/.test(t);
  if (ads && organic) return "Organisch + advertenties";
  if (ads) return "Advertentiecreatives";
  if (organic) return "Organische short video";
  return null;
}

/** Vergelijkbare bedrijfsnaam: kleine letters, zonder rechtsvorm en leestekens. */
export function normalizeCompany(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " en ")
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|holding|groep|group|nederland|nl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Domeinen waarop we niet mogen koppelen (gedeeld door iedereen). */
export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.nl", "live.com", "icloud.com",
  "me.com", "yahoo.com", "yahoo.nl", "kpnmail.nl", "ziggo.nl", "home.nl", "planet.nl", "xs4all.nl", "msn.com", "upcmail.nl",
]);

export function emailDomain(email: string | null | undefined): string | null {
  const m = /@([^@\s>]+)$/.exec((email ?? "").trim().toLowerCase());
  return m ? m[1]! : null;
}

/** Interne afzenders (Shortclips zelf) tellen nooit als klant. */
export function isInternalEmail(email: string | null | undefined): boolean {
  return emailDomain(email) === "shortclips.nl";
}

export const pandadocDocumentUrl = (id: string) => `https://app.pandadoc.com/a/#/documents/${id}`;

/** Conversie = ondertekend / (ondertekend + afgewezen + verlopen). Null zonder afgeronde offertes. */
export function conversionRate(counts: { ondertekend: number; afgewezen: number; verlopen: number }): number | null {
  const done = counts.ondertekend + counts.afgewezen + counts.verlopen;
  return done === 0 ? null : counts.ondertekend / done;
}
