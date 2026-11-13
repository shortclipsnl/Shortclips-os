import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients } from "@/db/schema";
import { aiConfigured, aiModelStrong, runPrompt } from "@/server/ai/client";
import { loadToneOfVoice } from "@/server/content-research/sources";
import type { ContentMemory, MemoryVideo } from "./analyze";

/**
 * Drie nieuwe hooks per succesvolle hook.
 *
 * Gemaakt door de AI op basis van de echte hook, de cijfers erachter, de
 * klant (branche, omschrijving, tone of voice) en de andere hooks die goed
 * werkten. Eén keer per hook gemaakt en bewaard in ai_outputs; verandert de
 * succesvolle basis, dan worden alleen de nieuwe hooks aangevuld. Eerder
 * gemaakte alternatieven blijven bewaard (historie gaat niet verloren).
 */

export const HOOKS_TOOL = "contentgeheugen-hooks";
const KEEP = 80;

export type HookAlternative = { angle: string; hook: string };
export type HookAlternatives = {
  hook: string;
  videoId: string;
  /** Het werkzame principe van de originele hook, in één zin. */
  principle: string;
  alternatives: HookAlternative[];
  createdAt: string;
};

/** De succesvolle hooks die op de pagina staan (zelfde selectie overal). */
export function shownHooks(m: ContentMemory, max = 4): MemoryVideo[] {
  return m.topHooks.filter((v) => v.perf >= 1).slice(0, max);
}

export const hookKey = (v: Pick<MemoryVideo, "id" | "hook">) =>
  createHash("sha1").update(`${v.id}|${v.hook.trim().toLowerCase()}`).digest("hex").slice(0, 16);

async function loadRow(clientId: string) {
  const [row] = await db
    .select({ id: aiOutputs.id, output: aiOutputs.output })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, HOOKS_TOOL), isNull(aiOutputs.deletedAt)))
    .orderBy(desc(aiOutputs.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function getHookAlternatives(clientId: string): Promise<Record<string, HookAlternatives>> {
  const row = await loadRow(clientId).catch(() => null);
  const items = (row?.output as { items?: Record<string, HookAlternatives> } | undefined)?.items;
  return items && typeof items === "object" ? items : {};
}

const SYSTEM = `Je bent senior short video copywriter bij Shortclips, een Nederlands bureau voor short video (TikTok, Instagram Reels, YouTube Shorts). Je krijgt bewezen succesvolle hooks (openingszinnen) van één klant, met de cijfers en de klantcontext.

Per hook lever je:
- principle: één korte zin (max 20 woorden) die uitlegt WAAROM deze hook werkt: het werkzame principe (bijv. uitdagen om mee te raden, concrete prijs die verrast, herkenbaar probleem van de doelgroep). Baseer je op de hook en de cijfers; noem het geen bewezen oorzaak.
- alternatives: precies drie NIEUWE hooks die hetzelfde werkzame principe gebruiken, elk vanuit een echt andere invalshoek. Geef per alternatief een korte invalshoek (angle, 1 tot 3 woorden, bijv. "Vraag aan de kijker", "Contrast", "Persoonlijke situatie", "Getal", "Nieuwsgierigheid", "Misvatting").

Regels voor de alternatieven:
- Nederlands, spreektaal, direct uit te spreken door de klant of presentator. Maximaal 15 woorden.
- Passend bij deze klant, het aanbod en de doelgroep. Volg de tone of voice als die gegeven is.
- Geen herhaling van de originele zin met een paar andere woorden. Geen drie varianten met dezelfde opbouw.
- Verzin geen feiten (prijzen, aantallen, namen, locaties, jaartallen). Is een concreet gegeven nodig, zet dan een invulveld tussen blokhaken, bijv. [prijs], [plaats], [model].
- Geen gedachtestreepjes (— of –), geen emoji, geen hashtags, geen aanhalingstekens rond de hook.
- Direct bruikbaar als eerste zin van een nieuw script.

Antwoord ALLEEN met geldige JSON: {"items":[{"key":"<key>","principle":"...","alternatives":[{"angle":"...","hook":"..."},{"angle":"...","hook":"..."},{"angle":"...","hook":"..."}]}]}`;

const clean = (t: unknown) =>
  String(t ?? "")
    .replace(/[—–]/g, ",")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Maakt alternatieven voor de getoonde hooks die er nog geen hebben (of, met
 * force, voor de opgegeven hook opnieuw). Eén AI-aanroep per klant.
 */
export async function generateHookAlternatives(
  clientId: string,
  memory: ContentMemory,
  opts: { forceKeys?: string[] } = {},
): Promise<{ ok: boolean; generated: number; reason?: string }> {
  if (!aiConfigured()) return { ok: false, generated: 0, reason: "Geen AI-sleutel ingesteld" };
  const row = await loadRow(clientId);
  const existing: Record<string, HookAlternatives> = { ...((row?.output as { items?: Record<string, HookAlternatives> } | undefined)?.items ?? {}) };
  const force = new Set(opts.forceKeys ?? []);
  const hooks = shownHooks(memory);
  const todo = hooks.filter((v) => force.has(hookKey(v)) || !existing[hookKey(v)]);
  if (!todo.length) return { ok: true, generated: 0 };

  const [c] = await db
    .select({ name: clients.name, sector: clients.sector, description: clients.description, website: clients.website })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const tone = await loadToneOfVoice(clientId).catch(() => "");
  const others = memory.topHooks.slice(0, 8).map((v) => `- "${v.hook}" (${v.perf.toFixed(1)}x normaal)`).join("\n");
  const ctx = [
    `Klant: ${c?.name ?? "onbekend"}`,
    c?.sector ? `Branche: ${c.sector}` : "",
    c?.description ? `Omschrijving: ${c.description.slice(0, 600)}` : "",
    c?.website ? `Website: ${c.website}` : "",
    tone ? `Tone of voice en doelgroep:\n${tone.slice(0, 1500)}` : "",
    `Andere hooks die bij deze klant goed werkten:\n${others}`,
  ].filter(Boolean).join("\n");
  const list = todo
    .map((v) => {
      const why = [
        `${v.perf.toFixed(1)}x het normale niveau`,
        `${v.views} weergaven op ${v.platform}`,
        v.retention != null ? `${Math.round(v.retention * 100)}% van de video bekeken` : "",
        v.hookTypes.length ? `type: ${v.hookTypes.join(", ")}` : "",
        v.format ? `format: ${v.format}` : "",
      ].filter(Boolean).join("; ");
      return `key=${hookKey(v)} | hook: "${v.hook}" | ${why}`;
    })
    .join("\n");

  const res = await runPrompt({ system: SYSTEM, user: `${ctx}\n\nSuccesvolle hooks:\n${list}`, maxTokens: 3000, cacheSystem: true, model: aiModelStrong() });
  if (!res.ok) return { ok: false, generated: 0, reason: res.error ?? res.reason };
  let parsed: { items?: Array<{ key?: string; principle?: string; alternatives?: Array<{ angle?: string; hook?: string }> }> };
  try {
    parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1));
  } catch {
    return { ok: false, generated: 0, reason: "AI-antwoord was geen geldige JSON" };
  }

  const now = new Date().toISOString();
  let generated = 0;
  for (const it of parsed.items ?? []) {
    const v = todo.find((t) => hookKey(t) === it.key);
    if (!v) continue;
    const alts = (it.alternatives ?? [])
      .map((a) => ({ angle: clean(a.angle).slice(0, 40), hook: clean(a.hook).slice(0, 200) }))
      .filter((a) => a.hook.length >= 8 && a.hook.toLowerCase() !== v.hook.trim().toLowerCase());
    if (alts.length < 3) continue;
    existing[hookKey(v)] = { hook: v.hook, videoId: v.id, principle: clean(it.principle).slice(0, 220), alternatives: alts.slice(0, 3), createdAt: now };
    generated++;
  }
  if (!generated) return { ok: false, generated: 0, reason: "Geen bruikbare alternatieven ontvangen" };

  // Historie bewaren, maar begrensd: oudste eerst eruit.
  const items = Object.fromEntries(Object.entries(existing).sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt)).slice(0, KEEP));
  const output = { items, updatedAt: now, model: res.model };
  if (row) await db.update(aiOutputs).set({ output, updatedAt: new Date() }).where(eq(aiOutputs.id, row.id));
  else await db.insert(aiOutputs).values({ clientId, tool: HOOKS_TOOL, title: "Contentgeheugen: alternatieve hooks", inputSummary: `${generated} hooks`, output });
  return { ok: true, generated };
}
