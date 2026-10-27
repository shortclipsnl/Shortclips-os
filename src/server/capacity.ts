import "server-only";
import { and, between, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { capacityParams, capacityPeople, clients, deliverables, productionDays, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export type CapacityStatus = "gezond" | "hoog" | "kritiek" | "geen_data";

export type CapacityPerson = {
  id: string;
  name: string;
  role: string | null;
  employment: string | null;
  unit: string;
  unitLabel: string;
  load: number | null;
  green: number | null;
  orange: number | null;
  max: number | null;
  occupancy: number | null; // % t.o.v. gezonde grens
  status: CapacityStatus;
  costPerMonth: number | null;
  detail: string | null;
  /** Zelf-ingevulde beschikbaarheidsnotitie (wanneer niet beschikbaar). */
  availabilityNote: string | null;
};

export type CapacityParam = { key: string; label: string | null; value: number | null; unit: string | null; confidence: string | null };

const UNIT_LABEL: Record<string, string> = {
  opnames_4w: "opnames / 4 weken",
  shorts_4w: "shorts / 4 weken",
  cc_uren_maand: "klanturen / maand",
  niet_gemeten: "niet gemeten",
};

const EDITING_STATES = ["editing", "editor_revision", "awaiting_editor"] as const;

function n(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Realistische statusbepaling met drie grenzen: groen = comfortabele werklast,
 * max = het absolute plafond. Zo springt iemand niet meteen op "kritiek" (rood)
 * zodra de belasting nét boven de comfortabele lijn komt — rood betekent
 * daadwerkelijk overbelast (boven het plafond), niet gewoon een drukke periode.
 *
 * - t/m de groene grens → gezond
 * - tussen groen en het plafond → hoog (druk, maar binnen de rek)
 * - boven het plafond → kritiek
 *
 * Het plafond is `max` (of `orange` als er geen max is), met als laatste
 * terugval 50% boven de groene grens.
 */
function statusFor(load: number | null, green: number | null, orange: number | null, max: number | null): CapacityStatus {
  if (load === null || green === null || green <= 0) return "geen_data";
  const ceiling = max && max > green ? max : orange && orange > green ? orange : green * 1.5;
  if (load > ceiling) return "kritiek";
  if (load > green) return "hoog";
  return "gezond";
}

/**
 * Teamcapaciteit: per persoon de belasting in de eigen eenheid (native
 * berekend uit opnamedagen, editwerk en klanten), plus de globale aannames
 * en een economische samenvatting. Vervangt het Monday-capaciteitsdashboard.
 */
export async function getCapacityOverview(): Promise<{
  people: CapacityPerson[];
  params: CapacityParam[];
  summary: {
    activeClients: number;
    monthlyShorts: number;
    editChainCapacity: number | null;
    editChainUsedPct: number | null;
    activeEditors: number;
    monthlyRevenue: number | null;
    staffCost: number | null;
    estimatedProfit: number | null;
  };
}> {
  await requireInternal();
  const today = new Date().toISOString().slice(0, 10);
  const in28 = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);

  const [peopleRows, paramRows, noteRows] = await Promise.all([
    db.select().from(capacityPeople),
    db.select().from(capacityParams),
    db.select({ id: users.id, note: users.availabilityNote }).from(users).where(isNull(users.deletedAt)),
  ]);
  const noteMap = new Map(noteRows.filter((u) => u.note).map((u) => [u.id, u.note as string]));

  const params: CapacityParam[] = paramRows
    .map((p) => ({ key: p.key, label: p.label, value: n(p.value), unit: p.unit, confidence: p.confidence }))
    .sort((a, b) => (a.label ?? a.key).localeCompare(b.label ?? b.key));
  const P = new Map(params.map((p) => [p.key, p.value ?? 0]));
  const param = (k: string, fallback = 0) => P.get(k) ?? fallback;

  const people: CapacityPerson[] = [];
  for (const row of peopleRows) {
    let load: number | null = null;
    let detail: string | null = null;

    if (row.userId && row.unit === "opnames_4w") {
      const [r] = await db
        .select({ c: sql<number>`count(*)` })
        .from(productionDays)
        .where(
          and(
            eq(productionDays.videographerId, row.userId),
            isNull(productionDays.deletedAt),
            ne(productionDays.status, "cancelled"),
            between(productionDays.scheduledOn, today, in28),
          ),
        );
      load = Number(r?.c ?? 0);
      detail = `${load} opname(s) gepland in de komende 4 weken`;
    } else if (row.userId && row.unit === "shorts_4w") {
      const [r] = await db
        .select({ c: sql<number>`count(*)` })
        .from(deliverables)
        .where(and(eq(deliverables.editorId, row.userId), isNull(deliverables.deletedAt), inArray(deliverables.status, EDITING_STATES)))
        .limit(1);
      load = Number(r?.c ?? 0);
      detail = `${load} short(s) in bewerking`;
    } else if (row.userId && row.unit === "cc_uren_maand") {
      const cs = await db
        .select({ quota: clients.monthlyVideoQuota, complexity: clients.complexity })
        .from(clients)
        .where(and(eq(clients.coordinatorId, row.userId), eq(clients.status, "active"), isNull(clients.deletedAt)));
      const uShort = param("cc_u_short", 0.5) + param("cc_u_post", 0.1667);
      const uOpname = param("cc_u_opname", 2);
      const uVast = param("cc_u_vast", 2);
      const opnPerClient = param("opn_klant_real", 0.67);
      let hours = 0;
      for (const c of cs) {
        const shorts = c.quota || param("shorts_klant_real", 3.9);
        const factor = c.complexity === "hoog" ? param("cc_f_hoog", 1.3) : c.complexity === "gemiddeld" ? param("cc_f_gem", 1.15) : 1;
        hours += (shorts * uShort + opnPerClient * uOpname + uVast) * factor;
      }
      load = Math.round(hours * 10) / 10;
      detail = `${cs.length} klant(en) · ~${load} klanturen per maand`;
    }

    const green = n(row.limitGreen);
    const orange = n(row.limitOrange);
    const max = n(row.limitMax);
    const status = statusFor(load, green, orange, max);
    const occupancy = load !== null && green ? Math.round((load / green) * 100) : null;

    people.push({
      id: row.id,
      name: row.name,
      role: row.role,
      employment: row.employment,
      unit: row.unit,
      unitLabel: UNIT_LABEL[row.unit] ?? row.unit,
      load,
      green,
      orange,
      max,
      occupancy,
      status,
      costPerMonth: n(row.costPerMonth),
      detail,
      availabilityNote: row.userId ? noteMap.get(row.userId) ?? null : null,
    });
  }

  // Volgorde: eerst wie belast is, dan op bezetting aflopend.
  const order: Record<CapacityStatus, number> = { kritiek: 0, hoog: 1, gezond: 2, geen_data: 3 };
  people.sort((a, b) => order[a.status] - order[b.status] || (b.occupancy ?? -1) - (a.occupancy ?? -1));

  // Teamsamenvatting / economie.
  const [{ c: activeClients }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(clients)
    .where(and(eq(clients.status, "active"), isNull(clients.deletedAt)));
  const [{ s: monthlyShortsRaw }] = await db
    .select({ s: sql<number>`coalesce(sum(${clients.monthlyVideoQuota}),0)` })
    .from(clients)
    .where(and(eq(clients.status, "active"), isNull(clients.deletedAt)));
  const monthlyShorts = Number(monthlyShortsRaw ?? 0);
  const activeEditors = peopleRows.filter((p) => (p.role ?? "").toLowerCase().includes("editor")).length;
  const editChainCapacity = param("edit_keten", 0) || null;
  const editChainUsedPct = editChainCapacity ? Math.round((monthlyShorts / editChainCapacity) * 100) : null;

  const omzetKlant = param("omzet_klant", 0);
  const monthlyRevenue = omzetKlant ? Math.round(Number(activeClients) * omzetKlant) : null;
  const staffCost = peopleRows.reduce((sum, p) => sum + (n(p.costPerMonth) ?? 0), 0) + param("kosten_overig", 0);
  const estimatedProfit = monthlyRevenue !== null ? Math.round(monthlyRevenue - staffCost) : null;

  return {
    people,
    params,
    summary: {
      activeClients: Number(activeClients),
      monthlyShorts,
      editChainCapacity,
      editChainUsedPct,
      activeEditors,
      monthlyRevenue,
      staffCost: Math.round(staffCost) || null,
      estimatedProfit,
    },
  };
}
