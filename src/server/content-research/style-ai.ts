import "server-only";
import { aiModelStrong, runStructured } from "@/server/ai/client";
import { wellFormed } from "./generate";
import type { PostAnalysis } from "./post-performance";
import { normalizeStyle, type StyleProfile } from "./style-core";

/** Eén uitgelezen scriptdocument. */
export type ScriptDoc = { name: string; modifiedAt: string | null; text: string };

/* ------------------------------- AI: profiel maken ------------------------------- */

const STYLE_SYSTEM = `Je bent hoofdredacteur bij Shortclips, een Nederlands bureau dat short-form video's (TikTok, Reels, Shorts) maakt voor bedrijven. Je analyseert de ECHTE scripts die Shortclips eerder voor één klant schreef en legt precies vast hoe er voor deze klant geschreven wordt, zodat nieuwe ideeën klinken alsof dezelfde scriptschrijver ze maakte.

Regels:
- Baseer je alleen op de aangeleverde scripts, regels en feedback. Verzin niets.
- Voorbeeldhooks en voorbeeld-CTA's zijn LETTERLIJK overgenomen uit de scripts (inclusief hoofdletters, leestekens en plaatshouders zoals [MODELNAAM]).
- Een hook is alleen "bewezen" als een document weergaven/resultaten noemt (bijv. een hookanalyse) of als hij duidelijk overeenkomt met een sterk presterende video uit de videodata. Vermeld dan het bewijs tussen haakjes. Anders: niet bij bewezenHooks.
- "pastNiet" beschrijft concreet wat je in deze scripts NOOIT ziet of wat de klant, het team of de videodata afkeurde (toon, woorden, onderwerpen, vormen). Noem alleen wat je echt uit de aangeleverde stukken kunt afleiden, geen algemene regels.
- Beschrijf bij "format" ook wat er wel en niet letterlijk wordt uitgeschreven (bijv. bij interviews: alleen de vragen, antwoorden als regieaanwijzing).
- Schrijf in het Nederlands, kort en concreet.`;

const s_ = { type: "string" } as const;
const sa_ = { type: "array", items: s_ } as const;
const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["samenvatting", "format", "aanspreekvorm", "hookPatronen", "voorbeeldHooks", "bewezenHooks", "middenstukStijl", "ctaStijl", "voorbeeldCtas", "schrijfkenmerken", "woordenschat", "pastNiet", "onderwerpen"],
  properties: {
    samenvatting: s_,
    format: s_,
    aanspreekvorm: s_,
    hookPatronen: sa_,
    voorbeeldHooks: sa_,
    bewezenHooks: sa_,
    middenstukStijl: s_,
    ctaStijl: s_,
    voorbeeldCtas: sa_,
    schrijfkenmerken: sa_,
    woordenschat: sa_,
    pastNiet: sa_,
    onderwerpen: sa_,
  },
};

export function videoEvidenceText(a: PostAnalysis | null): string {
  if (!a || a.posts === 0) return "";
  const fmt = (p: PostAnalysis["top"][number]) =>
    `- ${p.platform}, ${p.views.toLocaleString("nl-NL")} views (${p.relatief.toFixed(1)}x eigen mediaan): "${p.opening}"`;
  const lines = [`VIDEODATA (alleen video's, ${a.posts} stuks, ${a.zekerheid}). Openingsregel = caption, niet per se de gesproken hook:`];
  if (a.top.length) lines.push("Sterk:", ...a.top.slice(0, 8).map(fmt));
  if (a.zwak.length) lines.push("Zwak:", ...a.zwak.slice(0, 5).map(fmt));
  return lines.join("\n");
}

export async function buildStyleProfile(input: {
  clientName: string;
  docs: ScriptDoc[];
  learnedRules: string;
  feedback: string;
  videoText: string;
  teamNotes: string;
  model?: string;
}): Promise<{ ok: true; profile: StyleProfile } | { ok: false; error: string }> {
  const user = wellFormed([
    `KLANT: ${input.clientName}`,
    input.teamNotes.trim() ? `CORRECTIES VAN HET TEAM OP DE STIJL (leidend):\n${input.teamNotes.trim()}` : "",
    input.learnedRules ? `GELEERDE SCRIPTREGELS (door het team vastgelegd):\n${input.learnedRules.slice(0, 5000)}` : "",
    input.feedback ? `KLANTFEEDBACK OP EERDERE SCRIPTS EN VIDEO'S:\n${input.feedback.slice(0, 4000)}` : "",
    input.videoText ? input.videoText.slice(0, 4000) : "",
    `ECHTE SHORTCLIPS-SCRIPTS VAN DEZE KLANT (nieuwste eerst):`,
    ...input.docs.map((d) => `===== ${d.name}${d.modifiedAt ? ` (${d.modifiedAt})` : ""} =====\n${d.text}`),
    "",
    "Leg het stijlprofiel vast. onderwerpen = korte titels van alle video's die in deze scripts al behandeld zijn.",
  ].filter(Boolean).join("\n\n"));
  const res = await runStructured<Record<string, unknown>>({
    system: STYLE_SYSTEM,
    user,
    model: input.model ?? aiModelStrong(),
    maxTokens: 8000,
    schema: STYLE_SCHEMA,
    effort: "low",
  });
  if (!res.ok) return { ok: false, error: res.error ?? res.reason };
  return { ok: true, profile: normalizeStyle(res.data) };
}

