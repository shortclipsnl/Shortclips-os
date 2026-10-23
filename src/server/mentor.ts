import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mentorMemories } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { getQualityOverview, type QualityGroup } from "@/server/quality";
import { getGoalsOverview } from "@/server/goals/overview";
import { getCapacityOverview } from "@/server/capacity";
import { getManagementFinance } from "@/server/management-finance";
import { listLeads } from "@/server/leads";
import { aiModel } from "@/server/ai/client";

const MEMORY_LABEL: Record<string, string> = {
  voorkeur: "Voorkeuren", feit: "Bedrijfsfeiten", beslissing: "Beslissingen", actie: "Openstaande acties", inzicht: "Inzichten",
};
const eur = (n?: number | null) => (n === null || n === undefined || Number.isNaN(n) ? "onbekend" : `€${Math.round(n).toLocaleString("nl-NL")}`);

/**
 * De AI CEO Mentor voor de eigenaar: een kritische, datagedreven sparringpartner.
 * De persona + het beslissingsframework staan hier; de live bedrijfscontext wordt
 * per gesprek opgebouwd uit de bestaande Hub-data (nooit verzonnen cijfers).
 */
export const MENTOR_SYSTEM = `Je bent de persoonlijke AI CEO Mentor van Jarno, eigenaar van Shortclips — een Nederlands bureau voor organische short video's (TikTok/Reels/Shorts).

Je bent tegelijk strategisch bedrijfsadviseur, CEO-coach, financieel sparringpartner, operationeel adviseur, leiderschapscoach en kritische gesprekspartner. Je enige doel: Jarno helpen Shortclips uit te bouwen tot een schaalbaar, winstgevend bedrijf dat steeds minder afhankelijk wordt van zijn dagelijkse betrokkenheid.

KARAKTER
Direct, kritisch, analytisch, strategisch, ondernemend, respectvol, praktisch en resultaatgericht. Bevestig een idee niet automatisch. Is een voorstel zwak, leg dan concreet uit waarom en geef een beter alternatief. Voert Jarno werk uit dat gedelegeerd zou moeten worden, benoem dat. Levert een investering weinig rendement, onderbouw dat.

DENKPRINCIPES
Denk consequent vanuit first principles, schaalbaarheid, leverage, rendement, eigenaarschap, systemen, focus, lange termijn, opportunity costs en het verminderen van afhankelijkheid van Jarno. Pak oorzaken aan, niet alleen symptomen.

BESLISSINGSFRAMEWORK (intern gebruiken bij belangrijke keuzes; niet altijd volledig tonen)
1) Wat is het echte probleem? 2) Onderliggende oorzaak? 3) Welke aannames maakt Jarno? 4) Welke bedrijfsgegevens zijn beschikbaar? 5) Welke lessen/principes gelden hier? 6) Oplossingsrichtingen? 7) Hoogste verwachte rendement? 8) Meest schaalbaar? 9) Risico's? 10) Eindadvies. 11) Concrete eerstvolgende actie.

WERKWIJZE
- Kleine vraag = kort en concreet antwoord. Grote strategische beslissing = diepgaande analyse, eindig met: de aanbevolen beslissing, de belangrijkste argumenten en één concrete vervolgstap.
- Herken zelf het type vraag (strategie, leiderschap, financieel, operationeel, beslissing, focus) en kies de juiste benadering — Jarno hoeft geen modus te kiezen.
- Gebruik de meegeleverde live bedrijfscontext als feitenbasis. Verzin NOOIT omzet, kosten, aantallen of andere cijfers. Ontbreekt data, zeg dat expliciet in plaats van aannames als feit te presenteren. Vermeld bij een analyse op welke gegevens je je baseert.
- Scheid duidelijk: (1) advies op basis van ondernemerslessen/principes, (2) je eigen analyse, (3) conclusies uit de bedrijfsgegevens.
- Stel een gerichte vervraag alleen als essentiële informatie ontbreekt; kom anders zelfstandig tot een bruikbare aanbeveling.
- Je wijzigt nooit zelf klanten, projecten, prijzen, taken of financiële gegevens. Je adviseert; Jarno beslist.

PERSOONLIJK GEHEUGEN
Je hebt een geheugen met door Jarno vastgelegde voorkeuren, bedrijfsfeiten, beslissingen en openstaande acties. Gebruik dit actief in je advies. Kom bij relevante gelegenheid terug op openstaande acties en beslissingen — vraag waarom iets nog niet is uitgevoerd, of de prioriteit is veranderd, of een betere aanpak nodig is. Je mag voorstellen iets vast te leggen (bijv. "overweeg dit als beslissing vast te leggen"), maar je slaat NOOIT zelf iets op in het geheugen of in het portaal — dat doet Jarno zelf.`;

const GROUP_LABEL: Record<QualityGroup, string> = {
  scripting: "Scripting",
  editing: "Video editing",
  klant: "Klantcontact",
  planning: "Opnames & planning",
  overig: "Overig",
};

/** Bouwt een beknopte, actuele bedrijfssnapshot uit de bestaande Hub-data. */
export async function buildMentorContext(viewer: Viewer): Promise<string> {
  const [quality, goals, cap, fin, leads, memories] = await Promise.all([
    getQualityOverview(viewer).catch(() => null),
    getGoalsOverview(viewer).catch(() => null),
    getCapacityOverview().catch(() => null),
    getManagementFinance().catch(() => null),
    listLeads().catch(() => null),
    db.select({ kind: mentorMemories.kind, content: mentorMemories.content, status: mentorMemories.status })
      .from(mentorMemories).where(and(eq(mentorMemories.userId, viewer.id), isNull(mentorMemories.deletedAt)))
      .orderBy(desc(mentorMemories.createdAt)).limit(80).catch(() => []),
  ]);

  const parts: string[] = [];
  parts.push(`Vandaag: ${new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Onderstaande gegevens komen live uit het Shortclips-portaal.`);

  if (quality) {
    parts.push(`\nACTUELE AANDACHTSPUNTEN (automatisch gesignaleerd — ${quality.counts.rood} directe actie, ${quality.counts.oranje} extra aandacht, ${quality.counts.blauw} vooruitkijken):`);
    const byGroup = new Map<QualityGroup, string[]>();
    for (const it of quality.items) {
      const g = it.group ?? "overig";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(`${it.title} — ${it.detail} [${it.severity}]`);
    }
    for (const [g, lines] of byGroup) parts.push(`• ${GROUP_LABEL[g]}: ${lines.slice(0, 8).join(" | ")}`);
  } else {
    parts.push("\nAandachtspunten: op dit moment niet beschikbaar.");
  }

  if (cap) {
    const s = cap.summary;
    parts.push(`\nBEDRIJF & CAPACITEIT: ${s.activeClients} actieve klanten; ${s.monthlyShorts} shorts per maand; ${s.activeEditors} actieve editors; benutting editketen ${s.editChainUsedPct != null ? s.editChainUsedPct + "%" : "onbekend"}.`);
  }

  if (fin) {
    parts.push(`\nFINANCIEEL (uit de Hub): terugkerende omzet (MRR) ${eur(fin.mrr)}; verwacht volgende maand ${eur(fin.expectedNextMonth)}; pipeline ${eur(fin.pipeline?.monthly)}/mnd uit ${fin.pipeline?.count ?? 0} open kansen.`);
    if (fin.book?.hasData) {
      parts.push(`Officiële boekhouding (Digiboox) ${new Date().getFullYear()}: omzet ${eur(fin.book.yearRevenue)}, resultaat ${eur(fin.book.yearResult)}${fin.book.lastImportedAt ? ` — geïmporteerd ${new Date(fin.book.lastImportedAt).toLocaleDateString("nl-NL")}` : ""}.`);
    } else {
      parts.push("Officiële boekhouding (Digiboox) is nog niet geïmporteerd; gebruik geen harde winstcijfers.");
    }
    const last = (fin.months ?? []).slice(-3);
    if (last.length) parts.push(`Recente maanden (interne staat): ${last.map((m) => `${m.period}: omzet ${eur(m.income)}, resultaat ${eur(m.result)} (marge ${m.margin}%)`).join(" | ")}.`);
  }
  if (cap && (cap.summary.monthlyRevenue != null || cap.summary.estimatedProfit != null)) {
    parts.push(`Schatting uit capaciteit: maandomzet ${eur(cap.summary.monthlyRevenue)}, personeelskosten ${eur(cap.summary.staffCost)}, geschatte winst ${eur(cap.summary.estimatedProfit)} (schatting, geen boekhouding).`);
  }

  if (leads) {
    const s = leads.summary;
    parts.push(`\nSALES/LEADS: ${s.open} open, ${s.won} gewonnen, ${s.lost} verloren${s.overdue ? `, ${s.overdue} met opvolging te laat` : ""} (totaal ${s.total}).`);
  }

  if (goals && goals.rows.length > 0) {
    parts.push(`\nDOELEN (status): ${goals.rows.map((g) => `${g.title} — ${g.status}`).join(" | ")}`);
  }

  if (memories.length > 0) {
    parts.push("\nPERSOONLIJK GEHEUGEN (door Jarno vastgelegd — gebruik dit actief; openstaande acties/beslissingen mag je opvolgen):");
    const byKind = new Map<string, string[]>();
    for (const m of memories) {
      const k = m.kind || "inzicht";
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(m.status ? `${m.content} [${m.status}]` : m.content);
    }
    for (const [k, lines] of byKind) parts.push(`• ${MEMORY_LABEL[k] ?? k}: ${lines.slice(0, 20).join(" | ")}`);
  }

  parts.push("\nGegevens die ontbreken of verouderd zijn, zijn hierboven als zodanig gemarkeerd. Verzin geen cijfers; benoem wat je niet weet.");
  return parts.join("\n");
}

/* ---------------- Diagnose (Fase 7: optimalisatie) ---------------- */

export type MentorDiagnostics = {
  model: string;
  promptCaching: boolean;
  contextChars: number;
  sources: { key: string; label: string; ok: boolean; detail: string }[];
};

/**
 * Transparante zelfcontrole: welke live databronnen voeden de mentor, met
 * kerncijfers erbij. Maakt zichtbaar waarop adviezen zijn gebaseerd (en dat er
 * niets verzonnen wordt). Snel — geen AI-aanroep.
 */
export async function getMentorDiagnostics(viewer: Viewer): Promise<MentorDiagnostics> {
  const [quality, cap, fin, leads, goals, memRows, context] = await Promise.all([
    getQualityOverview(viewer).catch(() => null),
    getCapacityOverview().catch(() => null),
    getManagementFinance().catch(() => null),
    listLeads().catch(() => null),
    getGoalsOverview(viewer).catch(() => null),
    db.select({ id: mentorMemories.id })
      .from(mentorMemories).where(and(eq(mentorMemories.userId, viewer.id), isNull(mentorMemories.deletedAt)))
      .then((r) => r as { id: string }[]).catch(() => null),
    buildMentorContext(viewer).catch(() => ""),
  ]);

  const sources = [
    { key: "quality", label: "Aandachtspunten", ok: !!quality, detail: quality ? `${quality.items.length} signalen (${quality.counts.rood} rood, ${quality.counts.oranje} oranje, ${quality.counts.blauw} blauw)` : "niet beschikbaar" },
    { key: "capacity", label: "Bedrijf & capaciteit", ok: !!cap, detail: cap ? `${cap.summary.activeClients} klanten · ${cap.summary.monthlyShorts} shorts/mnd · ${cap.summary.activeEditors} editors` : "niet beschikbaar" },
    { key: "finance", label: "Financieel", ok: !!fin, detail: fin ? `MRR ${eur(fin.mrr)} · boekhouding ${fin.book?.hasData ? "geïmporteerd" : "niet geïmporteerd"}` : "niet beschikbaar" },
    { key: "leads", label: "Sales & leads", ok: !!leads, detail: leads ? `${leads.summary.open} open · ${leads.summary.won} gewonnen · ${leads.summary.total} totaal` : "niet beschikbaar" },
    { key: "goals", label: "Doelen", ok: !!goals, detail: goals ? (goals.rows.length ? `${goals.rows.length} doelen vastgelegd` : "geen doelen vastgelegd") : "niet beschikbaar" },
    { key: "memory", label: "Persoonlijk geheugen", ok: memRows !== null, detail: memRows === null ? "niet beschikbaar" : memRows.length ? `${memRows.length} herinneringen` : "nog leeg" },
  ];

  return { model: aiModel(), promptCaching: true, contextChars: context.length, sources };
}
