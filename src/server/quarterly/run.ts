import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientQuarterSettings, clients, quarterlyReportEvents, quarterlyReportVersions, quarterlyReports } from "@/db/schema";
import { nlHolidaySet } from "@/lib/holidays";
import {
  quarterFromKey, quarterOf, quarterTitle, type Quarter, type QuarterMode, type QuarterStatus,
} from "@/lib/kwartaal";
import { normalizeIntern, type QuarterIntern, type QuarterKlant } from "@/lib/kwartaal-inhoud";
import { loadStrategyProfile, strategyToText } from "@/server/reports/strategy";
import { recordActivity } from "@/server/audit";
import { generateQuarterAnalysis, KWARTAAL_ANALYSE_VERSIE } from "./analysis";
import { buildQuarterMetrics, type Doel, type QuarterMetrics } from "./metrics";

const STALE_RUNNING_MIN = 15;

export const amsterdamToday = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

export function holidaysAround(today: string): Set<string> {
  const y = Number(today.slice(0, 4));
  return nlHolidaySet([y - 1, y, y + 1]);
}

/* ------------------------------------------------------------------ *
 * Instellingen per klant
 * ------------------------------------------------------------------ */

export type QuarterSettings = { mode: QuarterMode; enabled: boolean; doelen: Record<string, Doel[]> };

export async function loadQuarterSettings(clientId: string): Promise<QuarterSettings> {
  const [row] = await db.select().from(clientQuarterSettings).where(eq(clientQuarterSettings.clientId, clientId)).limit(1);
  return {
    mode: row?.mode === "contract" ? "contract" : "kalender",
    enabled: row?.enabled ?? true,
    doelen: ((row?.doelen ?? {}) as Record<string, Doel[]>),
  };
}

/** Het kwartaal van een klant op een bepaalde dag, volgens de indeling van die klant. */
export function clientQuarterOn(settings: Pick<QuarterSettings, "mode">, startedOn: string | null, day: string): Quarter {
  return quarterOf(settings.mode, startedOn, day);
}

/* ------------------------------------------------------------------ *
 * Auditgeschiedenis en versies
 * ------------------------------------------------------------------ */

export async function logQuarterEvent(e: {
  reportId: string; clientId: string; type: string; from?: QuarterStatus | string | null; to?: QuarterStatus | string | null;
  byId?: string | null; note?: string | null; meta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(quarterlyReportEvents).values({
    reportId: e.reportId, clientId: e.clientId, type: e.type, fromStatus: e.from ?? null, toStatus: e.to ?? null,
    byId: e.byId ?? null, note: e.note ? e.note.slice(0, 4000) : null, meta: e.meta ?? {},
  });
}

export type VersionContent = {
  title: string; periodKey: string; periodStart: string; periodEnd: string; pakketType: string; voorlopig: boolean;
  metrics: QuarterMetrics; klant: QuarterKlant; intern: QuarterIntern; ontbrekend: string[];
};

/**
 * Legt de huidige inhoud vast als nieuwe, onveranderlijke versie en geeft het
 * versienummer terug. Elke generatie, goedkeuring en publicatie is een versie;
 * een gepubliceerde versie verandert daarna nooit meer.
 */
export async function snapshotQuarterVersion(reportId: string, kind: "generatie" | "goedkeuring" | "publicatie" | "herpublicatie", byId: string | null, note?: string | null): Promise<number> {
  const [r] = await db.select().from(quarterlyReports).where(eq(quarterlyReports.id, reportId)).limit(1);
  if (!r) throw new Error("Rapportage niet gevonden.");
  const [last] = await db.select({ n: quarterlyReportVersions.versionNumber }).from(quarterlyReportVersions)
    .where(eq(quarterlyReportVersions.reportId, reportId)).orderBy(desc(quarterlyReportVersions.versionNumber)).limit(1);
  const versionNumber = (last?.n ?? 0) + 1;
  const content: VersionContent = {
    title: r.title, periodKey: r.periodKey, periodStart: String(r.periodStart), periodEnd: String(r.periodEnd), pakketType: r.pakketType,
    voorlopig: r.voorlopig, metrics: r.metrics as unknown as QuarterMetrics, klant: r.klant as unknown as QuarterKlant,
    intern: r.intern as unknown as QuarterIntern, ontbrekend: (r.ontbrekend ?? []) as string[],
  };
  await db.insert(quarterlyReportVersions).values({ reportId, versionNumber, kind, content: content as unknown as Record<string, unknown>, byId, note: note ?? null });
  await db.update(quarterlyReports).set({ versionNumber }).where(eq(quarterlyReports.id, reportId));
  return versionNumber;
}

/* ------------------------------------------------------------------ *
 * Rij per klant en kwartaal (nooit dubbel)
 * ------------------------------------------------------------------ */

/** Zorgt dat er precies één rapportage bestaat voor deze klant en dit kwartaal. */
export async function ensureQuarterRow(clientId: string, q: Quarter): Promise<{ id: string; created: boolean }> {
  const [ins] = await db.insert(quarterlyReports).values({
    clientId, periodMode: q.mode, periodKey: q.key, periodStart: q.from, periodEnd: q.to, title: quarterTitle(q), status: "gepland",
  }).onConflictDoNothing().returning({ id: quarterlyReports.id });
  if (ins) {
    await logQuarterEvent({ reportId: ins.id, clientId, type: "gepland", to: "gepland", note: `Kwartaal ${q.label} ingepland.` });
    return { id: ins.id, created: true };
  }
  const [row] = await db.select({ id: quarterlyReports.id, deletedAt: quarterlyReports.deletedAt }).from(quarterlyReports)
    .where(and(eq(quarterlyReports.clientId, clientId), eq(quarterlyReports.periodKey, q.key))).limit(1);
  if (row?.deletedAt) await db.update(quarterlyReports).set({ deletedAt: null, updatedAt: new Date() }).where(eq(quarterlyReports.id, row.id));
  return { id: row!.id, created: false };
}

/* ------------------------------------------------------------------ *
 * Genereren
 * ------------------------------------------------------------------ */

export type GenerateResult =
  | { ok: true; reportId: string; status: QuarterStatus; voorlopig: boolean }
  | { ok: false; reason: "not_found" | "in_progress" | "locked" | "wachten_op_data" | "no_provider" | "error"; message: string };

/**
 * (Her)genereert de rapportage. Een voorlopig concept mag altijd; een
 * definitieve versie alleen als alle cijfers van het kwartaal binnen zijn, of
 * als een medewerker bewust kiest voor afronden met onvolledige data
 * (`allowIncomplete`). Goedgekeurde en gepubliceerde rapportages worden nooit
 * stilzwijgend overschreven: die moeten eerst worden heropend.
 */
export async function generateQuarterReport(
  reportId: string,
  opts: { byId?: string | null; force?: boolean; allowIncomplete?: boolean; today?: string } = {},
): Promise<GenerateResult> {
  const [r] = await db.select().from(quarterlyReports).where(and(eq(quarterlyReports.id, reportId), isNull(quarterlyReports.deletedAt))).limit(1);
  if (!r) return { ok: false, reason: "not_found", message: "Rapportage niet gevonden." };
  if (r.status === "goedgekeurd" || r.status === "gepubliceerd") return { ok: false, reason: "locked", message: "Deze rapportage is goedgekeurd. Heropen haar eerst om opnieuw te genereren." };
  if (r.startedAt && !opts.force && (Date.now() - r.startedAt.getTime()) / 60000 < STALE_RUNNING_MIN) return { ok: false, reason: "in_progress", message: "Deze rapportage wordt al gegenereerd." };

  const [client] = await db.select({ id: clients.id, name: clients.name, startedOn: clients.startedOn }).from(clients).where(eq(clients.id, r.clientId)).limit(1);
  if (!client) return { ok: false, reason: "not_found", message: "Klant niet gevonden." };
  const startedOn = client.startedOn ? String(client.startedOn).slice(0, 10) : null;
  const q = quarterFromKey(r.periodKey, startedOn);
  if (!q) return { ok: false, reason: "error", message: "Onbekende rapportageperiode." };

  const today = opts.today ?? amsterdamToday();
  const now = new Date();
  await db.update(quarterlyReports).set({ startedAt: now, errorMessage: null, updatedAt: now }).where(eq(quarterlyReports.id, reportId));

  const fail = async (reason: "no_provider" | "error", message: string): Promise<GenerateResult> => {
    await db.update(quarterlyReports).set({ startedAt: null, errorMessage: message.slice(0, 500), attempts: sql`${quarterlyReports.attempts} + 1`, updatedAt: new Date() }).where(eq(quarterlyReports.id, reportId));
    await logQuarterEvent({ reportId, clientId: r.clientId, type: "generatie_mislukt", byId: opts.byId, note: message });
    return { ok: false, reason, message };
  };

  try {
    const settings = await loadQuarterSettings(r.clientId);
    const metrics = await buildQuarterMetrics({ clientId: r.clientId, quarter: q, today, startedOn, doelen: settings.doelen[q.key] ?? [] });
    const override = Boolean(opts.allowIncomplete || r.dataOverrideAt);

    // Kwartaal voorbij maar de cijfers zijn niet compleet: wachten, nooit als definitief presenteren.
    if (!metrics.voorlopig && !metrics.dataCompleet && !override) {
      await db.update(quarterlyReports).set({
        status: "wachten_op_data", wachtReden: metrics.dataWachtReden, ontbrekend: metrics.ontbrekend as unknown as Record<string, unknown>,
        startedAt: null, updatedAt: new Date(),
      }).where(eq(quarterlyReports.id, reportId));
      if (r.status !== "wachten_op_data") await logQuarterEvent({ reportId, clientId: r.clientId, type: "wachten_op_data", from: r.status, to: "wachten_op_data", byId: opts.byId, note: metrics.dataWachtReden });
      return { ok: false, reason: "wachten_op_data", message: metrics.dataWachtReden ?? "Nog niet alle cijfers zijn binnen." };
    }

    const [strategy, geheugen] = await Promise.all([
      loadStrategyProfile(r.clientId).then(strategyToText).catch(() => ""),
      import("@/server/content-memory").then(async (m) => {
        const cm = await m.loadClientMemory(r.clientId);
        return cm ? m.contentMemoryPromptText(cm, { isAd: metrics.pakket.type === "advertentie" }) : "";
      }).catch(() => ""),
    ]);
    const feedback = (Array.isArray(r.openFeedback) ? (r.openFeedback as Array<{ body?: string }>) : []).map((f) => String(f.body ?? "")).filter(Boolean);
    const res = await generateQuarterAnalysis({ clientName: client.name, metrics, doelstelling: strategy, contentgeheugen: geheugen, feedback });
    if (!res.ok) return fail(res.reason, res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld." : res.message ?? "De analyse is mislukt.");

    const ontbrekend = [...metrics.ontbrekend];
    if (res.internMislukt) ontbrekend.push("De interne verdieping kon deze keer niet worden opgesteld. Genereer opnieuw om het nogmaals te proberen.");
    if (!metrics.voorlopig && !metrics.dataCompleet && override) ontbrekend.unshift(`Bewust afgerond met onvolledige data. ${metrics.dataWachtReden ?? ""}`.trim());

    const vorigIntern = normalizeIntern(r.intern);
    const intern: QuarterIntern = { ...res.intern, toelichting: vorigIntern.toelichting, akkoord: [] };
    const status: QuarterStatus = metrics.voorlopig ? "concept_gegenereerd" : "klaar_voor_controle";
    await db.update(quarterlyReports).set({
      status, voorlopig: metrics.voorlopig, queued: null, pakketType: metrics.pakket.type,
      metrics: { ...metrics, analyseVersie: KWARTAAL_ANALYSE_VERSIE, model: res.model } as unknown as Record<string, unknown>,
      klant: res.klant as unknown as Record<string, unknown>, intern: intern as unknown as Record<string, unknown>,
      ontbrekend: ontbrekend as unknown as Record<string, unknown>,
      wachtReden: metrics.voorlopig ? metrics.dataWachtReden : null,
      openFeedback: [], reviewedAt: null, reviewedById: null, approvedAt: null, approvedById: null, approvedVersion: null,
      dataOverrideAt: opts.allowIncomplete ? new Date() : r.dataOverrideAt, dataOverrideById: opts.allowIncomplete ? (opts.byId ?? null) : r.dataOverrideById,
      startedAt: null, generatedAt: new Date(), attempts: 0, errorMessage: null, updatedAt: new Date(),
    }).where(eq(quarterlyReports.id, reportId));
    const versie = await snapshotQuarterVersion(reportId, "generatie", opts.byId ?? null, metrics.voorlopig ? "Voorlopig concept" : "Definitieve cijfers");
    await logQuarterEvent({
      reportId, clientId: r.clientId, type: metrics.voorlopig ? "concept_gegenereerd" : "definitief_gegenereerd", from: r.status, to: status, byId: opts.byId,
      note: `${metrics.voorlopig ? "Voorlopig concept" : "Definitieve rapportage"} gegenereerd (versie ${versie})${feedback.length ? `, ${feedback.length} opmerking(en) verwerkt` : ""}.`,
      meta: { versie, ontbrekend: ontbrekend.length, allowIncomplete: Boolean(opts.allowIncomplete) },
    });
    if (!metrics.voorlopig) await recordActivity({ clientId: r.clientId, type: "quarter_report.generated", title: `${r.title} klaar voor interne controle`, isClientVisible: false }).catch(() => undefined);
    return { ok: true, reportId, status, voorlopig: metrics.voorlopig };
  } catch (e) {
    return fail("error", e instanceof Error ? e.message : "De rapportage kon niet worden gegenereerd.");
  }
}
