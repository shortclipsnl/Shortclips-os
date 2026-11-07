/**
 * Sessiemappen uit de Google Drive-scriptmap van een klant herkennen en
 * ordenen. Puur (geen database, geen Drive-aanroepen), zodat het los te testen
 * is. De invoer is de al gesynchroniseerde `files`-tabel (mappen + bestanden).
 *
 * Structuur zoals die in Drive staat (en die we bewust behouden):
 *   2. SHORT VIDEO SCRIPTS / [2026 /] SESSIE 8 - 11 NOVEMBER / script.pdf
 *
 * - Een sessiemap is een map met "sessie" in de naam. Submappen daarbinnen
 *   (ADS, ORGANISCH, v2) horen bij die sessie; hun PDF's tonen we met het
 *   submaplabel erbij.
 * - PDF's die niet in een sessiemap staan (oude jaarmappen, losse mappen)
 *   groeperen we per directe map als "overige map", zodat niets verdwijnt.
 * - Alleen PDF's. PowerPoint, Word, Google Docs en macOS-restbestanden ("._")
 *   vallen weg.
 */

export type DriveEntry = {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  path: string | null;
  isFolder: boolean;
  mimeType: string | null;
  url: string | null;
  modifiedAt: string | null; // ISO
};

export type SessionPdf = {
  externalId: string;
  name: string;
  url: string | null;
  modifiedAt: string | null;
  /** Submap binnen de sessie (bijv. "ADS"), anders null. */
  subfolder: string | null;
};

export type DriveSession = {
  /** externalId van de map. */
  id: string;
  /** Mapnaam zoals in Drive (getrimd). */
  name: string;
  /** `sessie` = echte sessiemap, `map` = overige map met losse PDF's. */
  kind: "sessie" | "map";
  /** Pad van de map binnen de klantmap, voor herkenbaarheid. */
  path: string | null;
  /** Bovenliggende mappen (zonder de map zelf), bijv. "2. SHORT VIDEO SCRIPTS / 2026". */
  parentLabel: string | null;
  sessionNumber: number | null;
  /** Datum uit de mapnaam (YYYY-MM-DD) als die er is. */
  date: string | null;
  /** `dag` als dag + maand in de naam staan, `maand` als alleen de maand. */
  datePrecision: "dag" | "maand" | null;
  year: number | null;
  /** Leesbaar datumlabel, bijv. "11 nov 2026" of "april 2026". */
  dateLabel: string | null;
  modifiedAt: string | null;
  pdfs: SessionPdf[];
};

const MONTHS: Array<[RegExp, number]> = [
  [/^jan/, 1], [/^feb/, 2], [/^(maa|mrt|mar)/, 3], [/^apr/, 4], [/^mei/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^(okt|oct)/, 10], [/^nov/, 11], [/^dec/, 12],
];
const MONTH_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTH_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  for (const [re, m] of MONTHS) if (re.test(w)) return m;
  return null;
}

/** PDF herkennen op type of extensie; macOS-restbestanden en Office-lockbestanden niet. */
export function isScriptPdf(e: Pick<DriveEntry, "name" | "mimeType" | "isFolder">): boolean {
  if (e.isFolder) return false;
  const n = e.name.trim();
  if (n.startsWith("._") || n.startsWith("~$")) return false;
  return e.mimeType === "application/pdf" || n.toLowerCase().endsWith(".pdf");
}

export function isSessionFolderName(name: string): boolean {
  return /\bsessie\b/i.test(name);
}

/** Jaarmap herkennen: "2026" of "_2025". */
function yearFromFolderName(name: string): number | null {
  const m = name.trim().match(/^_?(20\d{2})$/);
  return m ? Number(m[1]) : null;
}

/**
 * Datum uit een sessienaam halen. "SESSIE 8 - 11 NOVEMBER" → dag 11, maand 11.
 * "SESSIE 1 - APRIL" → maand 4. "SESSIE 2 -MEI" → maand 5. Het sessienummer
 * zelf wordt nooit als dag gelezen.
 */
export function parseSessionName(name: string): { number: number | null; day: number | null; month: number | null } {
  const clean = name.replace(/\s+/g, " ").trim();
  const numMatch = clean.match(/sessie\s*(\d{1,3})/i);
  const number = numMatch ? Number(numMatch[1]) : null;
  // Alles na het sessienummer is de "staart" waarin de datum staat.
  const tail = numMatch ? clean.slice((numMatch.index ?? 0) + numMatch[0].length) : clean;
  const dm = tail.match(/(\d{1,2})\s*([a-zA-Z]{3,})/);
  if (dm) {
    const month = monthOf(dm[2]!);
    const day = Number(dm[1]);
    if (month && day >= 1 && day <= 31) return { number, day, month };
  }
  const mo = tail.match(/\b([a-zA-Z]{3,})\b/g) ?? [];
  for (const w of mo) {
    const month = monthOf(w);
    if (month) return { number, day: null, month };
  }
  return { number, day: null, month: null };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Aantal kalenderdagen tussen twee YYYY-MM-DD datums (absoluut). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const tb = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}

/**
 * Bouwt de sessielijst. `entries` zijn alle mappen + bestanden van de klant in
 * de scriptmap(pen). Nieuwste sessie bovenaan.
 */
export function buildDriveSessions(entries: DriveEntry[]): DriveSession[] {
  const byId = new Map(entries.map((e) => [e.externalId, e]));

  /** Keten van voorouder-mappen (dichtstbij eerst). */
  function ancestors(e: DriveEntry): DriveEntry[] {
    const out: DriveEntry[] = [];
    let cur = e.parentExternalId ? byId.get(e.parentExternalId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.externalId)) {
      seen.add(cur.externalId);
      out.push(cur);
      cur = cur.parentExternalId ? byId.get(cur.parentExternalId) : undefined;
    }
    return out;
  }

  /** Bovenste sessiemap in de keten (een sessiemap binnen een sessiemap telt niet apart). */
  function topSession(chain: DriveEntry[]): DriveEntry | null {
    let found: DriveEntry | null = null;
    for (const a of chain) if (a.isFolder && isSessionFolderName(a.name)) found = a;
    return found;
  }

  const groups = new Map<string, { folder: DriveEntry; kind: "sessie" | "map"; pdfs: SessionPdf[] }>();

  // 1. Alle sessiemappen, ook lege: zo ziet het team dat een sessie nog geen PDF heeft.
  for (const e of entries) {
    if (!e.isFolder || !isSessionFolderName(e.name)) continue;
    if (topSession(ancestors(e))) continue; // genest in een andere sessie
    groups.set(e.externalId, { folder: e, kind: "sessie", pdfs: [] });
  }

  // 2. PDF's toewijzen aan hun sessie (of hun directe map).
  for (const e of entries) {
    if (!isScriptPdf(e)) continue;
    const chain = ancestors(e);
    const session = topSession(chain);
    if (session) {
      const g = groups.get(session.externalId) ?? { folder: session, kind: "sessie" as const, pdfs: [] };
      // Submap-label: de mappen tussen de sessie en het bestand.
      const between: string[] = [];
      for (const a of chain) {
        if (a.externalId === session.externalId) break;
        between.unshift(a.name.trim());
      }
      g.pdfs.push({ externalId: e.externalId, name: e.name.trim(), url: e.url, modifiedAt: e.modifiedAt, subfolder: between.length ? between.join(" / ") : null });
      groups.set(session.externalId, g);
      continue;
    }
    const parent = chain[0];
    if (!parent) continue;
    const g = groups.get(parent.externalId) ?? { folder: parent, kind: "map" as const, pdfs: [] };
    g.pdfs.push({ externalId: e.externalId, name: e.name.trim(), url: e.url, modifiedAt: e.modifiedAt, subfolder: null });
    groups.set(parent.externalId, g);
  }

  const sessions: DriveSession[] = [];
  for (const { folder, kind, pdfs } of groups.values()) {
    const chain = ancestors(folder);
    const ancestorYear = chain.map((a) => yearFromFolderName(a.name)).find((y) => y != null) ?? null;
    const ownYear = yearFromFolderName(folder.name);
    const parsed = kind === "sessie" ? parseSessionName(folder.name) : { number: null, day: null, month: null };

    // Laatst gewijzigd: de map zelf of het nieuwste bestand erin.
    const mods = [folder.modifiedAt, ...pdfs.map((p) => p.modifiedAt)].filter(Boolean) as string[];
    const modifiedAt = mods.sort().at(-1) ?? null;

    let year = ownYear ?? ancestorYear;
    if (year == null && parsed.month && modifiedAt) {
      // Geen jaarmap: jaar afleiden uit de wijzigdatum. Een sessie wordt
      // meestal kort vóór de opname gevuld; ligt de maand ver na de
      // wijzigmaand, dan hoort hij bij het jaar ervoor.
      const md = new Date(modifiedAt);
      year = md.getUTCFullYear();
      if (parsed.month - (md.getUTCMonth() + 1) > 3) year -= 1;
    }
    if (year == null && modifiedAt) year = new Date(modifiedAt).getUTCFullYear();

    let date: string | null = null;
    let datePrecision: DriveSession["datePrecision"] = null;
    let dateLabel: string | null = null;
    if (year != null && parsed.month) {
      if (parsed.day) {
        date = iso(year, parsed.month, parsed.day);
        datePrecision = "dag";
        dateLabel = `${parsed.day} ${MONTH_SHORT[parsed.month - 1]} ${year}`;
      } else {
        date = iso(year, parsed.month, 1);
        datePrecision = "maand";
        dateLabel = `${MONTH_LONG[parsed.month - 1]} ${year}`;
      }
    }

    pdfs.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "") || a.name.localeCompare(b.name));

    const parentNames = [...chain].reverse().map((a) => a.name.trim());
    sessions.push({
      id: folder.externalId,
      name: folder.name.replace(/\s+/g, " ").trim(),
      kind,
      path: folder.path,
      parentLabel: parentNames.length ? parentNames.join(" / ") : null,
      sessionNumber: parsed.number,
      date,
      datePrecision,
      year,
      dateLabel,
      modifiedAt,
      pdfs,
    });
  }

  return sessions.sort(compareSessions);
}

/** Nieuwste eerst. Sessiemappen vóór overige mappen. */
export function compareSessions(a: DriveSession, b: DriveSession): number {
  if (a.kind !== b.kind) return a.kind === "sessie" ? -1 : 1;
  const ya = a.year ?? 0;
  const yb = b.year ?? 0;
  if (ya !== yb) return yb - ya;
  // Binnen een jaar lopen sessienummers chronologisch op.
  if (a.sessionNumber != null && b.sessionNumber != null && a.sessionNumber !== b.sessionNumber) {
    return b.sessionNumber - a.sessionNumber;
  }
  if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
  return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
}

/**
 * Hoe goed past een sessie bij een opnamedatum? Gebruikt voor het label
 * "Hoort bij deze opname" en voor de waarschuwing bij een afwijkende sessie.
 */
export function sessionMatchesShoot(s: Pick<DriveSession, "date" | "datePrecision">, shootDate: string): "match" | "mismatch" | "onbekend" {
  if (!s.date || !s.datePrecision) return "onbekend";
  if (s.datePrecision === "dag") return daysBetween(s.date, shootDate) <= 3 ? "match" : "mismatch";
  // Alleen maand bekend: zelfde jaar + maand telt als passend.
  return s.date.slice(0, 7) === shootDate.slice(0, 7) ? "match" : "mismatch";
}
