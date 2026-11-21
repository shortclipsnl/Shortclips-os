/**
 * Herkennen of een binnengekomen aanvraag bij een bestaande lead of klant hoort.
 * Pure functies (geen database), zodat de regels los te testen zijn.
 *
 * Uitkomsten:
 *  - "existing": zeker dezelfde relatie (e-mail of telefoon gelijk, of
 *    bedrijfsnaam + naam/domein gelijk) → contactmoment bij die lead.
 *  - "review":   het lijkt erop, maar niet zeker genoeg, of het bedrijf is al
 *    klant zonder leadprofiel → handmatig beoordelen.
 *  - "new":      geen overeenkomst → nieuwe lead.
 */

export type MatchLead = {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
};

export type MatchClient = {
  name: string;
  status: string | null;
  website: string | null;
  emails: string[];
  phones: string[];
};

export type MatchInput = {
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
};

export type MatchResult =
  | { kind: "existing"; leadId: string; reason: string }
  | { kind: "review"; candidateLeadId: string | null; reason: string }
  | { kind: "new" };

const FREE_MAIL = new Set([
  "gmail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.nl", "live.com", "icloud.com",
  "me.com", "msn.com", "yahoo.com", "yahoo.co.uk", "home.nl", "ziggo.nl", "kpnmail.nl", "planet.nl", "xs4all.nl",
]);
/** Nepnummers die mensen invullen; daar matchen we niet op. */
const DUMMY_PHONES = new Set(["612345678", "000000000", "123456789", "611111111"]);

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|n\.?v\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function squash(s: string | null | undefined): string {
  return norm(s).replace(/ /g, "");
}
/** Laatste 9 cijfers: 06…, +316… en 316… worden zo gelijk. */
export function phoneKey(s: string | null | undefined): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  const k = d.slice(-9);
  return DUMMY_PHONES.has(k) ? null : k;
}
function businessDomain(email: string | null | undefined): string | null {
  const d = (email ?? "").toLowerCase().split("@")[1];
  return d && !FREE_MAIL.has(d) ? d : null;
}
function domainCore(domain: string | null): string | null {
  if (!domain) return null;
  const core = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  return core.length >= 3 ? core : null;
}
function siteCore(website: string | null | undefined): string {
  return squash((website ?? "").replace(/^https?:\/\/(www\.)?/i, "").split("/")[0]!.split(".").slice(0, -1).join(""));
}

export function matchLeadMail(input: MatchInput, leads: MatchLead[], clients: MatchClient[]): MatchResult {
  const email = (input.email ?? "").toLowerCase() || null;
  const phone = phoneKey(input.phone);
  const domain = businessDomain(input.email);
  const dCore = domainCore(domain);
  const companySq = squash(input.company);
  const nameSq = squash(input.contactName);
  const nameTokens = norm(input.contactName).split(" ").filter(Boolean);

  let best: { lead: MatchLead; score: number; why: string[] } | null = null;
  for (const lead of leads) {
    const why: string[] = [];
    let score = 0;
    const haySq = squash(`${lead.company} ${lead.contactName ?? ""}`);
    if (email && (lead.email ?? "").toLowerCase() === email) { why.push("e-mailadres"); score += 10; }
    if (phone && phoneKey(lead.phone) === phone) { why.push("telefoonnummer"); score += 10; }
    if (companySq.length >= 4 && haySq.includes(companySq)) { why.push("bedrijfsnaam"); score += 5; }
    else if (companySq.length >= 4 && squash(lead.company).length >= 4 && companySq.includes(squash(lead.company))) { why.push("bedrijfsnaam (deels)"); score += 4; }
    if (nameTokens.length >= 2 && nameSq.length >= 7 && haySq.includes(nameSq)) { why.push("naam contactpersoon"); score += 5; }
    if (dCore && ((dCore.length >= 5 ? haySq.includes(dCore) : norm(`${lead.company} ${lead.contactName ?? ""}`).split(" ").includes(dCore)) || siteCore(lead.website) === dCore || businessDomain(lead.email) === domain)) { why.push("e-maildomein"); score += 4; }
    if (score > 0 && (!best || score > best.score)) best = { lead, score, why };
  }

  if (best && best.score >= 9) return { kind: "existing", leadId: best.lead.id, reason: `Zelfde ${best.why.join(" + ")} als "${best.lead.company}"` };
  if (best && best.score >= 4) {
    return { kind: "review", candidateLeadId: best.lead.id, reason: `Lijkt op bestaande lead "${best.lead.company}" (${best.why.join(" + ")}), maar niet zeker genoeg` };
  }

  // Geen lead gevonden: is het bedrijf al (oud-)klant? Dan niet opnieuw als prospect aanmaken.
  for (const c of clients) {
    const cSq = squash(c.name);
    const hit =
      (email && c.emails.some((e) => e.toLowerCase() === email)) ||
      (phone && c.phones.some((p) => phoneKey(p) === phone)) ||
      (companySq.length >= 4 && cSq.length >= 4 && (cSq.includes(companySq) || companySq.includes(cSq))) ||
      (dCore && (siteCore(c.website) === dCore || cSq === dCore));
    if (hit) return { kind: "review", candidateLeadId: null, reason: `"${c.name}" is of was al klant${c.status ? ` (${c.status})` : ""}, maar heeft geen leadprofiel` };
  }
  return { kind: "new" };
}
