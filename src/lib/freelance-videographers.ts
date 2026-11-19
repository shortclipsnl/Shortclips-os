/**
 * Freelance videografen: vaste keuzes, normalisatie en filterlogica. Puur
 * (geen server- of browser-API's), zodat dezelfde regels in de UI, de
 * server-acties en de tests gelden. Telefoon, e-mail, links, beschikbaarheid
 * en dubbelen-herkenning komen uit `editor-database`: één bron, geen kopie.
 */
import {
  AVAILABILITY,
  normalizeEmail,
  normalizeLinks,
  normalizeUrl,
  type Availability,
  type EditorLink,
} from "./editor-database";

export { AVAILABILITY, AVAILABILITY_FRESH_DAYS, availabilityState, findDuplicate, formatPhone, labelForUrl, normalizeLinks, whatsappUrl } from "./editor-database";
export type { Availability, EditorLink as VideographerLink, EditorNote as VideographerNote } from "./editor-database";

export const VIDEOGRAPHER_STATUSES = [
  { key: "geselecteerd", label: "Geselecteerd", help: "Door ons geselecteerd en in te schakelen." },
  { key: "beschikbaar", label: "Beschikbaar", help: "Aangesloten en inzetbaar voor opnames." },
  { key: "in_gesprek", label: "In gesprek", help: "We zijn nog in contact, nog niet ingezet." },
  { key: "niet_actief", label: "Niet actief", help: "Schakelen we nu niet in." },
] as const;
export type VideographerStatus = (typeof VIDEOGRAPHER_STATUSES)[number]["key"];
export const STATUS_KEYS = VIDEOGRAPHER_STATUSES.map((s) => s.key) as VideographerStatus[];

/** Werkregio's waar Shortclips vooral videografen zoekt; het team kan eigen labels toevoegen. */
export const REGIONS = ["Friesland", "Groningen", "Drenthe", "Flevoland", "Amsterdam en omgeving", "Noord-Holland", "Zuid-Holland", "Utrecht", "Overijssel", "Gelderland", "Brabant", "Limburg", "Heel Nederland"] as const;

/** Vaste specialisaties; het team kan daarnaast eigen labels toevoegen. */
export const SPECIALISATIONS = [
  "Organische shorts",
  "Advertenties en commercials",
  "Automotive",
  "Vastgoed",
  "Bouw en techniek",
  "Horeca en food",
  "Interviews en podcasts",
  "Evenementen",
  "Drone",
  "TikTok LIVE",
] as const;

/** Velden die een profiel compleet maken (voor "Nog aanvullen"). */
export const PROFILE_FIELDS = [
  { key: "phone", label: "Telefoon" },
  { key: "email", label: "E-mail" },
  { key: "region", label: "Woonplaats of werkregio" },
  { key: "portfolio", label: "Portfolio" },
  { key: "specialisations", label: "Specialisaties" },
  { key: "rate", label: "Dagprijs of uurtarief" },
  { key: "availability", label: "Beschikbaarheid" },
] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]["key"];

export type VideographerProfileInput = {
  fullName: string;
  photo: string | null;
  city: string | null;
  regions: string[];
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  portfolioUrl: string | null;
  links: EditorLink[];
  specialisations: string[];
  status: VideographerStatus;
  availability: Availability;
  availabilityNote: string | null;
  dayRate: number | null;
  hourlyRate: number | null;
  rateNote: string | null;
  collaborationNote: string | null;
};

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const euros = (v: unknown): number | null => {
  // "-3" is geen tarief van € 3: een min-teken betekent ongeldig, niet "haal het teken weg".
  if (typeof v === "string" && /^\s*-/.test(v)) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null;
};

/** Maximale grootte van een opgeslagen profielfoto (data-URL, na verkleinen in de browser). */
export const MAX_PHOTO_CHARS = 220_000;

/** Alleen een verkleinde jpeg/png/webp als data-URL; alles anders wordt genegeerd. */
export function normalizePhoto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(s)) return null;
  return s.length <= MAX_PHOTO_CHARS ? s : null;
}

/** Vrije lijst (specialisaties of regio's) naar unieke, nette labels; vaste keuzes houden hun spelling. */
export function normalizeLabels(v: unknown, presets: readonly string[]): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;/|]/) : [];
  const out: string[] = [];
  for (const item of list) {
    const s = clean(item, 60);
    if (!s) continue;
    const preset = presets.find((p) => p.toLowerCase() === s.toLowerCase());
    const val = preset ?? s.charAt(0).toUpperCase() + s.slice(1);
    if (!out.some((o) => o.toLowerCase() === val.toLowerCase())) out.push(val);
  }
  return out.slice(0, 20);
}

/** Valideert en normaliseert formulierinvoer. Gooit bij een ontbrekende naam. */
export function sanitizeProfile(raw: unknown): VideographerProfileInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fullName = clean(r.fullName, 160);
  if (!fullName) throw new Error("Vul een naam in.");
  return {
    fullName,
    photo: normalizePhoto(r.photo),
    city: clean(r.city, 120),
    regions: normalizeLabels(r.regions, REGIONS),
    phone: clean(r.phone, 40),
    whatsapp: clean(r.whatsapp, 40),
    email: normalizeEmail(r.email),
    portfolioUrl: normalizeUrl(r.portfolioUrl),
    links: normalizeLinks(r.links),
    specialisations: normalizeLabels(r.specialisations, SPECIALISATIONS),
    status: pick(r.status, STATUS_KEYS, "in_gesprek"),
    availability: pick(r.availability, AVAILABILITY.map((a) => a.key), "onbekend"),
    availabilityNote: clean(r.availabilityNote, 300),
    dayRate: euros(r.dayRate),
    hourlyRate: euros(r.hourlyRate),
    rateNote: clean(r.rateNote, 200),
    collaborationNote: clean(r.collaborationNote, 2000),
  };
}

export function missingFields(p: {
  phone: string | null; whatsapp: string | null; email: string | null; city: string | null; regions: string[];
  portfolioUrl: string | null; links: EditorLink[]; specialisations: string[];
  dayRate: number | null; hourlyRate: number | null; availability: string;
}): ProfileFieldKey[] {
  const out: ProfileFieldKey[] = [];
  if (!p.phone && !p.whatsapp) out.push("phone");
  if (!p.email) out.push("email");
  if (!p.city && p.regions.length === 0) out.push("region");
  if (!p.portfolioUrl && p.links.length === 0) out.push("portfolio");
  if (p.specialisations.length === 0) out.push("specialisations");
  if (p.dayRate == null && p.hourlyRate == null) out.push("rate");
  if (p.availability === "onbekend") out.push("availability");
  return out;
}

/** Initialen voor de avatar als er geen foto is. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Zoeken en filteren (gedeeld door UI en tests)
 * ------------------------------------------------------------------ */

export type FilterableVideographer = {
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  regions: string[];
  specialisations: string[];
  status: string;
  availability: string;
  availabilityStatus: "bevestigd" | "verouderd" | "onbekend";
};

export type VideographerFilters = {
  q: string;
  status: string; // "alle" | status
  region: string;
  spec: string;
  av: string; // "" | "beschikbaar" | "inzetbaar" | "niet_bevestigd"
};
export const EMPTY_FILTERS: VideographerFilters = { q: "", status: "alle", region: "", spec: "", av: "" };

/** Zoekt op naam, woonplaats/regio, specialisatie, e-mail en telefoon. */
export function matchesFilters(p: FilterableVideographer, f: VideographerFilters): boolean {
  if (f.status !== "alle" && p.status !== f.status) return false;
  const q = f.q.trim().toLowerCase();
  if (q && ![p.fullName, p.email, p.phone, p.city, ...p.regions, ...p.specialisations].some((v) => v?.toLowerCase().includes(q))) return false;
  if (f.region) {
    const r = f.region.toLowerCase();
    if (!p.regions.some((x) => x.toLowerCase() === r) && p.city?.toLowerCase() !== r) return false;
  }
  if (f.spec && !p.specialisations.includes(f.spec)) return false;
  if (f.av === "beschikbaar" && !(p.availabilityStatus === "bevestigd" && p.availability === "beschikbaar")) return false;
  if (f.av === "inzetbaar" && !(p.availabilityStatus === "bevestigd" && (p.availability === "beschikbaar" || p.availability === "beperkt"))) return false;
  if (f.av === "niet_bevestigd" && p.availabilityStatus === "bevestigd") return false;
  return true;
}

/** Volgorde in het overzicht: geselecteerd, beschikbaar, in gesprek, niet actief; daarbinnen op naam. */
export function sortProfiles<T extends { status: string; fullName: string }>(list: T[]): T[] {
  const rank = (s: string) => STATUS_KEYS.indexOf(s as VideographerStatus);
  return [...list].sort((a, b) => rank(a.status) - rank(b.status) || a.fullName.localeCompare(b.fullName, "nl"));
}
