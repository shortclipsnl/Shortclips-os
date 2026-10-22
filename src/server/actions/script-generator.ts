"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients, productionDays, scriptVersions, scripts } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import {
  getClientAiProfile,
  captionProfileToText,
  centralKnowledgeText,
  clientLearnedText,
  type CaptionProfile,
} from "@/server/ai/knowledge";
import { getScriptVideoInsights } from "@/server/video-intelligence/script-insights";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";
import { gatherFeedbackContext } from "@/server/script-control";
import { lintScript, lintIssuesText, type ScriptPlatform } from "@/server/scripts/lint";

export type GenerateInput = {
  productionDayId: string;
  onderwerp: string;
  platform?: ScriptPlatform;
  doel?: "awareness" | "leads" | "verkoop";
};

export type GenerateResult =
  | { ok: true; scriptId: string; score: number; weakestAxis: string; title: string; gateHaald: boolean }
  | { ok: false; message: string };

const GATE = 8.0;
const PLATFORMS: ScriptPlatform[] = ["tiktok", "reels", "shorts", "youtube", "linkedin"];

/** Gewichten van de rubric (samen 100). De eindscore rekenen we zelf uit, zodat
 *  het model de gate niet kan "rondpraten". */
const WEIGHTS = { hook: 25, retention: 20, psychologie: 15, spreektaal: 15, originaliteit: 10, conversie: 10, platformfit: 5 } as const;
type AxisKey = keyof typeof WEIGHTS;

type Generated = {
  title: string;
  blurb?: string;
  hookType?: string;
  format?: string;
  captionHook?: string;
  hook: string;
  captionBody?: string;
  body: string;
  captionCta?: string;
  cta: string;
  factsToVerify?: string[];
};

type Judge = {
  assen?: Partial<Record<AxisKey, number>>;
  zwakste_as?: string;
  verbeteringen?: string[];
};

const GENERATE_SYSTEM = `Je bent de beste scriptschrijver van ShortClips, een bureau voor organische short video's (TikTok/Reels/Shorts). Je schrijft opnameklare scripts op founder-niveau: scripts die de scroll stoppen en tot het einde blijven boeien, in de stem van de klant.

Vaste structuur: Hook, Middenstuk, Call to Action. Bij elk onderdeel hoort een korte caption (ondertitel op beeld) plus de gesproken tekst.

Harde regels:
- Hook: maximaal ~14 woorden, stopt binnen 1-2 seconden de scroll.
- Spreektaal, tweede persoon, concreet. Klinkt als een mens die praat, niet als geschreven of AI-tekst.
- Ritme boven alles: wissel korte en lange zinnen af. Lees hardop; struikel je, herschrijf.
- Eén helder psychologisch mechanisme (nieuwsgierigheidskloof, verlies, status, sociale bewijskracht).
- Natuurlijke CTA die past bij het doel. Geen verkoperszin.
- Verzin NOOIT cijfers, prijzen, specificaties of claims. Zet onzekere feitelijke claims in "factsToVerify".
- Verboden (AI-taal): naadloos, moeiteloos, duik in, in een wereld waarin, laten we eerlijk zijn, stel je eens voor, kortom, al met al, tot slot, de kracht van, revolutionair, baanbrekend, en de structuur "niet alleen … maar ook".
- Blijf binnen de woordenbandbreedte van het platform (gesproken tekst). Captions tellen niet mee.

Geef UITSLUITEND geldige JSON terug.`;

const JUDGE_SYSTEM = `Je bent een onafhankelijke script-judge van ShortClips met een verse, strenge blik. Je beoordeelt één script als KIJKER: zou jij na de eerste zin blijven kijken, en tot het einde? Je hebt het script niet geschreven en beschermt de smaak van de founder. Wees streng: 8 = goed, 9 = uitzonderlijk, 10 = zeldzaam. Rond nooit naar boven af. Geef UITSLUITEND geldige JSON terug.`;

function scoreOf(j: Judge): { eindscore: number; weakest: AxisKey } {
  const a = j.assen ?? {};
  let total = 0;
  let weakest: AxisKey = "hook";
  let weakestVal = Infinity;
  for (const key of Object.keys(WEIGHTS) as AxisKey[]) {
    const raw = Number(a[key]);
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0;
    total += v * WEIGHTS[key];
    if (v < weakestVal) { weakestVal = v; weakest = key; }
  }
  return { eindscore: Math.round((total / 100) * 100) / 100, weakest };
}

async function judge(platform: string, g: Generated): Promise<{ score: number; weakest: AxisKey; raw: Judge } | null> {
  // Twee pogingen: de judge kan incidenteel niets/onleesbaars teruggeven. Een
  // mislukte judge mag NOOIT als 0.0 gelden — dan geven we null terug (= niet
  // beoordeeld) en de generator noteert dat eerlijk.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runJsonPrompt<Judge>({
      system: JUDGE_SYSTEM,
      user: `Platform: ${platform}.\n\nSCRIPT\nHook: ${g.hook}\nMiddenstuk: ${g.body}\nCTA: ${g.cta}\n\nScoor elke as 0-10 en benoem de zwakste as + per as één concrete verbetering. Geef JSON:\n{\n "assen": { "hook": 0, "retention": 0, "psychologie": 0, "spreektaal": 0, "originaliteit": 0, "conversie": 0, "platformfit": 0 },\n "zwakste_as": "",\n "verbeteringen": ["concrete ingreep 1", "..."]\n}`,
      maxTokens: 1200,
    });
    if (res.ok && res.data?.assen && Object.keys(res.data.assen).length > 0) {
      const { eindscore, weakest } = scoreOf(res.data);
      return { score: eindscore, weakest, raw: res.data };
    }
  }
  return null;
}

export async function generateScript(input: GenerateInput): Promise<GenerateResult> {
  try {
    const viewer = await requirePermission("scripts:generate");
    const onderwerp = input.onderwerp?.trim();
    if (!onderwerp) return { ok: false, message: "Geef een onderwerp op." };
    const platform: ScriptPlatform = PLATFORMS.includes(input.platform as ScriptPlatform) ? (input.platform as ScriptPlatform) : "reels";
    const doel = input.doel ?? "awareness";

    const [pd] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, clientName: clients.name, clientSlug: clients.slug })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(eq(productionDays.id, input.productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!pd) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, pd.clientId);
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit: ANTHROPIC_API_KEY ontbreekt." };

    // --- Context verzamelen (parallel) ---
    const [profile, learned, central, feedback, insights, patterns] = await Promise.all([
      getClientAiProfile(pd.clientId),
      clientLearnedText(pd.clientId),
      centralKnowledgeText(["schrijfstijl", "branding", "kwaliteit", "communicatie"]),
      gatherFeedbackContext(pd.clientId),
      getScriptVideoInsights(viewer, pd.clientId, pd.clientSlug).catch(() => null),
      getClientWinningPatterns(viewer, pd.clientId).catch(() => null),
    ]);

    // Wat werkte ECHT (uit de cijfers): de best presterende hooks als spiegel.
    let winners = "";
    if (patterns && patterns.count > 0) {
      winners = [
        `Best presterende content van deze klant (echte cijfers — spiegel wat werkt, kopieer niet):`,
        patterns.avgViews != null ? `- Gemiddeld ~${patterns.avgViews} views per video.` : "",
        ...patterns.top.map((p) => `- "${p.hook}" (${p.platform}, ${p.views} views${p.completionRate != null ? `, ${Math.round(p.completionRate * 100)}% kijktijd` : ""})`),
      ].filter(Boolean).join("\n");
    }

    let watWerkt = "";
    if (insights && insights.total > 0) {
      const hooks = insights.dominantHooks.map((h) => `${h.key} (${h.n}x)`).join(", ");
      const samples = insights.videos.map((v) => v.hookText).filter((h): h is string => Boolean(h && h.trim())).slice(0, 3);
      watWerkt = [
        `Op basis van ${insights.total} geanalyseerde video's van deze klant (geen causaal verband, wel een signaal):`,
        hooks ? `- Meest voorkomende hooktypes: ${hooks}.` : "",
        insights.avgWpm ? `- Gemiddeld spreektempo: ${insights.avgWpm} wpm — schrijf ongeveer op dit tempo.` : "",
        insights.avgWords3s ? `- Gemiddeld ${insights.avgWords3s} woorden in de eerste 3 seconden.` : "",
        samples.length ? `- Eerdere hooks (spiegel het niveau, kopieer niet):\n${samples.map((s) => `  • ${s}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");
    }

    const context = [
      `Klant: ${pd.clientName}.`,
      profile ? captionProfileToText(profile.captionProfile as CaptionProfile) : "(nog geen klantprofiel — gebruik een nuchtere, professionele ShortClips-stijl.)",
      feedback.afspraken ? `Communicatie-afspraken met de klant:\n${feedback.afspraken}` : "",
      feedback.aandachtspunten ? `Editing-/inhoud-aandachtspunten:\n${feedback.aandachtspunten}` : "",
      feedback.recenteKlantopmerkingen.length ? `Recente klant-opmerkingen op eerdere video's:\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}` : "",
      learned ? `Geleerde voorkeuren en terugkerende correcties van deze klant:\n${learned}` : "",
      central ? `Centrale ShortClips-richtlijnen:\n${central}` : "",
      winners,
      watWerkt,
    ].filter(Boolean).join("\n\n");

    const jsonShape = `{\n "title": "pakkende titel",\n "blurb": "één regel context voor het team (niet gesproken)",\n "hookType": "cijfer|vraag|contrair|verhaal",\n "format": "PAS|listicle|transformatie|mythe-buster|demonstratie|reactie",\n "captionHook": "korte ondertitel",\n "hook": "gesproken openingszin (max ~14 woorden)",\n "captionBody": "korte ondertitel",\n "body": "gesproken middenstuk",\n "captionCta": "korte ondertitel",\n "cta": "gesproken call to action",\n "factsToVerify": ["elke onzekere feitelijke claim die het team moet checken"]\n}`;

    const baseUser = `Schrijf één opnameklaar ShortClips-script.\nOnderwerp: ${onderwerp}\nPlatform: ${platform}\nDoel: ${doel}\n\nKLANTCONTEXT\n${context}\n\nGeef JSON in exact deze vorm:\n${jsonShape}`;

    // --- 1) Genereren ---
    const first = await runJsonPrompt<Generated>({ system: GENERATE_SYSTEM, user: baseUser, maxTokens: 2500 });
    if (!first.ok) return { ok: false, message: "De AI-schrijver gaf geen bruikbaar script terug. Probeer het nog eens." };
    let current = first.data;

    // --- 2) Lint-herstel (max 1 ronde) ---
    let lint = lintScript(platform, current);
    if (!lint.ok) {
      const fix = await runJsonPrompt<Generated>({
        system: GENERATE_SYSTEM,
        user: `${baseUser}\n\nJe vorige versie had deze harde problemen — los ze op en behoud concept + tone:\n${lintIssuesText(lint)}\n\nVorige versie:\nHook: ${current.hook}\nMiddenstuk: ${current.body}\nCTA: ${current.cta}`,
        maxTokens: 2500,
      });
      if (fix.ok) { current = fix.data; lint = lintScript(platform, current); }
    }

    // --- 3) Judge + gerichte revisie (max 2 rondes) ---
    let best = current;
    let bestJudge = await judge(platform, current);
    for (let round = 0; round < 2 && bestJudge && bestJudge.score < GATE; round++) {
      const verbeter = (bestJudge.raw.verbeteringen ?? []).slice(0, 3).map((v) => `- ${v}`).join("\n");
      const rev = await runJsonPrompt<Generated>({
        system: GENERATE_SYSTEM,
        user: `${baseUser}\n\nEen onafhankelijke judge gaf dit script een ${bestJudge.score.toFixed(1)}/10. Zwakste as: ${bestJudge.weakest}. Herschrijf gericht op die as, behoud wat werkt. Concrete verbeteringen:\n${verbeter || "- Maak de hook scherper en het ritme levendiger."}\n\nHuidige versie:\nHook: ${best.hook}\nMiddenstuk: ${best.body}\nCTA: ${best.cta}`,
        maxTokens: 2500,
      });
      if (!rev.ok) break;
      const revLint = lintScript(platform, rev.data);
      const revJudge = await judge(platform, rev.data);
      // Alleen overnemen als het echt beter is én de lint niet verslechtert naar hard-fail.
      if (revJudge && revLint.ok && revJudge.score > bestJudge.score) {
        best = rev.data;
        bestJudge = revJudge;
        lint = revLint;
      } else if (revJudge && bestJudge && !lint.ok && revLint.ok) {
        best = rev.data;
        bestJudge = revJudge;
        lint = revLint;
      }
    }

    const score: number | null = bestJudge?.score ?? null;
    const weakest = bestJudge?.weakest ?? "hook";
    const gateHaald = score != null && score >= GATE && lint.ok;
    const scoreText = score != null ? `${score.toFixed(1)}/10` : "niet beoordeeld";

    // --- 4) Opslaan als script + versie 1 ---
    const title = (best.title || onderwerp).slice(0, 240);
    const captionsNote = [
      best.blurb ? `Context: ${best.blurb}` : "",
      "Captions (ondertitels op beeld):",
      best.captionHook ? `• Hook: ${best.captionHook}` : "",
      best.captionBody ? `• Midden: ${best.captionBody}` : "",
      best.captionCta ? `• CTA: ${best.captionCta}` : "",
      best.factsToVerify && best.factsToVerify.length ? `\nHandmatig controleren (niet verzinnen):\n${best.factsToVerify.map((f) => `• ${f}`).join("\n")}` : "",
      `\nAutomatisch gegenereerd • platform ${platform} • doel ${doel} • judge ${scoreText}${score != null ? ` (gate ${GATE}${gateHaald ? ", gehaald" : ", nog niet gehaald — zwakste as: " + weakest})` : " — automatische beoordeling niet gelukt, controleer handmatig"}`,
    ].filter(Boolean).join("\n");

    const [created] = await db
      .insert(scripts)
      .values({
        clientId: pd.clientId,
        productionDayId: pd.id,
        title,
        status: "concept",
        format: best.format ? best.format.slice(0, 120) : null,
        hook: best.hook ?? null,
        body: best.body ?? null,
        cta: best.cta ?? null,
        internalNotes: captionsNote,
        creatorId: viewer.id,
        currentVersion: 1,
      })
      .returning({ id: scripts.id });
    const scriptId = created!.id;

    await db.insert(scriptVersions).values({
      scriptId,
      versionNumber: 1,
      snapshot: { title, hook: best.hook ?? null, body: best.body ?? null, cta: best.cta ?? null, shotList: null, requirements: null },
      changeSummary: `Automatisch gegenereerd (judge ${scoreText})`,
      status: "concept",
      authorId: viewer.id,
    });

    await db.insert(aiOutputs).values({
      clientId: pd.clientId,
      tool: "scriptgeneratie",
      title,
      inputSummary: scriptId,
      output: { onderwerp, platform, doel, score, weakest, gateHaald, lint, script: best } as unknown as Record<string, unknown>,
      createdById: viewer.id,
    });

    await auditLog({ viewer, action: "script.generated", entityType: "script", entityId: scriptId, clientId: pd.clientId, changes: { score, platform } });
    await recordActivity({
      clientId: pd.clientId,
      type: "script.generated",
      title: `Conceptscript gegenereerd: ${title}`,
      body: `judge ${scoreText}`,
      entityType: "script",
      entityId: scriptId,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath("/scripting");
    revalidatePath(`/scripts/${scriptId}`);
    return { ok: true, scriptId, score: score ?? 0, weakestAxis: weakest, title, gateHaald };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
