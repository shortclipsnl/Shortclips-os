import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * Centrale koppeling met het taalmodel (Claude) voor de AI Tools.
 *
 * Bewust env-gated: zonder ANTHROPIC_API_KEY blijft alles slapend en geeft de
 * functie netjes `{ ok: false, reason: "no_provider" }` terug — de schermen en
 * het opslaan van klantprofielen/kennisbank werken dan gewoon, er wordt alleen
 * niets gegenereerd. Zo kan de rest van het platform draaien zonder sleutel en
 * gaat generatie live zodra de sleutel is gezet.
 *
 * Privacy: er wordt niets naar een extern model gestuurd om te trainen. De
 * Claude-API gebruikt API-invoer niet voor training.
 */

export type AiDoc = { base64: string; mediaType: "application/pdf" };
export type AiImage = { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

export type AiRunInput = {
  system: string;
  /** De hoofdinstructie / het bericht van de gebruiker. */
  user: string;
  /** PDF-documenten (bijv. scripts) die het model moet meelezen. */
  documents?: AiDoc[];
  /** Afbeeldingen (bijv. screenshots van WhatsApp/e-mail). */
  images?: AiImage[];
  maxTokens?: number;
};

export type AiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: "no_provider" | "error"; error?: string };

export function aiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  // Standaard Sonnet: kostenefficiënt en ruim voldoende voor de AI-analyses
  // (o.a. Video Intelligence). Via AI_MODEL is per omgeving een ander model te
  // kiezen, bijvoorbeeld een krachtiger model voor specifiek werk.
  return env.AI_MODEL || "claude-sonnet-5-5";
}

export async function runPrompt(input: AiRunInput): Promise<AiResult> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: "no_provider" };

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const model = aiModel();

    // Volgorde van content-blokken: documenten en afbeeldingen vóór de tekst.
    const content: Anthropic.ContentBlockParam[] = [];
    for (const doc of input.documents ?? []) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: doc.mediaType, data: doc.base64 },
      });
    }
    for (const img of input.images ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }
    content.push({ type: "text", text: input.user });

    const response = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? 16000,
      system: input.system,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "error", error: "Het model weigerde dit verzoek." };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { ok: true, text, model };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: "error", error: `${error.status ?? ""} ${error.message}`.trim() };
    }
    return { ok: false, reason: "error", error: String(error) };
  }
}

/**
 * Zoals runPrompt, maar verwacht JSON terug en parseert dat. Het model wordt
 * geïnstrueerd uitsluitend geldige JSON te geven; we halen defensief het eerste
 * JSON-blok eruit voor het geval er omliggende tekst is.
 */
export async function runJsonPrompt<T>(input: AiRunInput): Promise<
  { ok: true; data: T; model: string } | { ok: false; reason: "no_provider" | "error"; error?: string }
> {
  const res = await runPrompt(input);
  if (!res.ok) return res;
  const parsed = extractJson<T>(res.text);
  if (parsed === null) return { ok: false, reason: "error", error: "Kon het AI-antwoord niet lezen (geen geldige JSON)." };
  return { ok: true, data: parsed, model: res.model };
}

/**
 * Onderzoeksmodus: laat Claude zelf het web doorzoeken en pagina's ophalen
 * (web search + web fetch, server-side bij Anthropic). Zo is de analyse
 * gebaseerd op actuele, controleerbare bronnen in plaats van verzonnen tekst.
 * Handelt pause_turn af (lang lopend onderzoek) tot het model klaar is.
 */
export async function runResearch(input: {
  system: string;
  user: string;
  maxUses?: number;
  maxTokens?: number;
}): Promise<AiResult> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: "no_provider" };

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const model = aiModel();
    const maxUses = input.maxUses ?? 12;

    const tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: maxUses },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxUses },
    ];

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: input.user }];
    let guard = 0;
    let last: Anthropic.Message | null = null;

    // Lus voor pause_turn: het model kan tussendoor pauzeren bij lang onderzoek.
    while (guard++ < 10) {
      const body = {
        model,
        max_tokens: input.maxTokens ?? 16000,
        system: input.system,
        messages,
        tools,
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;

      const response = await client.messages.create(body);
      last = response;
      if (response.stop_reason === "refusal") {
        return { ok: false, reason: "error", error: "Het model weigerde dit verzoek." };
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      break;
    }

    const text = (last?.content ?? [])
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { ok: true, text, model };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: "error", error: `${error.status ?? ""} ${error.message}`.trim() };
    }
    return { ok: false, reason: "error", error: String(error) };
  }
}

export async function runJsonResearch<T>(input: {
  system: string;
  user: string;
  maxUses?: number;
  maxTokens?: number;
}): Promise<{ ok: true; data: T; model: string } | { ok: false; reason: "no_provider" | "error"; error?: string }> {
  const res = await runResearch(input);
  if (!res.ok) return res;
  const parsed = extractJson<T>(res.text);
  if (parsed === null) return { ok: false, reason: "error", error: "Kon het onderzoeksresultaat niet lezen (geen geldige JSON)." };
  return { ok: true, data: parsed, model: res.model };
}

function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Val terug op het eerste { … } of [ … ] blok.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
