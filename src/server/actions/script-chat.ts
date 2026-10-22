"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission, assertClientAccess, ForbiddenError } from "@/server/auth/context";
import { aiConfigured, runChat, type ChatMessage } from "@/server/ai/client";
import { scriptGeneratorSystem } from "@/server/scripts/scripthandboek";
import { getClientAiProfile, captionProfileToText, clientLearnedText, type CaptionProfile } from "@/server/ai/knowledge";
import { gatherFeedbackContext } from "@/server/script-control";
import { getClientWinningPatterns } from "@/server/scripts/winning-patterns";

type Result = { ok: true; reply: string } | { ok: false; message: string };

const MAX_MESSAGES = 40;

/** Eén beurt in de Scriptgenerator-chat. De client stuurt de volledige
 *  gespreksgeschiedenis mee; wij voegen de vaste instructie + het handboek + (bij
 *  een gekozen klant) de live klantcontext toe en vragen het model om de volgende
 *  reactie. */
export async function scriptChat(input: { messages: ChatMessage[]; clientId?: string }): Promise<Result> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!aiConfigured()) return { ok: false, message: "De AI-schrijver staat uit (ANTHROPIC_API_KEY ontbreekt)." };

    const messages = (input.messages ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
      .slice(-MAX_MESSAGES);
    if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") {
      return { ok: false, message: "Stuur een bericht." };
    }

    // Optioneel: live klantcontext + wat echt werkte (winnende hooks) meegeven.
    let extra = "";
    if (input.clientId) {
      const [c] = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
        .limit(1);
      if (c) {
        assertClientAccess(viewer, c.id);
        const [profile, learned, feedback, patterns] = await Promise.all([
          getClientAiProfile(c.id),
          clientLearnedText(c.id),
          gatherFeedbackContext(c.id),
          getClientWinningPatterns(viewer, c.id).catch(() => null),
        ]);
        extra = [
          `Klant: ${c.name}.`,
          profile ? captionProfileToText(profile.captionProfile as CaptionProfile) : "",
          feedback.afspraken ? `Communicatie-afspraken: ${feedback.afspraken}` : "",
          feedback.aandachtspunten ? `Aandachtspunten: ${feedback.aandachtspunten}` : "",
          feedback.recenteKlantopmerkingen.length ? `Recente klantopmerkingen op eerdere video's:\n- ${feedback.recenteKlantopmerkingen.join("\n- ")}` : "",
          learned ? `Geleerde voorkeuren en correcties van deze klant:\n${learned}` : "",
          patterns && patterns.count > 0 ? `Best presterende hooks van deze klant (echte cijfers — spiegelen, niet kopiëren):\n${patterns.top.map((p) => `- "${p.hook}" (${p.views} views)`).join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
      }
    }

    const res = await runChat({ system: scriptGeneratorSystem(extra || undefined), messages, maxTokens: 4000 });
    if (!res.ok) return { ok: false, message: "De schrijver gaf geen antwoord. Probeer het nog eens." };
    return { ok: true, reply: res.text };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}
