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
