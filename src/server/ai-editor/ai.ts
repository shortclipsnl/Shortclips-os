import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { aiModel } from "@/server/ai/client";

/**
 * AI-aanroepen van de AI Editor, met tokenregistratie voor de kosten.
 * Zonder ANTHROPIC_API_KEY doet de editor alles met de vaste logica en wordt
 * hier niets aangeroepen.
 */

export type AiCall = { ok: true; text: string; model: string; inputTokens: number; outputTokens: number } | { ok: false; reason: string };

export function aiAvailable(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export async function callClaude(system: string, user: string, maxTokens = 2500): Promise<AiCall> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: "no_provider" };
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const model = aiModel();
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { ok: true, text, model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

/**
 * Kosten per miljoen tokens in eurocent. Standaard een schatting op basis van
 * de Sonnet-klasse (in $3 / uit $15 per MTok, omgerekend); aanpasbaar via env
 * zodra de werkelijke tarieven bekend zijn.
 */
export function aiCostCents(inputTokens: number, outputTokens: number): number {
  const inRate = Number(process.env.AI_EDITOR_CENTS_PER_MTOK_IN ?? 280);
  const outRate = Number(process.env.AI_EDITOR_CENTS_PER_MTOK_OUT ?? 1400);
  return Math.round(((inputTokens * inRate + outputTokens * outRate) / 1_000_000) * 100) / 100;
}
