import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { runJsonPrompt, type AiDoc } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import {
  centralKnowledgeText,
  clientLearnedText,
  getClientAiProfile,
  type EditingProfile,
} from "@/server/ai/knowledge";
import type { EditorBriefing } from "@/server/actions/ai-tools";

export type GenerateBriefingResult =
  | { ok: true; data: EditorBriefing }
  | { ok: false; reason?: "no_provider"; error: string };

function docFrom(pdfBase64?: string | null): AiDoc[] {
  return pdfBase64 ? [{ base64: pdfBase64, mediaType: "application/pdf" }] : [];
}

async function clientName(clientId: string): Promise<string> {
  const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return c?.name ?? "de klant";
}

/** System-prompt voor de compacte editor-briefing van één klant. */
export async function buildBriefingSystemPrompt(clientId: string): Promise<string> {
  const name = await clientName(clientId);
  const profile = await getClientAiProfile(clientId);
  const editing = (profile?.editingProfile as EditingProfile) ?? {};
  const guidelines = await centralKnowledgeText(["editing", "kwaliteit"]);
  const learned = await clientLearnedText(clientId);

  return `${SHORTCLIPS_IDENTITY}

Je maakt een KORTE, scanbare editor-briefing voor één opnamesessie van klant "${name}". De editor kan de volledige scripts zélf inzien — je herhaalt het script dus NIET. De briefing is een overzicht van de sessie + de belangrijkste montage-aandachtspunten.

ALGEMENE SHORTCLIPS-EDITINGRICHTLIJNEN:
${guidelines || "- Houd het montagetempo hoog; de eerste seconden moeten direct de aandacht trekken.\n- Gebruik de vaste Shortclips-ondertitelingsstijl.\n- Houd belangrijke producten/onderwerpen goed in beeld; plaats tekst niet over belangrijke onderdelen.\n- Gebruik alleen relevante, beschikbare beelden; vermijd onnodige effecten."}
${editing.aandachtspunten ? `\nKLANTSPECIFIEKE EDITINGVOORKEUREN:\n${editing.aandachtspunten}` : ""}
${learned ? `\nGELEERDE KLANTVOORKEUREN (bevestigd uit eerder werk):\n${learned}` : ""}

HOE JE DE AANDACHTSPUNTEN BEPAALT:
- Haal uit de scripts de EXPLICIETE aanwijzingen voor de editor: tekst die in beeld moet, montageaanwijzingen, geluidseffecten, inzoom-momenten, belangrijke productdetails, speciale overgangen, timing van humor, en dingen die absoluut niet vergeten mogen worden.
- Maak onderscheid tussen gewone scriptinhoud (verhaal/hook/CTA — NIET herhalen) en echte instructies voor de montage (WEL opnemen).
- Sla geen belangrijke aanwijzing over, maar verzin ook niets: een video zonder bijzondere montageaanwijzing krijgt een LEGE aandachtspunten-lijst.
- Presenteer nooit beelden/shots als daadwerkelijk beschikbaar wanneer die alleen uit het script zijn afgeleid.`;
}

/** User-prompt: compacte briefing voor de hele sessie. */
export function briefingUserPrompt(input: { videos?: { title: string }[]; scriptText?: string }): string {
  const titleHint =
    input.videos && input.videos.length > 0
      ? `De video's van deze opname (gebruik deze titels letterlijk in "shorts[].titel"):\n${input.videos.map((v, i) => `${i + 1}. ${v.title}`).join("\n")}\n\n`
      : "";
  return `Hieronder staan de scripts van ÉÉN opnamesessie. Maak ÉÉN compacte briefing.

${titleHint}Geef per short ALLEEN:
- "titel": de titel van de video (gebruik de echte titel; kort);
- "omschrijving": laat LEEG ("") tenzij één hele korte zin echt verheldert;
- "aandachtspunten": alléén wanneer er iets bijzonders is voor de montage (anders lege lijst). Kort en concreet.

Voor het hele project: "omschrijving" = één korte zin over de sessie; "algemeneAandachtspunten" = max 4 korte, algemene punten (tempo, eerste seconden, ondertitelingsstijl, let op gemarkeerde scriptmomenten, eventuele klantvoorkeuren).

Herhaal het script NIET. Geen uitleg van hook/midden/CTA als die al in het script staan.

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
{
  "projectIntro": { "client": "...", "aantalShorts": 0, "omschrijving": "", "algemeneAandachtspunten": ["..."] },
  "shorts": [ { "titel": "...", "omschrijving": "", "aandachtspunten": ["..."] } ]
}

${input.scriptText?.trim() ? `De scripts:\n\n${input.scriptText.trim()}` : "De scripts staan in het bijgevoegde document."}`;
}

/**
 * Kernfunctie: genereert de compacte editor-briefing uit een script-PDF (base64)
 * voor één klant. Geen auth, geen opslag — de aanroeper regelt dat. Gedeeld door
 * de handmatige tool en de automatiek.
 */
export async function generateBriefingForPdf(input: {
  clientId: string;
  pdfBase64?: string;
  scriptText?: string;
  videos?: { title: string }[];
}): Promise<GenerateBriefingResult> {
  const system = await buildBriefingSystemPrompt(input.clientId);
  const user = briefingUserPrompt({ videos: input.videos, scriptText: input.scriptText });
  const res = await runJsonPrompt<EditorBriefing>({
    system,
    user,
    documents: docFrom(input.pdfBase64),
    maxTokens: 2500,
  });
  if (!res.ok) {
    return res.reason === "no_provider"
      ? { ok: false, reason: "no_provider", error: "Er is nog geen AI-sleutel ingesteld." }
      : { ok: false, error: res.error ?? "Genereren mislukt." };
  }
  // Defensief normaliseren.
  const d = res.data;
  const data: EditorBriefing = {
    projectIntro: {
      client: String(d?.projectIntro?.client ?? "").trim(),
      aantalShorts: Number(d?.projectIntro?.aantalShorts ?? (Array.isArray(d?.shorts) ? d.shorts.length : 0)),
      omschrijving: String(d?.projectIntro?.omschrijving ?? "").trim(),
      algemeneAandachtspunten: Array.isArray(d?.projectIntro?.algemeneAandachtspunten)
        ? d.projectIntro.algemeneAandachtspunten.map((s) => String(s)).filter(Boolean)
        : [],
    },
    shorts: Array.isArray(d?.shorts)
      ? d.shorts.map((s) => ({
          titel: String(s?.titel ?? "").trim(),
          omschrijving: String(s?.omschrijving ?? "").trim(),
          aandachtspunten: Array.isArray(s?.aandachtspunten) ? s.aandachtspunten.map((a) => String(a)).filter(Boolean) : [],
        }))
      : [],
  };
  return { ok: true, data };
}
