/**
 * Scriptbericht: het vaste WhatsAppbericht dat een medewerker naar de klant
 * stuurt zodra de scripts klaarstaan. Twee varianten (Adobe Acrobat en
 * Shortclips Portaal). Pure functies, zodat client en server dezelfde regels
 * gebruiken en alles los te testen is.
 *
 * Opmaak is WhatsAppopmaak: *vet* blijft na kopiëren vet in WhatsApp.
 */

export type ScriptberichtMethode = "adobe" | "portal";

export const METHODES: readonly ScriptberichtMethode[] = ["adobe", "portal"] as const;

export const METHODE_LABEL: Record<ScriptberichtMethode, string> = {
  adobe: "Adobe Acrobat bericht",
  portal: "Shortclips Portaal bericht",
};

export const LINK_LABEL: Record<ScriptberichtMethode, string> = {
  adobe: "Adobe Acrobat link",
  portal: "Link naar het klantportaal",
};

/** Plek in het template waar de link komt. */
export const LINK_TOKEN = "{{link}}";

/** Zichtbare plaatshouder zolang er nog geen link is ingevuld. */
export const PLACEHOLDER: Record<ScriptberichtMethode, string> = {
  adobe: "[LINK NAAR SCRIPTS]",
  portal: "[LINK NAAR SHORTCLIPS PORTAAL]",
};

export type Templates = Record<ScriptberichtMethode, string>;

/** Shortclips-standaard. Wordt gebruikt zolang er centraal niets is opgeslagen. */
export const DEFAULT_TEMPLATES: Templates = {
  adobe: [
    "Hierbij de scripts voor de aankomende opnamedag! 🎬",
    "",
    "📄 *Scripts bekijken:*",
    LINK_TOKEN,
    "",
    "Alle feedback uit de scriptbespreking is hierin verwerkt.",
    "",
    "*Belangrijk om te weten:*",
    "",
    "✅ *Opmerkingen of aanpassingen?* Plaats deze rechtstreeks als opmerking bij de betreffende pagina in het document. Graag niet via WhatsApp, zodat alle feedback overzichtelijk op één plek staat.",
    "",
    "✅ *Voorbereiding opnamedag:* Op de laatste pagina's vinden jullie de benodigde voorbereidingen en materialen. Willen jullie ervoor zorgen dat alles op de opnamedag klaarstaat?",
    "",
    "✅ *Feitelijke onjuistheden?* Controleer de scripts nog even op bijvoorbeeld namen, prijzen en vaktermen. Eventuele correcties kunnen jullie ook rechtstreeks in het document plaatsen.",
    "",
    "Dan zorgen we samen voor een goed voorbereide en soepele opnamedag! 🎥",
  ].join("\n"),
  portal: [
    "De scripts voor de aankomende opnamedag staan klaar in het Shortclips Portaal! 🎬",
    "",
    "📄 *Scripts bekijken:*",
    LINK_TOKEN,
    "",
    "Alle feedback uit de scriptbespreking is hierin verwerkt.",
    "",
    "*Belangrijk om te weten:*",
    "",
    "✅ *Opmerkingen of aanpassingen?* Open het betreffende script in het portaal en plaats je opmerking direct bij dat script. Graag niet via WhatsApp, zodat alle feedback overzichtelijk op één plek staat.",
    "",
    "✅ *Voorbereiding opnamedag:* Bij de scripts vinden jullie ook de benodigde voorbereidingen en materialen. Willen jullie ervoor zorgen dat alles op de opnamedag klaarstaat?",
    "",
    "✅ *Feitelijke onjuistheden?* Controleer de scripts nog even op bijvoorbeeld namen, prijzen en vaktermen. Eventuele correcties kunnen jullie direct bij het betreffende script in het portaal plaatsen.",
    "",
    "Dan zorgen we samen voor een goed voorbereide en soepele opnamedag! 🎥",
  ].join("\n"),
};

/** Wat er in het bericht op de plek van de link staat (link of plaatshouder). */
export function insertedValue(methode: ScriptberichtMethode, link: string): string {
  return link.trim() || PLACEHOLDER[methode];
}

/** Template invullen met de link (of de plaatshouder als er nog geen link is). */
export function renderTemplate(template: string, methode: ScriptberichtMethode, link: string): string {
  return template.split(LINK_TOKEN).join(insertedValue(methode, link));
}

/**
 * Link in een (mogelijk handmatig aangepast) bericht vervangen. Vervangt de
 * eerder ingevoegde waarde; staat die er niet meer in, dan blijft de tekst
 * ongewijzigd en meldt `replaced: false`.
 */
export function swapLink(text: string, previous: string, next: string): { text: string; replaced: boolean } {
  if (!previous) return { text, replaced: false };
  const idx = text.indexOf(previous);
  if (idx === -1) return { text, replaced: false };
  return { text: text.slice(0, idx) + next + text.slice(idx + previous.length), replaced: true };
}

/** Review-ID uit een portaallink (…/portal/scripts/<id>), of null. */
export function reviewIdFromLink(link: string): string | null {
  const m = link.match(/\/portal\/scripts\/([0-9a-f-]{8,})/i);
  return m ? m[1]!.toLowerCase() : null;
}

export function isValidUrl(link: string): boolean {
  try {
    const u = new URL(link.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Herkenbare Adobe-domeinen; een andere link is toegestaan, maar krijgt een hint. */
export function looksLikeAdobe(link: string): boolean {
  try {
    const host = new URL(link.trim()).hostname.toLowerCase();
    return /(^|\.)adobe\.(com|ly)$/.test(host) || /(^|\.)acrobat\.com$/.test(host);
  } catch {
    return false;
  }
}

/** Een link die al bij een opname van een andere klant hoort. */
export type ForeignLink = { link: string; reviewId: string | null; clientId: string; clientName: string };

export type CheckInput = {
  methode: ScriptberichtMethode;
  link: string;
  text: string;
  clientId: string;
  /** Review van déze opname in het klantportaal (als die er is). */
  ownReviewId: string | null;
  /** Links/reviews die bij opnames van andere klanten horen. */
  foreign: ForeignLink[];
};

export type CheckResult = { ok: true; hint?: string } | { ok: false; reason: string };

function normaliseLink(link: string): string {
  return link.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Mag dit bericht gekopieerd worden? Blokkeert bij een ontbrekende of
 * ongeldige link, een link van een andere klant, of een bericht waarin de link
 * (nog) niet staat.
 */
export function checkMessage(input: CheckInput): CheckResult {
  const link = input.link.trim();
  if (!link) {
    return {
      ok: false,
      reason: input.methode === "portal"
        ? "De link naar het klantportaal ontbreekt. Stuur de scripts eerst via het portaal, of plak de link hierboven."
        : "De Adobe Acrobat link ontbreekt. Plak de link hierboven voordat je het bericht kopieert.",
    };
  }
  if (!isValidUrl(link)) return { ok: false, reason: "Dit is geen geldige link. Controleer of hij met https:// begint." };

  const norm = normaliseLink(link);
  const reviewId = reviewIdFromLink(link);
  const other = input.foreign.find((f) =>
    f.clientId !== input.clientId &&
    (normaliseLink(f.link) === norm || (reviewId !== null && f.reviewId !== null && f.reviewId.toLowerCase() === reviewId)),
  );
  if (other) return { ok: false, reason: `Deze link hoort bij ${other.clientName}, niet bij deze klant. Controleer de link.` };

  if (input.methode === "portal") {
    if (!/\/portal(\/|$)/.test(new URL(link).pathname)) {
      return { ok: false, reason: "Dit lijkt geen link naar het Shortclips Portaal." };
    }
    if (reviewId && input.ownReviewId && reviewId !== input.ownReviewId.toLowerCase()) {
      return { ok: false, reason: "Deze portaallink hoort niet bij de scripts van deze opname." };
    }
  }

  if (input.text.includes(PLACEHOLDER[input.methode])) {
    return { ok: false, reason: `Het bericht bevat nog de plaatshouder ${PLACEHOLDER[input.methode]}.` };
  }
  if (!input.text.includes(link)) {
    return { ok: false, reason: "De link staat niet meer in het bericht. Zet hem terug of herstel de standaardtekst." };
  }
  if (input.methode === "adobe" && !looksLikeAdobe(link)) {
    return { ok: true, hint: "Let op: dit is geen standaard Adobe-link. Klopt dat?" };
  }
  return { ok: true };
}

/** Een templatetekst moet de linkplek bevatten, anders kan de link nergens in. */
export function validateTemplate(text: string): string | null {
  const t = text.trim();
  if (!t) return "De standaardtekst mag niet leeg zijn.";
  if (!t.includes(LINK_TOKEN)) return `Zet ${LINK_TOKEN} op de plek waar de link moet komen.`;
  if (t.length > 4000) return "De standaardtekst is te lang (maximaal 4000 tekens).";
  return null;
}

/** Opgeslagen stand per opname (persoonlijk bericht + link), los van het template. */
export type SavedScriptbericht = {
  methode: ScriptberichtMethode | null;
  links: Partial<Record<ScriptberichtMethode, string>>;
  /** Alleen gevuld als de medewerker de tekst echt heeft aangepast. */
  texts: Partial<Record<ScriptberichtMethode, string>>;
  updatedByName: string | null;
  updatedAt: string | null;
  copiedAt: string | null;
};

export const EMPTY_SAVED: SavedScriptbericht = { methode: null, links: {}, texts: {}, updatedByName: null, updatedAt: null, copiedAt: null };

export function normaliseSaved(raw: unknown): SavedScriptbericht {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (o: unknown): Partial<Record<ScriptberichtMethode, string>> => {
    const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
    const out: Partial<Record<ScriptberichtMethode, string>> = {};
    for (const m of METHODES) if (typeof src[m] === "string" && (src[m] as string).trim()) out[m] = src[m] as string;
    return out;
  };
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    methode: v.methode === "adobe" || v.methode === "portal" ? v.methode : null,
    links: pick(v.links),
    texts: pick(v.texts),
    updatedByName: str(v.updatedByName),
    updatedAt: str(v.updatedAt),
    copiedAt: str(v.copiedAt),
  };
}

export function normaliseTemplates(raw: unknown): Templates {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TEMPLATES };
  for (const m of METHODES) {
    const t = v[m];
    if (typeof t === "string" && validateTemplate(t) === null) out[m] = t;
  }
  return out;
}
