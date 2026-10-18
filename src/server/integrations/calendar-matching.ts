/**
 * Afspraak → klant koppelen.
 *
 * Dit is bewust een pure module zonder database: hij krijgt een afspraak en een
 * lijst klanten, en beslist welke klant erbij hoort. Zo is de logica volledig
 * te testen, en — belangrijker — zo kunnen we garanderen dat een onzekere
 * afspraak NOOIT stilletjes bij de verkeerde klant belandt.
 *
 * Gebaseerd op het echte patroon in de ShortClips-agenda's:
 *   titel  "Shortclips x SHADES monthly shootday"
 *   gasten thomas@buildingsgroup.nl (klant) + info@shortclips.nl (intern)
 *
 * Signalen, van sterk naar zwak:
 *   1. deelnemer-e-mail komt exact overeen met een klantcontact
 *   2. deelnemer-domein komt overeen met een bekend klantdomein
 *   3. de naam/alias ná "Shortclips x" in de titel
 *   4. de klantnaam/alias komt ergens in de titel voor
 *
 * Eén klant uit alle signalen → koppelen. Nul → "geen klant". Meerdere
 * verschillende → "ambigu": handmatig controleren, niet gokken.
 */
import { matchScore, normalizeName } from "@/server/import";
import type { CalendarEvent } from "./google-calendar";

export type AppointmentKind =
  | "opname"
  | "scriptbespreking"
  | "evaluatie"
  | "publicatie"
  | "intern"
  | "overig";

export type ClientMatcher = {
  id: string;
  name: string;
  slug: string;
  /** Extra namen of merken, bijv. ["SHADES"] voor BUILDINGS Group. */
  aliases?: string[];
  /** E-mailadressen van klantcontacten. */
  contactEmails?: string[];
  /** E-maildomeinen van de klant, bijv. ["buildingsgroup.nl"]. */
  domains?: string[];
};

export type MatchConfidence = "high" | "medium" | "none" | "ambiguous";

export type MatchResult = {
  clientId: string | null;
  confidence: MatchConfidence;
  reason: string;
  /** Welke signalen matchten, voor uitleg in het beheer. */
  matchedBy: string[];
  /** Alle klanten die matchten (bij 'ambiguous' > 1), voor de review. */
  candidates: string[];
};

/* --------------------------- intern vs extern --------------------------- */

const INTERNAL_DOMAINS = ["shortclips.nl"];
const INTERNAL_EMAILS = new Set([
  "teamshortclips@gmail.com",
  "jarnoklijnsma9@gmail.com",
  "info@shortclips.nl",
]);

export function isInternalEmail(email?: string | null): boolean {
  if (!email) return true;
  const e = email.toLowerCase().trim();
  if (INTERNAL_EMAILS.has(e)) return true;
  const domain = e.split("@")[1] ?? "";
  return INTERNAL_DOMAINS.includes(domain);
}

/**
 * Herkent afspraken die duidelijk intern zijn (vrije dagen, kantinediensten,
 * teammeetings, eigen branding/content, administratie). Die horen niet bij een
 * klant én niet in de controlelijst — anders verzuipt het team in ruis.
 *
 * Conservatief: alleen als er GEEN externe deelnemer is. Zodra er iemand van
 * buiten bij zit (lead, partner, freelancer) blijft de afspraak ter controle,
 * zodat we nooit per ongeluk iets klant-relevants verbergen.
 */
const INTERNAL_CALENDARS = /(dagindeling|socials)/i;
const INTERNAL_TITLE_PATTERNS: RegExp[] = [
  /\bvrij\b/i, /vakantie/i, /verlof/i, /\bziek\b/i,
  /kantine/i, /kantoordag/i, /\bkantoor\b/i, /borrel/i,
  /team\s*meeting/i, /teammeeting/i, /weekstart/i, /stand\s*-?\s*up/i,
  /vaste\s+wekelijkse/i, /wekelijkse\s+team/i,
  /branding/i, /aan het bedrijf werken/i,
  /beeldbank/i, /behind the scenes/i, /eigen kanaal/i,
  /linkedin\s*post/i, /shortclips\s*post/i,
  /factuur/i, /betalen/i, /uitbetaling/i,
  /\btraining\b/i, /refresh meeting/i, /editors?\s*meeting/i,
  /day in the life/i,
  /verjaardag/i, /tandarts/i, /\blunch/i,
  /mee met opname/i, /mee\s*filmen/i,
];

export function isInternalAppointment(
  event: CalendarEvent,
  calendarSummary?: string | null,
): boolean {
  const hasExternalAttendee = (event.attendees ?? []).some(
    (a) => a.email && !isInternalEmail(a.email),
  );
  if (hasExternalAttendee) return false;
  if (calendarSummary && INTERNAL_CALENDARS.test(calendarSummary)) return true;
  const title = event.summary ?? "";
  return INTERNAL_TITLE_PATTERNS.some((p) => p.test(title));
}

function emailDomain(email?: string | null): string | null {
  if (!email) return null;
  const d = email.toLowerCase().split("@")[1];
  return d || null;
}

/* ------------------------------ soort afspraak ------------------------------ */

const TYPE_RULES: Array<{ kind: AppointmentKind; pattern: RegExp }> = [
  // Opnames worden door het team verschillend genoemd: "opname", "opnamedag",
  // "opnamesessie", "opnamessie", "sessie", maar ook shoot/draaidag/filmen.
  // opname\w* vangt alle opname-varianten (de oude \bopname\b miste juist
  // "opnamesessie"). "sessie" los wordt ook als opname gelezen.
  { kind: "opname", pattern: /\b(opname\w*|draaidag|shoot ?day|shoot|filmdag|filmen|sessie)\b/i },
  { kind: "scriptbespreking", pattern: /\b(script(bespreking|overleg)?|conceptbespreking)\b/i },
  { kind: "evaluatie", pattern: /\b(evaluatie(gesprek)?|voortgangsgesprek|kwartaalgesprek|review ?gesprek)\b/i },
  { kind: "publicatie", pattern: /\b(publicatie|online zetten|uploaden|plaatsen|posten)\b/i },
];

export function classifyAppointment(title?: string | null, calendarSummary?: string | null): AppointmentKind {
  if (calendarSummary && /content\s*uploaden/i.test(calendarSummary)) return "publicatie";
  const text = `${title ?? ""} ${calendarSummary ?? ""}`;
  for (const rule of TYPE_RULES) if (rule.pattern.test(text)) return rule.kind;
  return "overig";
}

/* ------------------------------ titel-alias ------------------------------ */

const TYPE_WORDS =
  /\b(monthly|shoot ?day|shoot|opname\w*|draaidag|sessie|script(bespreking)?|evaluatie|publicatie|upload(en)?|meeting|overleg|call|bespreking|strategie)\b/i;

/** Haalt de klant-aanduiding uit "Shortclips x <KLANT> ...". */
export function extractTitleHint(title?: string | null): string | null {
  if (!title) return null;
  const m = title.match(/short\s*clips\s*[x×]\s*(.+)/i);
  if (!m) return null;
  let rest = m[1].trim();
  const stop = rest.search(TYPE_WORDS);
  if (stop > 0) rest = rest.slice(0, stop).trim();
  return rest || m[1].trim();
}

function clientNames(client: ClientMatcher): string[] {
  return [client.name, client.slug, ...(client.aliases ?? [])].filter(Boolean);
}

function titleMatchesClient(hint: string, client: ClientMatcher): boolean {
  const nHint = normalizeName(hint);
  if (!nHint) return false;
  for (const name of clientNames(client)) {
    const n = normalizeName(name);
    if (!n) continue;
    if (matchScore(hint, name) >= 85) return true;
    if (n.length >= 3 && (n === nHint || n.includes(nHint) || nHint.includes(n))) return true;
  }
  return false;
}

/* -------------------------------- matchen -------------------------------- */

export function matchEvent(
  event: CalendarEvent,
  clients: ClientMatcher[],
  calendarSummary?: string | null,
): MatchResult {
  const matchedBy: string[] = [];
  const hits = new Set<string>();

  // 1 + 2: externe deelnemers (e-mail en domein) — het sterkste signaal.
  const externalEmails = (event.attendees ?? [])
    .map((a) => a.email?.toLowerCase().trim())
    .filter((e): e is string => Boolean(e) && !isInternalEmail(e));

  let hasStrongSignal = false;
  for (const client of clients) {
    const emails = (client.contactEmails ?? []).map((e) => e.toLowerCase());
    const domains = (client.domains ?? []).map((d) => d.toLowerCase());
    for (const e of externalEmails) {
      if (emails.includes(e)) {
        hits.add(client.id);
        matchedBy.push(`deelnemer:${e}`);
        hasStrongSignal = true;
      } else {
        const d = emailDomain(e);
        if (d && domains.includes(d)) {
          hits.add(client.id);
          matchedBy.push(`domein:${d}`);
          hasStrongSignal = true;
        }
      }
    }
  }

  // 3: titel-alias "Shortclips x <KLANT>".
  const hint = extractTitleHint(event.summary);
  if (hint) {
    for (const client of clients) {
      if (titleMatchesClient(hint, client)) {
        hits.add(client.id);
        matchedBy.push(`titel:${hint}`);
      }
    }
  }

  // 4: klantnaam/alias ergens in de volledige titel (zwak; alleen als nog niets).
  if (hits.size === 0 && event.summary) {
    const nTitle = normalizeName(event.summary);
    for (const client of clients) {
      for (const name of clientNames(client)) {
        const n = normalizeName(name);
        if (n.length >= 4 && nTitle.includes(n)) {
          hits.add(client.id);
          matchedBy.push(`titel-bevat:${client.slug}`);
          break;
        }
      }
    }
  }

  const candidates = [...hits];
  const unique = [...new Set(matchedBy)];

  if (candidates.length === 1) {
    return {
      clientId: candidates[0],
      confidence: hasStrongSignal ? "high" : "medium",
      reason: `Gekoppeld via ${unique.join(", ")}.`,
      matchedBy: unique,
      candidates,
    };
  }
  if (candidates.length === 0) {
    return {
      clientId: null,
      confidence: "none",
      reason: "Geen herkenbare klant in titel of deelnemers.",
      matchedBy: [],
      candidates: [],
    };
  }
  return {
    clientId: null,
    confidence: "ambiguous",
    reason: `Meerdere mogelijke klanten (${candidates.length}). Handmatig controleren.`,
    matchedBy: unique,
    candidates,
  };
}
