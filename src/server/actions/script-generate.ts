"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { scriptGeneratorSystem } from "@/server/scripts/scripthandboek";
import { getClientAiProfile, captionProfileToText, clientLearnedText, type CaptionProfile } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";

export type GeneratedScript = { onderwerp: string; tekst: string };
type Result =
  | { ok: true; scripts: GeneratedScript[]; klantnaam: string }
  | { ok: false; message: string };

const MAX_SCRIPTS = 8;

type ScriptsPayload = { scripts?: Array<{ onderwerp?: unknown; regels?: unknown; tekst?: unknown }> };

/** Leest het JSON-antwoord van het model, ook als er ```-fences of wat tekst omheen staan. */
function parseScriptsJson(raw: string): ScriptsPayload | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const tryParse = (s: string): ScriptsPayload | null => {
    try { return JSON.parse(s) as ScriptsPayload; } catch { return null; }
  };
  return (
    tryParse(cleaned) ??
    (() => {
      // Val terug op het eerste { … } blok (grootste match).
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1));
      return null;
    })()
  );
}

/** Verzamelt de live klantcontext (stijl, afspraken, geleerde voorkeuren, winnende hooks). */
async function clientContext(viewer: Awaited<ReturnType<typeof requirePermission>>, clientId: string): Promise<{ name: string; extra: string } | null> {
  const [c] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!c) return null;
  assertClientAccess(viewer, c.id);
  const [profile, learned, feedback, patterns] = await Promise.all([
    getClientAiProfile(c.id),
    clientLearnedText(c.id),
    gatherFeedbackContext(c.id),
    getClientWinningPatterns(viewer, c.id).catch(() => null),
  ]);
  const extra = [
    `Klant: ${c.name}.`,
    profile ? captionProfileToText(profile.captionProfile as CaptionProfile) : "",
    feedback.afspraken ? `Communicatie-afspraken: ${feedback.afspraken}` : "",
    feedback.aandachtspunten ? `Aandachtspunten: ${feedback.aandachtspunten}` : "",
    feedback.recenteKlantopmerkingen.length ? `Recente klantopmerkingen op eerdere video's:\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}` : "",
    learned ? `Geleerde voorkeuren en correcties van deze klant:\n${learned}` : "",
    patterns && patterns.count > 0 ? `Best presterende hooks van deze klant (echte cijfers — spiegelen, niet kopiëren):\n${patterns.top.map((p) => `- "${p.hook}" (${p.views} views)`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return { name: c.name, extra };
}

/**
 * Schrijft in één keer `count` complete organische short video scripts, zonder
 * tussenvragen. De stijl + het handboek komen uit scriptGeneratorSystem; de
 * klantcontext (indien gekozen) wordt meegeladen. Het model werkt uit eerdere
 * data en het handboek — nooit een website nodig.
 */
export async function generateScripts(input: {
  clientId?: string;
  clientName?: string;
  count: number;
  brief?: string;
}): Promise<Result> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const count = Math.max(1, Math.min(MAX_SCRIPTS, Math.round(input.count || 1)));

    let extra = "";
    let klantnaam = (input.clientName ?? "").trim();
    if (input.clientId) {
      const ctx = await clientContext(viewer, input.clientId);
      if (ctx) { extra = ctx.extra; klantnaam = ctx.name; }
    }

    const brief = (input.brief ?? "").trim().slice(0, 4000);

    const user = [
      `BATCHMODUS. Schrijf nu direct ${count} complete organische short video scripts${klantnaam ? ` voor klant "${klantnaam}"` : ""}.`,
      "Stel GEEN vragen en wacht nergens op. Werk volledig volgens het Shortclips Scripthandboek en de meegeleverde klantcontext.",
      klantnaam
        ? "Gebruik alles wat je over deze klant weet uit de meegeleverde context en eerdere data. Een website heb je niet nodig."
        : "Er is geen vaste klant gekozen. Kies een logisch, concreet onderwerp per script dat past bij het handboek.",
      "Mis je een hard cijfer? Gebruik een realistische range en noem het een gemiddelde. Verzin nooit exacte cijfers, namen of modellen.",
      brief ? `Input van de gebruiker (onderwerpen, hooks of extra wensen — gebruik dit leidend):\n${brief}` : "",
      "",
      "Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder tekst eromheen:",
      `{"scripts":[{"onderwerp":"<korte videotitel zonder nummer>","regels":["<regel 1>","<regel 2>","..."]}]}`,
      "",
      "Regels voor elk veld:",
      "- onderwerp: alleen de titel van de video, zonder nummer ervoor.",
      "- regels: een array met het volledige script, één tekstregel per array-element. Zet NOOIT een regeleinde binnen een element — elke nieuwe regel is een nieuw element. Gebruik een leeg element (\"\") voor een witregel tussen de blokken.",
      "- Begin met de kop SHORTCLIP UITLEG, daarna HOOK, MIDDENSTUK, CALL TO ACTION, SOCIAL MEDIA POLL KEUZES. Laat de VIDEOTITEL-kop weg (die staat al bovenaan de pagina).",
      "- Koppen (SHORTCLIP UITLEG, HOOK, enz.) zijn een eigen element en staan volledig in HOOFDLETTERS. Elke zin in het middenstuk is een eigen element. Geen markdown, geen sterretjes, geen codeblokken.",
    ].filter(Boolean).join("\n");

    const res = await runPrompt({
      system: scriptGeneratorSystem(extra || undefined),
      user,
      maxTokens: Math.min(16000, count * 1600 + 2000),
    });

    if (!res.ok) {
      return { ok: false, message: res.reason === "no_provider" ? "De AI-schrijver staat uit." : "De schrijver gaf geen bruikbaar antwoord. Probeer het nog eens." };
    }

    const data = parseScriptsJson(res.text);
    if (!data) {
      console.error("[generateScripts] JSON parse mislukt. Ruwe tekst (eerste 1500):\n", res.text.slice(0, 1500));
      return { ok: false, message: "De schrijver gaf geen bruikbaar antwoord. Probeer het nog eens." };
    }

    const scripts: GeneratedScript[] = (data.scripts ?? [])
      .map((s) => {
        // Voorkeur: regels-array (voorkomt kapotte JSON door regeleindes). Val
        // terug op een los tekstveld als het model dat toch meestuurt.
        const tekst = Array.isArray(s?.regels)
          ? s.regels.map((r) => (typeof r === "string" ? r : "")).join("\n").trim()
          : typeof s?.tekst === "string"
            ? s.tekst.trim()
            : "";
        return {
          onderwerp: typeof s?.onderwerp === "string" ? s.onderwerp.trim() : "",
          tekst,
        };
      })
      .filter((s) => s.onderwerp || s.tekst)
      .slice(0, count);

    if (scripts.length === 0) return { ok: false, message: "De schrijver leverde geen scripts op. Probeer het nog eens." };

    return { ok: true, scripts, klantnaam };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
