/**
 * Editor database: vaste keuzes, normalisatie en importlogica. Puur (geen
 * server- of browser-API's), zodat dezelfde regels in de UI, de server-acties
 * en de tests gelden.
 */

export const EDITOR_CATEGORIES = [
  { key: "actief", label: "Actieve editors", short: "Actief", help: "Werken momenteel voor Shortclips." },
  { key: "backup", label: "Back up editors", short: "Back up", help: "Eerder goed werk geleverd, opnieuw in te schakelen bij spoed." },
  { key: "potentieel", label: "Potentiële editors", short: "Potentieel", help: "Contact gehad, nog niet voor ons gewerkt." },
  { key: "niet_geschikt", label: "Niet geschikt", short: "Niet geschikt", help: "Zetten we niet opnieuw in." },
] as const;
export type EditorCategory = (typeof EDITOR_CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = EDITOR_CATEGORIES.map((c) => c.key) as EditorCategory[];

export const AVAILABILITY = [
  { key: "beschikbaar", label: "Beschikbaar" },
  { key: "beperkt", label: "Beperkt beschikbaar" },
  { key: "niet_beschikbaar", label: "Niet beschikbaar" },
  { key: "onbekend", label: "Onbekend" },
] as const;
export type Availability = (typeof AVAILABILITY)[number]["key"];

export const WORKED_WITH_US = [
  { key: "ja", label: "Ja, eerder voor ons gewerkt" },
  { key: "nee", label: "Nee, nog niet" },
  { key: "onbekend", label: "Onbekend" },
] as const;
export type WorkedWithUs = (typeof WORKED_WITH_US)[number]["key"];

/** Vaste specialisaties; het team kan daarnaast eigen labels toevoegen. */
export const SPECIALISATIONS = [
  "Organische shorts",
  "Advertenties",
  "Premium edits",
  "Automotive",
  "Vastgoed",
  "Bouw en techniek",
  "Interviews en podcasts",
  "Motion graphics",
  "Ondertiteling",
] as const;

/** Beschikbaarheid ouder dan dit aantal dagen telt niet meer als bevestigd. */
export const AVAILABILITY_FRESH_DAYS = 14;

/** Velden die een profiel compleet maken (voor "nog ontbrekend"). */
export const PROFILE_FIELDS = [
  { key: "phone", label: "Telefoon" },
  { key: "email", label: "E-mail" },
  { key: "portfolio", label: "Portfolio" },
  { key: "specialisations", label: "Specialisaties" },
  { key: "rate", label: "Tarief" },
  { key: "availability", label: "Beschikbaarheid" },
  { key: "rating", label: "Beoordeling" },
] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]["key"];

export type EditorLink = { label: string; url: string };
export type EditorNote = { id: string; at: string; byId: string | null; byName: string; text: string };

export type EditorProfileInput = {
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  portfolioUrl: string | null;
  links: EditorLink[];
  specialisations: string[];
  category: EditorCategory;
  workedWithUs: WorkedWithUs;
  collaborationNote: string | null;
  ratePerVideo: number | null;
  rateNote: string | null;
  availability: Availability;
  availabilityNote: string | null;
  ratingQuality: number | null;
  ratingCollaboration: number | null;
};

/* ------------------------------------------------------------------ *
 * Normalisatie
 * ------------------------------------------------------------------ */

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** Alleen http(s)-links; "www.x.nl" krijgt https:// ervoor. */
export function normalizeUrl(v: unknown): string | null {
  const s = clean(v, 500);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : null;
  if (!withProto) return null;
  try {
    const u = new URL(withProto);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeEmail(v: unknown): string | null {
  const s = clean(v, 320)?.toLowerCase() ?? null;
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/**
 * Telefoonnummer naar internationale cijfers zonder + (zoals wa.me verwacht).
 * Nederlandse nummers (06…, 0031…, +31 (0)6…) worden 316…. Onherkenbaar → null.
 */
export function phoneDigits(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/\(0\)/g, "");
  const plus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (!plus) {
    if (s.startsWith("00")) s = s.slice(2);
    else if (s.startsWith("0")) s = `31${s.slice(1)}`;
  }
  if (s.startsWith("310")) s = `31${s.slice(3)}`;
  return s.length >= 9 && s.length <= 15 ? s : null;
}

/** Leesbare weergave: +31 6 12345678 voor NL-mobiel, anders +<cijfers>. */
export function formatPhone(v: string | null | undefined): string {
  const d = phoneDigits(v ?? "");
  if (!d) return v ?? "";
  if (d.startsWith("316") && d.length === 11) return `+31 6 ${d.slice(3)}`;
  return `+${d}`;
}

/**
 * WhatsApp-link zonder tekst: opent alleen het gesprek, verstuurt niets.
 * Gebruikt het WhatsApp-nummer, anders het telefoonnummer.
 */
export function whatsappUrl(whatsapp: string | null | undefined, phone: string | null | undefined): string | null {
  const d = phoneDigits(whatsapp ?? "") ?? phoneDigits(phone ?? "");
  return d ? `https://wa.me/${d}` : null;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const rating = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

const euros = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null;
};

export function normalizeSpecialisations(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;/|]/) : [];
  const out: string[] = [];
  for (const item of list) {
    const s = clean(item, 60);
    if (!s) continue;
    const preset = SPECIALISATIONS.find((p) => p.toLowerCase() === s.toLowerCase());
    const val = preset ?? s.charAt(0).toUpperCase() + s.slice(1);
    if (!out.some((o) => o.toLowerCase() === val.toLowerCase())) out.push(val);
  }
  return out.slice(0, 20);
}

export function normalizeLinks(v: unknown): EditorLink[] {
  if (!Array.isArray(v)) return [];
  const out: EditorLink[] = [];
  for (const item of v) {
    const url = normalizeUrl((item as EditorLink)?.url);
    if (!url || out.some((l) => l.url === url)) continue;
    out.push({ url, label: clean((item as EditorLink)?.label, 80) ?? labelForUrl(url) });
  }
  return out.slice(0, 20);
}

/** Herkenbaar label voor een link (Vimeo, YouTube, Instagram, …). */
export function labelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "vimeo.com": "Vimeo", "youtube.com": "YouTube", "youtu.be": "YouTube", "instagram.com": "Instagram",
      "tiktok.com": "TikTok", "behance.net": "Behance", "drive.google.com": "Google Drive", "dropbox.com": "Dropbox",
      "linkedin.com": "LinkedIn", "frame.io": "Frame.io",
    };
    return known[host] ?? host;
  } catch {
    return "Link";
  }
}

/** Valideert en normaliseert formulierinvoer. Gooit bij een ontbrekende naam. */
export function sanitizeProfile(raw: unknown): EditorProfileInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fullName = clean(r.fullName, 160);
  if (!fullName) throw new Error("Vul een naam in.");
  return {
    fullName,
    phone: clean(r.phone, 40),
    whatsapp: clean(r.whatsapp, 40),
    email: normalizeEmail(r.email),
    portfolioUrl: normalizeUrl(r.portfolioUrl),
    links: normalizeLinks(r.links),
    specialisations: normalizeSpecialisations(r.specialisations),
    category: pick(r.category, CATEGORY_KEYS, "potentieel"),
    workedWithUs: pick(r.workedWithUs, WORKED_WITH_US.map((w) => w.key), "onbekend"),
    collaborationNote: clean(r.collaborationNote, 2000),
    ratePerVideo: euros(r.ratePerVideo),
    rateNote: clean(r.rateNote, 200),
    availability: pick(r.availability, AVAILABILITY.map((a) => a.key), "onbekend"),
    availabilityNote: clean(r.availabilityNote, 300),
    ratingQuality: rating(r.ratingQuality),
    ratingCollaboration: rating(r.ratingCollaboration),
  };
}

/* ------------------------------------------------------------------ *
 * Beschikbaarheid en compleetheid
 * ------------------------------------------------------------------ */

export function daysSince(isoDate: string | null | undefined, today = new Date()): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const then = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/**
 * Wat het team mag aannemen over beschikbaarheid. Alleen een recent bevestigde
 * status telt; ooit voor ons gewerkt hebben maakt iemand nooit "beschikbaar".
 */
export function availabilityState(
  availability: string,
  confirmedAt: string | null | undefined,
  today = new Date(),
): { status: "bevestigd" | "verouderd" | "onbekend"; days: number | null; usable: Availability } {
  const days = daysSince(confirmedAt, today);
  if (availability === "onbekend" || days === null) return { status: "onbekend", days, usable: "onbekend" };
  if (days > AVAILABILITY_FRESH_DAYS) return { status: "verouderd", days, usable: "onbekend" };
  return { status: "bevestigd", days, usable: availability as Availability };
}

export function missingFields(p: {
  phone: string | null; whatsapp: string | null; email: string | null; portfolioUrl: string | null; links: EditorLink[];
  specialisations: string[]; ratePerVideo: number | null; knownRate?: number | null; availability: string;
  ratingQuality: number | null; ratingCollaboration: number | null;
}): ProfileFieldKey[] {
  const out: ProfileFieldKey[] = [];
  if (!p.phone && !p.whatsapp) out.push("phone");
  if (!p.email) out.push("email");
  if (!p.portfolioUrl && p.links.length === 0) out.push("portfolio");
  if (p.specialisations.length === 0) out.push("specialisations");
  if (p.ratePerVideo == null && !p.knownRate) out.push("rate");
  if (p.availability === "onbekend") out.push("availability");
  if (p.ratingQuality == null && p.ratingCollaboration == null) out.push("rating");
  return out;
}

/* ------------------------------------------------------------------ *
 * Import (WhatsApp-contactexport als vCard, of CSV/geplakte lijst)
 * ------------------------------------------------------------------ */

export type ImportCandidate = {
  fullName: string;
  phone: string | null;
  email: string | null;
  portfolioUrl: string | null;
  links: EditorLink[];
  specialisations: string[];
  ratePerVideo: number | null;
  note: string | null;
};

function unfoldVcard(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function vcardValue(line: string): string {
  const i = line.indexOf(":");
  const v = i === -1 ? "" : line.slice(i + 1);
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/** vCard (.vcf), zoals WhatsApp Business contacten deelt/exporteert. */
export function parseVcards(text: string): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  let cur: { fn?: string; n?: string; tels: string[]; emails: string[]; urls: string[]; note?: string } | null = null;
  for (const raw of unfoldVcard(text)) {
    const line = raw.trim();
    const key = line.split(/[:;]/)[0]?.toUpperCase().replace(/^ITEM\d+\./, "") ?? "";
    if (key === "BEGIN" && /VCARD/i.test(line)) cur = { tels: [], emails: [], urls: [] };
    else if (!cur) continue;
    else if (key === "END") {
      const name = cur.fn || (cur.n ? cur.n.split(";").filter(Boolean).reverse().join(" ") : "") || "";
      const urls = cur.urls.map(normalizeUrl).filter((u): u is string => !!u);
      out.push({
        fullName: name.trim() || cur.tels[0] || "Onbekende naam",
        phone: cur.tels[0] ?? null,
        email: cur.emails.map(normalizeEmail).find(Boolean) ?? null,
        portfolioUrl: urls[0] ?? null,
        links: urls.slice(1).map((url) => ({ url, label: labelForUrl(url) })),
        specialisations: [],
        ratePerVideo: null,
        note: cur.note ?? null,
      });
      cur = null;
    } else if (key === "FN") cur.fn = vcardValue(line);
    else if (key === "N") cur.n = vcardValue(line);
    else if (key === "TEL") {
      // WhatsApp zet het internationale nummer in waid=…; dat is het betrouwbaarst.
      const waid = /waid=(\d+)/i.exec(line)?.[1];
      cur.tels.push(waid ? `+${waid}` : vcardValue(line));
    } else if (key === "EMAIL") cur.emails.push(vcardValue(line));
    else if (key === "URL") cur.urls.push(vcardValue(line));
    else if (key === "NOTE") cur.note = vcardValue(line);
  }
  return out;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<keyof Omit<ImportCandidate, "links">, string[]> = {
  fullName: ["naam", "name", "volledige naam", "full name", "contact", "display name"],
  phone: ["telefoon", "telefoonnummer", "phone", "mobiel", "mobile", "whatsapp", "nummer", "tel"],
  email: ["e-mail", "email", "e-mailadres", "mail"],
  portfolioUrl: ["portfolio", "website", "url", "showreel", "link"],
  specialisations: ["specialisatie", "specialisaties", "specialisation", "specialisations", "niche"],
  ratePerVideo: ["tarief", "prijs", "rate", "tarief per video"],
  note: ["opmerking", "opmerkingen", "notitie", "notes", "note", "toelichting"],
};

/**
 * CSV of geplakte lijst. Met kopregel worden kolommen herkend op naam; zonder
 * kopregel geldt: naam, telefoon, e-mail, portfolio.
 */
export function parseCsv(text: string): ImportCandidate[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = [";", "\t", ","].map((s) => [s, (lines[0]!.match(new RegExp(s === "\t" ? "\t" : `\\${s}`, "g")) ?? []).length] as const)
    .sort((a, b) => b[1] - a[1])[0]![0];
  const first = splitCsvLine(lines[0]!, sep).map((h) => h.toLowerCase());
  const col: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = first.findIndex((h) => aliases.includes(h));
    if (i !== -1) col[field as keyof typeof HEADER_ALIASES] = i;
  }
  const hasHeader = col.fullName !== undefined || col.phone !== undefined || col.email !== undefined;
  const map = hasHeader ? col : { fullName: 0, phone: 1, email: 2, portfolioUrl: 3 };
  const rows = hasHeader ? lines.slice(1) : lines;
  const out: ImportCandidate[] = [];
  for (const line of rows) {
    const c = splitCsvLine(line, sep);
    const get = (k: keyof typeof HEADER_ALIASES) => (map[k] !== undefined ? c[map[k]!] ?? "" : "");
    const fullName = clean(get("fullName"), 160);
    const phone = clean(get("phone"), 40);
    const email = normalizeEmail(get("email"));
    if (!fullName && !phone && !email) continue;
    out.push({
      fullName: fullName ?? phone ?? email ?? "Onbekende naam",
      phone,
      email,
      portfolioUrl: normalizeUrl(get("portfolioUrl")),
      links: [],
      specialisations: normalizeSpecialisations(get("specialisations")),
      ratePerVideo: euros(get("ratePerVideo")),
      note: clean(get("note"), 1000),
    });
  }
  return out;
}

/** Herkent zelf of het om vCards of een CSV/lijst gaat. */
export function parseImport(text: string): ImportCandidate[] {
  return /BEGIN:VCARD/i.test(text) ? parseVcards(text) : parseCsv(text);
}

export function normName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Bestaat deze editor al? Match op telefoonnummer, e-mail of exact dezelfde
 * volledige naam (geen losse voornaam: twee keer "Sem" zijn niet dezelfde).
 */
export function findDuplicate<T extends { id: string; fullName: string; phone: string | null; whatsapp: string | null; email: string | null }>(
  c: { fullName: string; phone: string | null; email: string | null },
  existing: T[],
): { match: T; reason: "telefoon" | "e-mail" | "naam" } | null {
  const ph = phoneDigits(c.phone ?? "");
  const em = normalizeEmail(c.email);
  const nm = normName(c.fullName);
  for (const e of existing) {
    if (ph && (phoneDigits(e.phone ?? "") === ph || phoneDigits(e.whatsapp ?? "") === ph)) return { match: e, reason: "telefoon" };
  }
  for (const e of existing) if (em && normalizeEmail(e.email) === em) return { match: e, reason: "e-mail" };
  for (const e of existing) if (nm.includes(" ") && normName(e.fullName) === nm) return { match: e, reason: "naam" };
  return null;
}
