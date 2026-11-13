/**
 * WhatsApp-bericht bij de eerste versies van de video's (Editing → per opname).
 *
 * Twee varianten, afhankelijk van hoe de klant de video's ontvangt:
 * - "videolink": video's via een externe videolink, contentplanning als PDF in WhatsApp.
 * - "portaal":   video's en contentplanning in het eigen Shortclips klantportaal.
 *
 * De standaardteksten staan in WhatsApp-notatie: *vet* en _cursief_. Zo komt de
 * opmaak na het plakken in WhatsApp precies goed door. Opsommingstekens zijn "•".
 *
 * Een medewerker past het bericht per opname aan; dat concept wordt bij de
 * opname bewaard en verandert de standaardtekst voor anderen nooit.
 */

export type WhatsappOptie = "videolink" | "portaal";
export const WHATSAPP_OPTIES: WhatsappOptie[] = ["videolink", "portaal"];

export const LINK_PLACEHOLDER = "[Voeg videolink toe]";
export const WHATSAPP_BERICHT_MAX_LENGTH = 4000;
export const VIDEO_LINK_MAX_LENGTH = 1000;

export const WHATSAPP_SETTING_KEYS: Record<WhatsappOptie, string> = {
  videolink: "editing.whatsapp.videolink",
  portaal: "editing.whatsapp.portaal",
};

export const WHATSAPP_OPTIE_META: Record<WhatsappOptie, { label: string; kort: string; knop: string; uitleg: string; naKopieren: string }> = {
  videolink: {
    label: "Videolink + contentplanning PDF",
    kort: "Videolink + PDF",
    knop: "Link + PDF",
    uitleg: "De klant ontvangt de video's via een externe videolink en de contentplanning als PDF via WhatsApp.",
    naKopieren: "Plak het bericht in WhatsApp en voeg de contentplanning als PDF toe voordat je het verstuurt.",
  },
  portaal: {
    label: "Shortclips portaal",
    kort: "Shortclips portaal",
    knop: "Portaal",
    uitleg: "De klant beoordeelt de video's in het eigen Shortclips portaal en bekijkt de contentplanning op de pagina Contentplanning.",
    naKopieren: "Plak het bericht in WhatsApp en verstuur het naar de klant.",
  },
};

export const DEFAULT_WHATSAPP_BERICHT: Record<WhatsappOptie, string> = {
  videolink: [
    "Goedemorgen! 👋",
    "",
    "De eerste versies van de video's staan klaar! 🎬",
    "",
    "🎥 *Bekijk de video's hier:*",
    LINK_PLACEHOLDER,
    "",
    "📅 *Contentplanning*",
    "In de bijgevoegde PDF vind je de contentplanning. Hierin zie je precies wanneer welke video gepubliceerd wordt.",
    "",
    "✅ *Goed om te weten:*",
    "",
    "• *5 minuten:* zo lang duurt het beoordelen gemiddeld.",
    "",
    "• *Correcties:* de video's zijn intern gecontroleerd. Eventuele feitelijke onjuistheden kun je als opmerkingen bij de video's via de link plaatsen. Eén correctieronde is inbegrepen.",
    "",
    "• *3 werkdagen:* de videolink is 3 werkdagen geldig. Bekijk de video's daarom binnen deze termijn en geef eventuele opmerkingen direct door. Daarna gaan we verder volgens de contentplanning.",
    "",
    "Alvast bedankt! 😊",
  ].join("\n"),
  portaal: [
    "Goedemorgen! 👋",
    "",
    "De eerste versies van de video's staan klaar in jullie eigen Shortclips portaal! 🎬",
    "",
    "🎥 *Video's bekijken*",
    "Ga in het portaal naar de pagina _Video's_. Hier staan alle video's klaar om te beoordelen.",
    "",
    "📅 *Contentplanning*",
    "Op de pagina _Contentplanning_ zie je precies welke video's wanneer gepubliceerd worden.",
    "",
    "✅ *Goed om te weten:*",
    "",
    "• *5 minuten:* zo lang duurt het beoordelen gemiddeld.",
    "",
    "• *Correcties:* de video's zijn intern gecontroleerd. Eventuele feitelijke onjuistheden kun je als opmerkingen direct bij de betreffende video in het portaal plaatsen. Eén correctieronde is inbegrepen.",
    "",
    "• *3 werkdagen:* je hebt 3 werkdagen om de video's te beoordelen en eventuele opmerkingen door te geven. Daarna sluiten we de feedbackronde af en gaan we verder volgens de contentplanning.",
    "",
    "Alvast bedankt! 😊",
  ].join("\n"),
};

/** Checklist per optie. "auto" wordt door het systeem afgevinkt (videolink ingevuld). */
export type ChecklistItem = { key: string; label: string; auto?: boolean };
export const WHATSAPP_CHECKLIST: Record<WhatsappOptie, ChecklistItem[]> = {
  videolink: [
    { key: "videolink", label: "Videolink toegevoegd", auto: true },
    { key: "pdf", label: "Contentplanning PDF toegevoegd aan dit bericht" },
    { key: "gecontroleerd", label: "Bericht gecontroleerd" },
  ],
  portaal: [
    { key: "portaal", label: "Video's staan klaar in het klantportaal" },
    { key: "contentplanning", label: "Contentplanning is gecontroleerd en gedeeld met de klant" },
    { key: "gecontroleerd", label: "Bericht gecontroleerd" },
  ],
};

/** Concept per opname, opgeslagen in deliverables.whatsapp_bericht. */
export type WhatsappBerichtConcept = {
  optie: WhatsappOptie | null;
  videoLink: string;
  /** Aangepaste tekst per optie; ontbreekt = standaardtekst. */
  teksten: Partial<Record<WhatsappOptie, string>>;
  /** Handmatig afgevinkte checklistpunten per optie. */
  checks: Partial<Record<WhatsappOptie, string[]>>;
  /** Laatste keer gekopieerd per optie (ISO), voor het team zichtbaar op de rij. */
  gekopieerd: Partial<Record<WhatsappOptie, string>>;
};

export function emptyConcept(): WhatsappBerichtConcept {
  return { optie: null, videoLink: "", teksten: {}, checks: {}, gekopieerd: {} };
}

/** Regeleinden normaliseren en spaties aan het einde van regels weghalen; witregels blijven. */
export function normalizeBericht(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim();
}

/** Videolink opschonen: spaties weg en https:// ervoor als het protocol ontbreekt. */
export function normalizeVideoLink(raw: string): string {
  const v = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Ziet de link eruit als een echte webadres? (http(s):// + domein met punt) */
export function isValidVideoLink(link: string): boolean {
  try {
    const u = new URL(link);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Nieuwe videolink in de tekst verwerken: vervangt de vorige link (als die er
 * nog in staat) of anders de tijdelijke tekst [Voeg videolink toe]. Een lege
 * nieuwe link zet de tijdelijke tekst terug.
 */
export function applyVideoLink(text: string, previousLink: string, nextLink: string): string {
  const target = nextLink || LINK_PLACEHOLDER;
  if (previousLink && text.includes(previousLink)) return text.split(previousLink).join(target);
  if (text.includes(LINK_PLACEHOLDER)) return text.split(LINK_PLACEHOLDER).join(target);
  return text;
}

/** Standaardtekst van een optie, met de videolink al ingevuld waar dat kan. */
export function standaardMetLink(standaard: string, link: string): string {
  return link ? applyVideoLink(standaard, "", link) : standaard;
}

export type KopieerBlokkade = { kan: true } | { kan: false; reden: string };

/** Mag dit bericht gekopieerd worden? Voorkomt kopiëren met de tijdelijke linktekst. */
export function kanKopieren(
  optie: WhatsappOptie,
  tekst: string,
  videoLink: string,
  afgevinkt: string[],
): KopieerBlokkade {
  if (!tekst.trim()) return { kan: false, reden: "Het bericht is leeg." };
  if (tekst.includes(LINK_PLACEHOLDER)) {
    return { kan: false, reden: optie === "videolink" ? "Vul eerst de videolink in." : `Haal ${LINK_PLACEHOLDER} uit het bericht.` };
  }
  if (optie === "videolink") {
    if (!videoLink) return { kan: false, reden: "Vul eerst de videolink in." };
    if (!isValidVideoLink(videoLink)) return { kan: false, reden: "De videolink lijkt niet te kloppen. Controleer de link." };
    if (!tekst.includes(videoLink)) return { kan: false, reden: "De videolink staat niet meer in het bericht. Herstel de standaardtekst of plak de link terug." };
  }
  const open = WHATSAPP_CHECKLIST[optie].filter((c) => !c.auto && !afgevinkt.includes(c.key));
  if (open.length > 0) return { kan: false, reden: "Vink eerst de checklist af." };
  return { kan: true };
}

/** Concept uit de database of van de client veilig inlezen (onbekende velden weg, lengtes begrensd). */
export function sanitizeConcept(input: unknown): WhatsappBerichtConcept {
  const out = emptyConcept();
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;
  if (raw.optie === "videolink" || raw.optie === "portaal") out.optie = raw.optie;
  if (typeof raw.videoLink === "string") out.videoLink = raw.videoLink.trim().slice(0, VIDEO_LINK_MAX_LENGTH);
  for (const o of WHATSAPP_OPTIES) {
    const t = (raw.teksten as Record<string, unknown> | undefined)?.[o];
    if (typeof t === "string") out.teksten[o] = t.replace(/\r\n?/g, "\n").slice(0, WHATSAPP_BERICHT_MAX_LENGTH);
    const c = (raw.checks as Record<string, unknown> | undefined)?.[o];
    if (Array.isArray(c)) {
      const allowed = new Set(WHATSAPP_CHECKLIST[o].filter((i) => !i.auto).map((i) => i.key));
      out.checks[o] = [...new Set(c.filter((k): k is string => typeof k === "string" && allowed.has(k)))];
    }
    const g = (raw.gekopieerd as Record<string, unknown> | undefined)?.[o];
    if (typeof g === "string" && !Number.isNaN(Date.parse(g))) out.gekopieerd[o] = g;
  }
  return out;
}

/** Stukjes tekst voor de WhatsApp-voorbeeldweergave: *vet* en _cursief_ zoals WhatsApp ze toont. */
export type OpmaakDeel = { text: string; bold?: boolean; italic?: boolean };
export function whatsappOpmaak(line: string): OpmaakDeel[] {
  const parts: OpmaakDeel[] = [];
  // WhatsApp: markering direct tegen de tekst aan, niet midden in een woord.
  const re = /(^|[\s(])([*_])(?!\s)([^*_\n]*?[^\s*_])\2(?=$|[\s.,:;!?)])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const start = m.index + m[1].length;
    if (start > last) parts.push({ text: line.slice(last, start) });
    parts.push({ text: m[3], bold: m[2] === "*", italic: m[2] === "_" });
    last = start + m[3].length + 2;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}
