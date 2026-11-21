import "server-only";

/**
 * Parser voor contactformulier-mails. Haalt gestructureerde velden uit zowel
 * "Label: waarde"-regels als uit vrije tekst (regex-fallback). Verzint niets:
 * ontbreekt een veld, dan blijft het null.
 */

export type ParsedLead = {
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  message: string | null;
};

// Labelwoordenboek (NL + EN), hoofdletterongevoelig. Volgorde = prioriteit.
const LABELS: Record<keyof ParsedLead, string[]> = {
  company: ["bedrijfsnaam", "bedrijf", "company name", "company", "organisatie", "organization"],
  contactName: ["naam contactpersoon", "contactpersoon", "volledige naam", "voor- en achternaam", "naam", "voornaam", "full name", "name"],
  email: ["e-mailadres", "emailadres", "mailadres", "e-mail", "email"],
  phone: ["telefoonnummer", "telefoon", "mobiel", "mobiele nummer", "phone number", "phone", "tel"],
  website: ["website", "webadres", "url", "site"],
  message: ["bericht", "je bericht", "uw bericht", "vraag", "aanvraag", "toelichting", "opmerking", "opmerkingen", "message", "comments"],
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_RE = /(https?:\/\/[^\s<>"]+|(?:www\.)[a-z0-9.-]+\.[a-z]{2,}[^\s<>"]*)/i;
// NL/internationale telefoonnummers: +31..., 06..., 0xx-xxxxxxx, met spaties/streepjes.
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

function cleanValue(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/** Bouwt een map {canoniek veld → waarde} uit "Label: waarde"-regels. */
function parseLabeledLines(lines: string[]): Partial<Record<keyof ParsedLead, string>> {
  const found: Partial<Record<keyof ParsedLead, string>> = {};
  const labelPairs: Array<[keyof ParsedLead, string]> = [];
  for (const field of Object.keys(LABELS) as (keyof ParsedLead)[]) {
    for (const label of LABELS[field]) labelPairs.push([field, label]);
  }

  const allLabels = new Set(labelPairs.map(([, l]) => l));
  const matchLabel = (rawLabel: string): keyof ParsedLead | null => {
    let best: keyof ParsedLead | null = null;
    let bestLen = 0;
    for (const [field, label] of labelPairs) {
      if (rawLabel === label || rawLabel.endsWith(` ${label}`) || rawLabel.startsWith(`${label} `)) {
        if (label.length > bestLen && found[field] === undefined) { best = field; bestLen = label.length; }
      }
    }
    return best;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(":");
    if (colon !== -1) {
      const rawLabel = line.slice(0, colon).trim().toLowerCase();
      let value = cleanValue(line.slice(colon + 1));
      // Label op een eigen regel, waarde op de volgende regel.
      if (!value && i + 1 < lines.length) value = cleanValue(lines[i + 1]!);
      if (!value) continue;
      const best = matchLabel(rawLabel);
      if (best && found[best] === undefined) found[best] = value;
    } else {
      // Label zonder dubbele punt op een eigen regel, waarde op de volgende regel
      // (alleen bij een exacte labelmatch, en als de volgende regel geen label is).
      const rawLabel = line.trim().toLowerCase();
      if (!allLabels.has(rawLabel)) continue;
      const next = i + 1 < lines.length ? cleanValue(lines[i + 1]!) : "";
      if (!next) continue;
      const nextColon = lines[i + 1]!.indexOf(":");
      const nextLabel = nextColon !== -1 ? lines[i + 1]!.slice(0, nextColon).trim().toLowerCase() : lines[i + 1]!.trim().toLowerCase();
      if (allLabels.has(nextLabel)) continue;
      const best = matchLabel(rawLabel);
      if (best && found[best] === undefined) found[best] = next;
    }
  }
  return found;
}

export function parseLeadEmail(input: { subject?: string | null; body: string; fromName?: string | null; fromEmail?: string | null }): ParsedLead {
  const body = (input.body ?? "").replace(/\r\n/g, "\n");
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const labeled = parseLabeledLines(lines);

  const email = labeled.email?.match(EMAIL_RE)?.[0] ?? body.match(EMAIL_RE)?.[0] ?? input.fromEmail ?? null;
  const phone = labeled.phone?.match(PHONE_RE)?.[0]?.trim() ?? body.match(PHONE_RE)?.[0]?.trim() ?? null;
  let website = labeled.website ?? body.match(URL_RE)?.[0] ?? null;
  // Een gevonden e-mail is geen website; en negeer onze eigen domeinlinks niet nodig.
  if (website && EMAIL_RE.test(website)) website = null;

  const contactName = labeled.contactName ?? input.fromName ?? null;
  const company = labeled.company ?? null;

  // Bericht: expliciet veld, anders de vrije tekst zonder de herkende labelregels.
  let message = labeled.message ?? null;
  if (!message) {
    const labelWords = new Set(Object.values(LABELS).flat());
    const leftover = lines.filter((l) => {
      const c = l.indexOf(":");
      if (c === -1) return true;
      return !labelWords.has(l.slice(0, c).trim().toLowerCase());
    });
    const text = leftover.join("\n").trim();
    message = text.length > 0 ? text.slice(0, 4000) : null;
  } else {
    message = message.slice(0, 4000);
  }

  return {
    company: company ? company.slice(0, 200) : null,
    contactName: contactName ? contactName.slice(0, 160) : null,
    email: email ? email.slice(0, 160) : null,
    phone: phone ? phone.slice(0, 40) : null,
    website: website ? website.slice(0, 200) : null,
    message,
  };
}

/* ------------------------------------------------------------------------
 * Formulier-bewuste parser voor de leadsmap van info@shortclips.nl.
 *
 * In die map komen vier soorten mails binnen, elk met een eigen opmaak:
 *  - Rocket Leads        ("- Naam: …" regels)
 *  - oude site (Elementor) ("naam: … Bedrijfsnaam: …", daarna technische voet)
 *  - Framer, oude velden  (alles heet "Name:", "Number:" of "Location:")
 *  - Framer, nieuwe velden ("naam:", "telefoonnummer:", "bedrijfsnaam:" …)
 * De generieke parser hierboven leest de Framer-mails verkeerd uit (bedrijf en
 * telefoon door elkaar), vandaar deze variant. Verzint niets: ontbreekt een
 * veld, dan blijft het null. De oorspronkelijke aanvraagtekst blijft bewaard.
 * ---------------------------------------------------------------------- */

export type LeadMailInput = {
  from?: string | null;
  replyTo?: string | null;
  subject?: string | null;
  body: string;
};

export type ParsedLeadMail = {
  /** Leesbare naam van het formulier, bijv. "Website (Framer, contactformulier)". */
  formType: string;
  /** Bron zoals die op de lead komt te staan. */
  source: "Website contactformulier" | "Rocket leads";
  contactName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  message: string | null;
  /** De aanvraag zoals ingevuld, zonder technische voetregels en trackingcodes. */
  original: string;
};

const INVISIBLE_RE = /[͏­​-‏⁠﻿]/g;

function cleanBody(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(INVISIBLE_RE, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function digitsOf(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

function looksLikePhone(v: string): boolean {
  const t = v.trim();
  const d = digitsOf(t);
  return /^[+\d(][\d\s().-]{7,}$/.test(t) && d.length >= 9 && d.length <= 13 && !/^\d{1,2}-\d{1,2}-\d{4}$/.test(t);
}

/** Zet een telefoonnummer netjes neer; onbruikbare waarden ("0", te kort) worden null. */
export function normalizeLeadPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  const d = digitsOf(t);
  if (d.length < 9 || /^0+$/.test(d)) return null;
  // Het oude formulier sloeg de voorloopnul over (640773037) of het plusje (31684…).
  if (d.length === 9 && !t.startsWith("0") && !t.startsWith("+")) return `0${d}`;
  if (d.length === 11 && d.startsWith("31") && !t.startsWith("+")) return `+${d}`;
  return t.slice(0, 40);
}

type Field = { label: string; value: string };

/** "Label: waarde"-regels, met vervolgregels bij de voorgaande waarde. */
function labeledFields(body: string): Field[] {
  const out: Field[] = [];
  let cur: Field | null = null;
  for (const line of body.split("\n")) {
    const m = line.match(/^-?\s*([A-Za-zÀ-ÿ€][A-Za-zÀ-ÿ \-]{1,45}):(?!\/\/)\s?(.*)$/);
    if (m && !/^https?$/i.test(m[1]!.trim())) {
      cur = { label: m[1]!.trim().toLowerCase(), value: m[2]!.trim() };
      out.push(cur);
    } else if (cur) {
      cur.value = `${cur.value}\n${line.trim()}`.trim();
    }
  }
  return out;
}

function oneLine(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.replace(/\s*\n\s*/g, " ").trim() || null;
}

function stripTracking(s: string): string {
  return s
    .replace(/fbclid:\s*\S+/g, "")
    .replace(/(https:\/\/www\.shortclips\.nl\/[a-z\-\/]*)\?\S+/g, "$1")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function parseLeadMail(input: LeadMailInput): ParsedLeadMail {
  const from = (input.from ?? "").toLowerCase();
  const b = cleanBody(input.body ?? "");
  const r: ParsedLeadMail = {
    formType: "Website (contactformulier)",
    source: "Website contactformulier",
    contactName: null,
    company: null,
    email: null,
    phone: null,
    website: null,
    message: null,
    original: b,
  };

  if (/rocket-?leads/.test(from) || /^Bij deze een nieuwe lead van Shortclips/m.test(b)) {
    // --- Rocket Leads ---
    r.formType = "Rocket Leads";
    r.source = "Rocket leads";
    const body = b.replace(/^[\s\S]*?resultaat:\s*/, "").replace(/\n?Succes![\s\S]*$/, "");
    r.original = body;
    const items = body
      .split(/\n(?=- )/)
      .map((s) => s.replace(/^- /, "").replace(/\n/g, " ").trim())
      .filter(Boolean);
    const extra: string[] = [];
    for (const it of items) {
      const mm = it.match(/^([^:]{1,45}):\s*(.*)$/);
      const label = mm ? mm[1]!.toLowerCase() : "";
      const value = mm ? mm[2]!.trim() : it;
      if (label === "naam") r.contactName = value || null;
      else if (label === "bedrijfsnaam") r.company = value || null;
      else if (label === "email") r.email = value || null;
      else if (label === "telefoon") r.phone = normalizeLeadPhone(value);
      else extra.push(mm ? `${mm[1]}: ${value}` : `Maandomzet: ${value}`);
    }
    r.message = extra.join("\n") || null;
  } else if (/powered by: elementor/i.test(b) || /^email@shortclips\.nl$|<email@shortclips\.nl>/.test(from)) {
    // --- Oude site (Elementor) ---
    r.formType = "Website (Elementor, oude site)";
    const main = b.split(/\n---\n?/)[0] ?? b;
    const page = b.match(/Page URL: (\S+)/);
    r.original = page ? `${main}\nPagina: ${page[1]}` : main;
    const f = labeledFields(main);
    const get = (l: string) => f.find((x) => x.label === l)?.value ?? null;
    r.contactName = oneLine(get("naam"));
    r.company = oneLine(get("bedrijfsnaam"));
    r.email = oneLine(get("email"));
    r.phone = normalizeLeadPhone(oneLine(get("telefoon nummer")));
    const mm = `\n${main}`.match(/\nBericht:([\s\S]*?)(?=\n(?:Budget|Posten|Shortclips kiezen):|$)/);
    r.message = mm ? mm[1]!.trim() || null : null;
  } else {
    // --- Framer-formulieren ---
    const kennismaking = /kennismaking/.test(from) || /gratis kennismak/i.test(b.slice(0, 120));
    const meta = /landingspagina \/plan-kennismaking/.test(b);
    r.formType = kennismaking
      ? "Website (Framer, gratis kennismaking)"
      : meta
        ? "Website (Framer, landingspagina Meta-advertentie)"
        : "Website (Framer, contactformulier)";
    let main = b
      .replace(/\n?This email is a submission[\s\S]*$/, "")
      .replace(/\n© \d{4} Framer[\s\S]*$/, "")
      .replace(/^https:\/\/framer\.link\S*$/gm, "");
    const lines = main.split("\n");
    const first = lines.findIndex((l) => /^[A-Za-zÀ-ÿ\-]{2,20}:/.test(l));
    main = stripTracking(first >= 0 ? lines.slice(first).join("\n") : main);
    r.original = main;
    const f = labeledFields(main);

    if (f.some((x) => x.label === "naam")) {
      // Nieuwe formulieren met echte veldnamen.
      const get = (l: string) => f.find((x) => x.label === l)?.value ?? null;
      r.contactName = oneLine(get("naam"));
      r.phone = normalizeLeadPhone(oneLine(get("telefoonnummer")));
      r.email = oneLine(get("email"));
      r.company = oneLine(get("bedrijfsnaam"));
      r.website = oneLine(get("websiteadres"));
      r.message = get("bericht");
    } else {
      // Oude formulieren: alle velden heten Name / Number / Location. We
      // herkennen e-mail en telefoon aan de inhoud; de eerste "Name" is de
      // persoon, de eerste overige "Number" (of bij de kennismaking "Name")
      // is de bedrijfsnaam.
      const rest: Field[] = [];
      for (const x of f) {
        const v = oneLine(x.value);
        if (!v) continue;
        if (x.label === "message") { r.message = x.value; continue; }
        if (EMAIL_RE.test(v) && !/\s/.test(v)) { if (!r.email) r.email = v; continue; }
        if (!r.phone && looksLikePhone(v)) { r.phone = normalizeLeadPhone(v); continue; }
        if (x.label === "name" && !r.contactName) { r.contactName = v; continue; }
        rest.push({ label: x.label, value: v });
      }
      for (const x of rest) {
        if ((x.label === "number" || (x.label === "name" && kennismaking)) && !r.company) { r.company = x.value; continue; }
        if (x.label === "number" && !r.website && /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(x.value)) { r.website = x.value; }
      }
    }
    // Framer zet het adres van de invuller in Reply-To.
    if (!r.email && input.replyTo) r.email = input.replyTo.match(EMAIL_RE)?.[0] ?? null;
  }

  if (r.message) {
    r.message = stripTracking(r.message);
    if (/^\.?$/.test(r.message.trim())) r.message = null;
  }
  r.email = r.email ? (r.email.match(EMAIL_RE)?.[0] ?? null) : null;
  return {
    ...r,
    contactName: r.contactName ? r.contactName.slice(0, 160) : null,
    company: r.company ? r.company.slice(0, 200) : null,
    email: r.email ? r.email.slice(0, 160) : null,
    website: r.website ? r.website.slice(0, 200) : null,
    message: r.message ? r.message.slice(0, 4000) : null,
    original: r.original.slice(0, 6000),
  };
}
