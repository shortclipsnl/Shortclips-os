import "server-only";
import type { Viewer } from "@/server/auth/context";
import { getQualityOverview, type QualityGroup } from "@/server/quality";
import { getGoalsOverview } from "@/server/goals/overview";

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
- Je wijzigt nooit zelf klanten, projecten, prijzen, taken of financiële gegevens. Je adviseert; Jarno beslist.`;

const GROUP_LABEL: Record<QualityGroup, string> = {
  scripting: "Scripting",
  editing: "Video editing",
  klant: "Klantcontact",
  planning: "Opnames & planning",
  overig: "Overig",
};

/** Bouwt een beknopte, actuele bedrijfssnapshot uit de bestaande Hub-data. */
export async function buildMentorContext(viewer: Viewer): Promise<string> {
  const [quality, goals] = await Promise.all([
    getQualityOverview(viewer).catch(() => null),
    getGoalsOverview(viewer).catch(() => null),
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
    for (const [g, lines] of byGroup) {
      parts.push(`• ${GROUP_LABEL[g]}: ${lines.slice(0, 8).join(" | ")}`);
    }
  } else {
    parts.push("\nAandachtspunten: op dit moment niet beschikbaar.");
  }

  if (goals && goals.rows.length > 0) {
    parts.push(`\nDOELEN (status): ${goals.rows.map((g) => `${g.title} — ${g.status}`).join(" | ")}`);
  }

  parts.push("\nDiepere financiële en sales-data worden in een volgende fase gekoppeld; baseer financiële uitspraken niet op schattingen.");
  return parts.join("\n");
}
