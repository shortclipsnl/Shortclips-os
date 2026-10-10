import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiKnowledge } from "@/db/schema";

/**
 * Zet een startset in de centrale AI-kennisbank op basis van de vaste Shortclips-
 * richtlijnen. Idempotent: items met dezelfde titel worden niet opnieuw toegevoegd.
 * Jarno kan ze daarna in het dashboard aanpassen/aanvullen.
 */
const STARTER: Array<{ category: string; title: string; body: string }> = [
  {
    category: "editing",
    title: "Algemene editingrichtlijnen Shortclips",
    body: [
      "Kies momenten waarop presentatoren goed in beeld staan.",
      "Vermijd ongelukkige gezichtsuitdrukkingen, gesloten ogen en vreemde tussenframes.",
      "Selecteer waar mogelijk natuurlijke momenten waarop mensen lachen of prettig overkomen.",
      "Zorg dat belangrijke producten, auto's en andere onderwerpen goed zichtbaar blijven.",
      "Plaats tekst niet over belangrijke onderdelen van een auto, product of gezicht.",
      "Controleer of ondertiteling geen belangrijke visuele informatie blokkeert.",
      "Let op de juiste compositie en uitsnede.",
      "Zorg dat de eerste seconden visueel sterk zijn.",
      "Houd het tempo passend bij het concept.",
      "Gebruik alleen relevante en beschikbare beelden; voorkom onnodige effecten of afleidende grafische elementen.",
      "Zorg dat de edit aansluit op de premium uitstraling van Shortclips.",
      "Controleer iedere scène afzonderlijk op visuele kwaliteit.",
    ].map((l) => `- ${l}`).join("\n"),
  },
  {
    category: "communicatie",
    title: "Communicatiestijl Shortclips",
    body: [
      "Professioneel, maar niet overdreven formeel.",
      "Vriendelijk, persoonlijk en direct.",
      "Natuurlijke Nederlandse zinnen; niet te lange berichten.",
      "Geen standaard AI-taalgebruik; niet onnodig commercieel.",
      "Duidelijk communiceren over afspraken en verwachtingen.",
      "Spreken vanuit Shortclips als team (zoveel mogelijk vanuit 'wij').",
      "Geen toezeggingen doen die niet gecontroleerd zijn; geen afspraken, deadlines of prijzen verzinnen.",
      "Verschil maken tussen een WhatsApp-antwoord (korter, informeler) en een e-mail (iets uitgebreider, met nette aanhef/afsluiting).",
    ].map((l) => `- ${l}`).join("\n"),
  },
  {
    category: "escalatie",
    title: "Wanneer doorsturen naar Jarno",
    body: [
      "Signaleer gevoelige onderwerpen: klachten, financiële afspraken en contractwijzigingen.",
      "Bij zulke onderwerpen: geef duidelijk aan dat akkoord van Jarno nodig is voordat er iets wordt teruggestuurd.",
      "Bij twijfel of onvoldoende informatie: niets verzinnen, maar aangeven welke informatie nog ontbreekt.",
    ].map((l) => `- ${l}`).join("\n"),
  },
  {
    category: "bedrijf",
    title: "Over Shortclips",
    body: [
      "Shortclips is een short video bureau en fungeert als de externe contentafdeling van klanten; vestigingen in Amsterdam en Sneek.",
      "We maken korte verticale video's (short-form) voor Instagram Reels, TikTok en YouTube Shorts.",
      "We werken in een vast ritme: strategie, scripts, opnamedagen, editing, goedkeuring, publicatie en resultaten — in één doorlopend proces.",
      "Content is organisch of organisch + advertentie, afhankelijk van de afspraak met de klant.",
      "Toon en uitstraling zijn premium; we spreken en werken vanuit het team ('wij').",
    ].map((l) => `- ${l}`).join("\n"),
  },
  {
    category: "werkwijze",
    title: "Productieproces van opname tot publicatie",
    body: [
      "Vaste volgorde per video: script schrijven → script goedkeuren → opnamedag (draaidag) → editing → interne controle → klantcontrole → goedgekeurd → inplannen → publiceren → resultaten.",
      "Scripts worden eerst intern en daarna door de klant goedgekeurd voordat er wordt opgenomen.",
      "Na de edit volgt eerst interne controle, daarna pas de klantcontrole.",
      "Publicatie gebeurt standaard op werkdagen (maandag t/m vrijdag); weekend wordt overgeslagen.",
      "Het afgesproken aantal shorts per maand (afname) staat per klant vast in Monday.",
      "Bestanden en versies staan in Frame.io; klant- en projectgegevens in Monday.",
    ].map((l) => `- ${l}`).join("\n"),
  },
  {
    category: "afspraken",
    title: "Afspraken rondom deadlines en feedback",
    body: [
      "Elke productiefase heeft een streeftijd; video's die daar overheen gaan krijgen voorrang en worden als 'te laat' gemarkeerd.",
      "Klantfeedback is nodig om door te kunnen; we vragen de klant tijdig (binnen enkele werkdagen) te reageren en sturen een herinnering als het te lang stil blijft.",
      "Beloof nooit een exacte opleverdatum of doorlooptijd zonder dat die is afgestemd; verwijs bij twijfel naar de planning in het dashboard.",
      "Tarieven, contractduur en editkosten staan per klant in Monday — nooit zelf prijzen of bedragen verzinnen; haal ze uit het financieel overzicht of verwijs naar Jarno.",
    ].map((l) => `- ${l}`).join("\n"),
  },
];

export async function seedAiKnowledge(): Promise<{ ok: boolean; added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const item of STARTER) {
    const [exists] = await db
      .select({ id: aiKnowledge.id })
      .from(aiKnowledge)
      .where(and(eq(aiKnowledge.title, item.title), isNull(aiKnowledge.deletedAt)))
      .limit(1);
    if (exists) {
      skipped++;
      continue;
    }
    await db.insert(aiKnowledge).values(item);
    added++;
  }
  return { ok: true, added, skipped };
}
