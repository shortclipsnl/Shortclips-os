"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, clients, productionDays, scriptReviews } from "@/db/schema";
import { assertClientAccess, isOwner, requireInternal, requirePermission } from "@/server/auth/context";
import { setScriptingStatus } from "@/server/actions/scripting";
import {
  DEFAULT_TEMPLATES,
  METHODES,
  isValidUrl,
  normaliseTemplates,
  renderTemplate,
  reviewIdFromLink,
  statusNaKopieren,
  validateTemplate,
  type ScriptberichtMethode,
  type Templates,
} from "@/lib/scriptbericht";
import {
  DAY_CATEGORY,
  TEMPLATES_KEY,
  dayKey,
  getAllSavedScriptberichten,
  getSavedScriptbericht,
  getScriptberichtTemplates,
} from "@/server/scriptbericht";

export type ScriptberichtResult = { ok: boolean; message?: string };
export type SaveScriptberichtResult = ScriptberichtResult & {
  /** Nieuwe scriptingstatus als die door het kopiëren is aangepast. */
  statusChangedTo?: string;
  statusMessage?: string;
};

/**
 * Persoonlijk bericht en/of link van één opname opslaan. Raakt nooit het
 * centrale template. De tekst wordt alleen bewaard als die echt afwijkt van de
 * standaardtekst met dezelfde link; anders valt de persoonlijke versie weg.
 */
export async function saveScriptbericht(input: {
  productionDayId: string;
  methode: ScriptberichtMethode;
  link: string;
  /** Weglaten = alleen de link opslaan. */
  text?: string;
  copied?: boolean;
}): Promise<SaveScriptberichtResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    if (!METHODES.includes(input.methode)) return { ok: false, message: "Onbekende berichtvorm." };
    const link = (input.link ?? "").trim().slice(0, 1000);
    if (link && !isValidUrl(link)) return { ok: false, message: "Ongeldige link." };

    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, status: productionDays.scriptingStatus })
      .from(productionDays)
      .where(eq(productionDays.id, input.productionDayId))
      .limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    // Vangnet op de server: een link die al bij een andere klant hoort wordt
    // nooit bij deze opname opgeslagen.
    if (link) {
      const clash = await findForeignClient(link, day.clientId);
      if (clash) return { ok: false, message: `Deze link hoort bij ${clash}, niet bij deze klant.` };
    }

    const current = await getSavedScriptbericht(day.id);
    const next = { ...current, links: { ...current.links }, texts: { ...current.texts } };
    next.methode = input.methode;
    if (link) next.links[input.methode] = link;
    else delete next.links[input.methode];

    if (typeof input.text === "string") {
      const { templates } = await getScriptberichtTemplates();
      const standaard = renderTemplate(templates[input.methode], input.methode, link);
      const text = input.text.slice(0, 6000);
      if (text.trim() && text !== standaard) next.texts[input.methode] = text;
      else delete next.texts[input.methode];
    }
    next.updatedByName = viewer.fullName ?? null;
    next.updatedAt = new Date().toISOString();
    if (input.copied) next.copiedAt = next.updatedAt;

    await db
      .insert(appSettings)
      .values({ key: dayKey(day.id), value: next, category: DAY_CATEGORY, description: "Scriptbericht (WhatsApp) per opname: persoonlijke tekst en link.", updatedById: viewer.id })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedById: viewer.id, updatedAt: new Date() } });

    // Bericht gekopieerd = scripts gaan naar de klant: status automatisch op
    // "Controle bij klant". Via de bestaande statusactie, zodat taken en
    // meldingen (bijv. Controle Jarno) precies meelopen als bij een klik.
    if (input.copied) {
      const nieuw = statusNaKopieren(day.status);
      if (nieuw) {
        const res = await setScriptingStatus(day.id, nieuw).catch(() => ({ ok: false, message: undefined as string | undefined }));
        if (res.ok) return { ok: true, statusChangedTo: nieuw };
        return { ok: true, statusMessage: "Bericht gekopieerd, maar de status kon niet automatisch worden aangepast. Zet hem zelf op Controle bij klant." };
      }
    }
    return { ok: true };
  } catch (error) {
    console.error("[scriptbericht] opslaan mislukt", error);
    return { ok: false, message: "Opslaan mislukt." };
  }
}

/** Persoonlijke versie van één opname weggooien (terug naar de standaardtekst). */
export async function resetScriptberichtText(productionDayId: string, methode: ScriptberichtMethode): Promise<ScriptberichtResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const [day] = await db.select({ clientId: productionDays.clientId }).from(productionDays).where(eq(productionDays.id, productionDayId)).limit(1);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);
    const current = await getSavedScriptbericht(productionDayId);
    if (!current.texts[methode]) return { ok: true };
    const next = { ...current, texts: { ...current.texts } };
    delete next.texts[methode];
    await db.update(appSettings).set({ value: next, updatedById: viewer.id, updatedAt: new Date() }).where(eq(appSettings.key, dayKey(productionDayId)));
    return { ok: true };
  } catch (error) {
    console.error("[scriptbericht] herstellen mislukt", error);
    return { ok: false, message: "Herstellen mislukt." };
  }
}

/** Centrale standaardteksten opslaan (alleen Jarno). */
export async function saveScriptberichtTemplates(input: Templates): Promise<ScriptberichtResult & { templates?: Templates }> {
  try {
    const viewer = await requireInternal();
    if (!isOwner(viewer)) return { ok: false, message: "Alleen Jarno kan de standaardteksten aanpassen." };
    for (const m of METHODES) {
      const err = validateTemplate(input[m] ?? "");
      if (err) return { ok: false, message: `${m === "adobe" ? "Adobe Acrobat" : "Shortclips Portaal"}: ${err}` };
    }
    const value: Templates = { adobe: input.adobe.trim(), portal: input.portal.trim() };
    await db
      .insert(appSettings)
      .values({ key: TEMPLATES_KEY, value, category: "scripting", description: "Standaardteksten WhatsAppbericht bij scripts (Adobe Acrobat en Shortclips Portaal).", updatedById: viewer.id })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedById: viewer.id, updatedAt: new Date() } });
    revalidatePath("/scripting");
    return { ok: true, templates: normaliseTemplates(value) };
  } catch (error) {
    console.error("[scriptbericht] templates opslaan mislukt", error);
    return { ok: false, message: "Opslaan mislukt." };
  }
}

/** Centrale standaardteksten terugzetten naar de Shortclips-standaard (alleen Jarno). */
export async function resetScriptberichtTemplates(): Promise<ScriptberichtResult & { templates?: Templates }> {
  try {
    const viewer = await requireInternal();
    if (!isOwner(viewer)) return { ok: false, message: "Alleen Jarno kan de standaardteksten aanpassen." };
    await db.delete(appSettings).where(eq(appSettings.key, TEMPLATES_KEY));
    revalidatePath("/scripting");
    return { ok: true, templates: DEFAULT_TEMPLATES };
  } catch (error) {
    console.error("[scriptbericht] templates herstellen mislukt", error);
    return { ok: false, message: "Herstellen mislukt." };
  }
}

/** Naam van een andere klant waar deze link al bij hoort, of null. */
async function findForeignClient(link: string, clientId: string): Promise<string | null> {
  const norm = link.trim().replace(/\/+$/, "").toLowerCase();
  const reviewId = reviewIdFromLink(link);

  if (reviewId) {
    const [rev] = await db
      .select({ clientId: scriptReviews.clientId, clientName: clients.name })
      .from(scriptReviews)
      .leftJoin(clients, eq(clients.id, scriptReviews.clientId))
      .where(eq(scriptReviews.id, reviewId))
      .limit(1)
      .catch(() => []);
    if (rev && rev.clientId !== clientId) return rev.clientName ?? "een andere klant";
  }

  const saved = await getAllSavedScriptberichten();
  const dayIds = [...saved.entries()]
    .filter(([, s]) => Object.values(s.links).some((l) => l && l.trim().replace(/\/+$/, "").toLowerCase() === norm))
    .map(([id]) => id);
  if (dayIds.length === 0) return null;
  const owners = await db
    .select({ clientId: productionDays.clientId, clientName: clients.name })
    .from(productionDays)
    .leftJoin(clients, eq(clients.id, productionDays.clientId))
    .where(inArray(productionDays.id, dayIds));
  const other = owners.find((o) => o.clientId !== clientId);
  return other ? other.clientName ?? "een andere klant" : null;
}
