import "server-only";
import { and, eq, inArray, isNull, like, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { attentionStates, clients, contracts } from "@/db/schema";
import {
  attentionList, buildRow, sortActive, sortInactive, totalsFor,
  type AttentionItem, type ContractClient, type ContractPeriod, type ContractRow, type ContractTotals,
  type Reactivation, type RenewalStatus,
} from "@/lib/contracts";

/**
 * Contracten & Verlengingen: gegevens ophalen voor de eigenaar. De toegang zelf
 * wordt op de pagina en in de acties afgedwongen (requireOwner); deze module
 * levert alleen de data.
 */

export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

export function toPeriod(k: typeof contracts.$inferSelect): ContractPeriod {
  return {
    id: k.id,
    status: k.status,
    startsOn: iso(k.startsOn),
    endsOn: iso(k.endsOn),
    durationMonths: k.durationMonths,
    monthlyValue: Number(k.monthlyValue) || 0,
    videosPerMonth: k.videosPerMonth,
    autoRenew: k.autoRenew,
    noticePeriodDays: k.noticePeriodDays,
    renewalStatus: (k.renewalStatus as RenewalStatus) ?? "open",
    clientConfirmed: k.clientConfirmed,
    reminderDays: Array.isArray(k.reminderDays) && k.reminderDays.length ? k.reminderDays : null,
    endReason: k.endReason,
    reactivation: (k.reactivation as Reactivation | null) ?? null,
    notes: k.notes,
    verified: !!k.verifiedAt,
    ownerManaged: k.ownerManaged,
    previousContractId: k.previousContractId,
    createdAt: (k.createdAt instanceof Date ? k.createdAt : new Date(String(k.createdAt))).toISOString(),
  };
}

/** Alle klanten (geen prospects) met hun contractperiodes. */
export async function loadContractClients(): Promise<ContractClient[]> {
  const cs = await db
    .select({
      id: clients.id, slug: clients.slug, name: clients.name, logoUrl: clients.logoUrl, color: clients.color,
      status: clients.status, monthlyRevenue: clients.monthlyRevenue, monthlyVideoQuota: clients.monthlyVideoQuota,
      endedOn: clients.endedOn,
    })
    .from(clients)
    .where(and(isNull(clients.deletedAt), ne(clients.status, "prospect")));
  if (!cs.length) return [];
  const ks = await db.select().from(contracts)
    .where(and(isNull(contracts.deletedAt), inArray(contracts.clientId, cs.map((c) => c.id))));
  const byClient = new Map<string, ContractPeriod[]>();
  for (const k of ks) {
    const list = byClient.get(k.clientId) ?? [];
    list.push(toPeriod(k));
    byClient.set(k.clientId, list);
  }
  return cs.map((c) => ({
    ...c,
    monthlyRevenue: Number(c.monthlyRevenue) || 0,
    endedOn: iso(c.endedOn),
    periods: byClient.get(c.id) ?? [],
  }));
}

/** Fases die de eigenaar al heeft afgehandeld (komen pas bij de volgende fase terug). */
async function handledKeys(): Promise<Set<string>> {
  const rows = await db.select({ key: attentionStates.signalKey }).from(attentionStates)
    .where(and(like(attentionStates.signalKey, "contract-owner:%"), eq(attentionStates.status, "klaar")));
  return new Set(rows.map((r) => r.key));
}

export type ContractsDashboard = {
  today: string;
  active: ContractRow[];
  inactive: ContractRow[];
  totals: ContractTotals;
  attention: AttentionItem[];
};

export async function getContractsDashboard(today = todayIso()): Promise<ContractsDashboard> {
  const [list, handled] = await Promise.all([loadContractClients(), handledKeys()]);
  const rows = list.map((c) => buildRow(c, today));
  return {
    today,
    active: sortActive(rows),
    inactive: sortInactive(rows),
    totals: totalsFor(rows, today),
    attention: attentionList(rows, handled),
  };
}

/** Compact: alleen wat er voor het blok op de Vandaag-pagina nodig is. */
export async function getContractAttention(today = todayIso()): Promise<{ items: AttentionItem[]; toVerify: number }> {
  const d = await getContractsDashboard(today);
  return { items: d.attention, toVerify: d.totals.toVerify };
}

/** Eén klant met alle periodes, voor het detailoverzicht. */
export async function getContractClient(slug: string, today = todayIso()): Promise<ContractRow | null> {
  const list = await loadContractClients();
  const c = list.find((x) => x.slug === slug);
  return c ? buildRow(c, today) : null;
}

/**
 * Dagelijkse bijwerking (vanuit de signaleringstaak):
 *  1. Wordt een door de eigenaar vastgelegde periode de lopende periode (bijv.
 *     een verlenging met een nieuw maandbedrag), dan krijgen de klantgegevens
 *     dat maandbedrag en die afname, zodat de rest van het portaal klopt.
 *  2. Is een klant als beëindigd gemarkeerd en de einddatum verstreken, dan
 *     gaat de klant naar "gestopt" en sluit het contract af.
 * Raakt alleen contracten die de eigenaar zelf heeft vastgelegd.
 */
export async function syncContractPeriods(today = todayIso()): Promise<{ synced: number; ended: number }> {
  const list = await loadContractClients();
  let synced = 0;
  let ended = 0;
  for (const c of list) {
    const row = buildRow(c, today);
    const cur = row.current;
    if (cur?.ownerManaged && c.status !== "churned") {
      const patch: Partial<typeof clients.$inferInsert> = {};
      if (Math.abs(cur.monthlyValue - c.monthlyRevenue) > 0.004) patch.monthlyRevenue = cur.monthlyValue.toFixed(2);
      if (cur.videosPerMonth != null && cur.videosPerMonth !== c.monthlyVideoQuota) patch.monthlyVideoQuota = cur.videosPerMonth;
      if (Object.keys(patch).length) {
        await db.update(clients).set({ ...patch, updatedAt: new Date() }).where(eq(clients.id, c.id));
        synced++;
      }
    }
    const last = row.latest;
    if (last?.ownerManaged && last.renewalStatus === "beeindigd" && last.endsOn && last.endsOn < today && c.status !== "churned") {
      await db.update(clients).set({ status: "churned", endedOn: last.endsOn, updatedAt: new Date() }).where(eq(clients.id, c.id));
      await db.update(contracts).set({ status: "terminated", updatedAt: new Date() }).where(eq(contracts.id, last.id));
      ended++;
    }
  }
  return { synced, ended };
}
