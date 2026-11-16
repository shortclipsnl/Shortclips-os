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

/* ------------------------------------------------------------------ *
 * Afspraken uit de offerte (voor "Omzetten naar klant")
 * ------------------------------------------------------------------ */

export type DealTerms = {
  focus: "organisch" | "advertentie" | null;
  shortsPerMonth: number | null;
  contractMonths: number | null;
  monthlyExclVat: number | null;
  /** "tekst" = letterlijk in de offerte gevonden; "berekend" = totaal ÷ looptijd. */
  monthlySource: "tekst" | "berekend" | null;
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/**
 * Leest pakket, aantal video's, looptijd en maandbedrag uit de offertetekst.
 * Alleen als het eenduidig is: bij twee verschillende waarden blijft het veld
 * leeg (dan vult een medewerker het in het controlevenster in).
 */
export function extractDealTerms(text: string | null | undefined, title: string, totalExclVat: number | null): DealTerms {
  const t = (text ?? "").replace(/\s+/g, " ");
  const service = serviceTypeFrom(title, text);
  const focus = service === "Advertentiecreatives" ? "advertentie" : service === "Organische short video" ? "organisch" : null;

  const shorts = uniq(
    [...t.matchAll(/(\d{1,2})\s*(?:short[\s-]?(?:video'?s|form video'?s)|shorts|video'?s|creatives)\s*(?:per|p\/|\/)\s*maand/gi)].map((m) => Number(m[1])),
  ).filter((n) => n > 0 && n <= 40);

  const months = uniq(
    [...t.matchAll(/(?:looptijd|contractduur|periode|minimaal|samenwerking van|voor)\D{0,30}?(\d{1,2})\s*maanden/gi)].map((m) => Number(m[1])),
  ).filter((n) => [3, 6, 9, 12, 24].includes(n));

  const monthlyRe = /€\s*([\d.,]+\d)\s*(?:,-)?\s*(?:excl\.?\s*btw\s*)?(?:per maand|p\/m|\/\s*maand|per mnd)/gi;
  const monthly = uniq([...t.matchAll(monthlyRe)].map((m) => parseEuro(m[1]!)).filter((n): n is number => n != null && n >= 250));

  let monthlyExclVat: number | null = null;
  let monthlySource: DealTerms["monthlySource"] = null;
  if (monthly.length === 1) {
    monthlyExclVat = monthly[0]!;
    monthlySource = "tekst";
  } else if (monthly.length === 0 && totalExclVat && months.length === 1) {
    const per = totalExclVat / months[0]!;
    // Alleen als het een rond bedrag is (anders klopt de aanname niet).
    if (Math.abs(per - Math.round(per)) < 0.005) { monthlyExclVat = Math.round(per); monthlySource = "berekend"; }
  }

  return {
    focus,
    shortsPerMonth: shorts.length === 1 ? shorts[0]! : null,
    contractMonths: months.length === 1 ? months[0]! : null,
    monthlyExclVat,
    monthlySource,
  };
}

/** Pakketkeuze in het omzetvenster, alleen bij een exacte match. */
export function pakketFromTerms(terms: Pick<DealTerms, "focus" | "shortsPerMonth"> | null | undefined): "org6" | "org8" | "ads6" | "ads8" | null {
  if (!terms?.focus || !terms.shortsPerMonth) return null;
  if (terms.shortsPerMonth !== 6 && terms.shortsPerMonth !== 8) return null;
  return `${terms.focus === "organisch" ? "org" : "ads"}${terms.shortsPerMonth}` as "org6" | "org8" | "ads6" | "ads8";
}

/* ------------------------------------------------------------------ *
 * Commerciële opvolging
 * ------------------------------------------------------------------ */

export type AttentionInput = {
  id: string;
  status: string;
  sentAt: Date | string | null;
  firstOpenedAt: Date | string | null;
  lastOpenedAt: Date | string | null;
  expiresOn: Date | string | null;
};
export type AttentionKind = "recent_bekeken" | "verloopt" | "niet_geopend" | "lang_open";
export type AttentionSignal = { id: string; kind: AttentionKind; label: string; days: number; rank: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

/**
 * Eén signaal per openstaande offerte (het belangrijkste), gesorteerd op
 * urgentie. Concept, ondertekend, afgewezen en verlopen tellen nooit mee.
 */
export function attentionSignals(rows: AttentionInput[], now = Date.now()): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  for (const r of rows) {
    if (r.status !== "verzonden" && r.status !== "bekeken") continue;
    const sent = ms(r.sentAt);
    const opened = ms(r.lastOpenedAt);
    const expires = ms(r.expiresOn);
    const daysOpen = sent ? Math.floor((now - sent) / DAY_MS) : 0;

    if (expires && expires > now && expires - now <= 7 * DAY_MS) {
      const d = Math.max(0, Math.ceil((expires - now) / DAY_MS));
      out.push({ id: r.id, kind: "verloopt", label: d <= 1 ? "Verloopt morgen" : `Verloopt over ${d} dagen`, days: d, rank: 0 });
    } else if (r.status === "bekeken" && opened && now - opened <= 7 * DAY_MS) {
      const d = Math.floor((now - opened) / DAY_MS);
      out.push({ id: r.id, kind: "recent_bekeken", label: d === 0 ? "Vandaag bekeken, nog niet getekend" : `${d} ${d === 1 ? "dag" : "dagen"} geleden bekeken, nog niet getekend`, days: d, rank: 1 });
    } else if (r.status === "verzonden" && sent && now - sent > 3 * DAY_MS) {
      out.push({ id: r.id, kind: "niet_geopend", label: `${daysOpen} dagen verzonden, nog niet geopend`, days: daysOpen, rank: 2 });
    } else if (sent && now - sent > 14 * DAY_MS) {
      out.push({ id: r.id, kind: "lang_open", label: `Staat al ${daysOpen} dagen open`, days: daysOpen, rank: 3 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || (a.kind === "verloopt" ? a.days - b.days : a.kind === "recent_bekeken" ? a.days - b.days : b.days - a.days));
}

/** Maandvergelijking: ondertekend en verzonden in deze vs. vorige kalendermaand (Amsterdamse tijd). */
export function monthComparison(
  rows: { status: string; sentAt: Date | string | null; signedAt: Date | string | null }[],
  now = new Date(),
): { signedThis: number; signedPrev: number; sentThis: number; sentPrev: number } {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Europe/Amsterdam" }).format(d);
  const thisKey = key(now);
  const prevDate = new Date(now);
  prevDate.setUTCDate(1);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevKey = key(new Date(Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth(), 15)));
  let signedThis = 0, signedPrev = 0, sentThis = 0, sentPrev = 0;
  for (const r of rows) {
    if (r.signedAt && (r.status === "ondertekend" || r.status === "geaccepteerd")) {
      const k = key(new Date(r.signedAt));
      if (k === thisKey) signedThis++; else if (k === prevKey) signedPrev++;
    }
    if (r.sentAt) {
      const k = key(new Date(r.sentAt));
      if (k === thisKey) sentThis++; else if (k === prevKey) sentPrev++;
    }
  }
  return { signedThis, signedPrev, sentThis, sentPrev };
}

/** Genoeg zekere gegevens om automatisch een lead aan te maken. */
export function canCreateLeadFrom(q: { recipientCompany: string | null; recipientEmail: string | null }): boolean {
  return normalizeCompany(q.recipientCompany).length >= 3 && !!q.recipientEmail && !isInternalEmail(q.recipientEmail);
}
