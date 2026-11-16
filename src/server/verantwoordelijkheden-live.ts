import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Viewer } from "@/server/auth/context";
import { getAttentionBoard } from "@/server/attention";
import { addWorkingDays } from "@/lib/workdays";
import { todayAmsterdam } from "@/lib/planning-deadline";
import type { Rol } from "@/lib/verantwoordelijkheden/rol";
import { getContractAttention } from "@/server/contracts";
import { getGoalsOverview } from "@/server/goals/overview";
import { loadCapacityData } from "@/server/capacity-forecast";
import CapEngine from "@/lib/capacity-engine";

/**
 * Mijn verantwoordelijkheden: de actuele stand per persoon.
 *
 * Alles hier komt uit bestaande portaalgegevens. Er worden geen cijfers geschat:
 * een KPI zonder betrouwbare bron geeft `waarde: null` ("Nog geen meting").
 * Signalen komen uit de bestaande Aandachtspunten (zelfde bron als /kwaliteit),
 * zodat er geen tweede meldingssysteem ontstaat.
 */

export type Kleur = "groen" | "oranje" | "rood";
export type KpiStand = {
  id: string;
  /** Het cijfer zelf, bijv. "86%" of "2". Null = nog geen meting. */
  waarde: string | null;
  /** Korte toelichting onder het cijfer. */
  toelichting: string;
  kleur: Kleur | null;
  href: string | null;
};
export type MijnKlant = {
  slug: string;
  name: string;
  logoUrl: string | null;
  color: string | null;
  quota: number;
  volgendeOpname: string | null;
  signalen: number;
};
export type MijnOpname = {
  id: string;
  titel: string;
  klant: string;
  logoUrl: string | null;
  color: string | null;
  datum: string;
  tijd: string | null;
  scriptKlaar: boolean;
};
export type Signaal = {
  key: string;
  klant: string | null;
  logoUrl: string | null;
  color: string | null;
  /** Wat gaat er mis. */
  wat: string;
  /** Welke actie wordt verwacht. */
  actie: string;
  /** Wanneer moet dit opgelost zijn. */
  wanneer: string;
  urgent: boolean;
  href: string | null;
  /** Wie het oppakt; leeg = de persoon van de pagina. */
  eigenaar?: string | null;
};
/** Directie: kwartaaldoelen per pijler (uit Doelen). */
export type DoelPijler = {
  key: string;
  label: string;
  totaal: number;
  opKoers: number;
  risico: number;
  achter: number;
  gehaald: number;
  overig: number;
};
export type LiveStand = {
  kpis: Record<string, KpiStand>;
  klanten: MijnKlant[];
  opnames: MijnOpname[];
  signalen: Signaal[];
  /** Totaal aantal open signalen (de lijst toont er maximaal zes). */
  signalenTotaal: number;
  /** False als de signalen niet geladen konden worden. */
  signalenBeschikbaar: boolean;
  /** Alleen directie: doelen per pijler en hoe ver het kwartaal is. */
  doelen?: { pijlers: DoelPijler[]; week: number; weken: number } | null;
};

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const iso = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const dagenTerug = (today: string, n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const geenMeting = (id: string, toelichting = "Nog geen meting"): KpiStand => ({ id, waarde: null, toelichting, kleur: null, href: null });
/** 0 = groen, 1 t/m `oranjeTot` = oranje, daarboven rood. */
const kleurAantal = (n: number, oranjeTot: number): Kleur => (n === 0 ? "groen" : n <= oranjeTot ? "oranje" : "rood");

async function een<T>(q: ReturnType<typeof sql>): Promise<T | null> {
  try {
    return rows<T>(await db.execute(q))[0] ?? null;
  } catch {
    return null;
  }
}

/** Opnames binnen 7 werkdagen: hoeveel hebben nog geen definitief script? */
async function kpiScripts(id: string, kolom: "coordinator" | "videograaf", userId: string, today: string): Promise<KpiStand> {
  const grens = addWorkingDays(today, 7);
  const wie = kolom === "coordinator" ? sql`c.coordinator_id = ${userId}` : sql`p.videographer_id = ${userId}`;
  const r = await een<{ totaal: number; open: number }>(sql`
    select count(*)::int as totaal, count(*) filter (where p.scripting_status <> 'final')::int as open
    from production_days p join clients c on c.id = p.client_id
    where ${wie} and p.deleted_at is null and p.status <> 'cancelled'
      and p.scheduled_on >= ${today}::date and p.scheduled_on <= ${grens}::date`);
  if (!r) return geenMeting(id, "Niet beschikbaar");
  const totaal = Number(r.totaal), open = Number(r.open);
  if (totaal === 0) return { id, waarde: "0", toelichting: "Geen opnames binnen 7 werkdagen", kleur: null, href: "/scripting" };
  return {
    id,
    waarde: `${totaal - open}/${totaal}`,
    toelichting: open === 0 ? "Alle opnames binnen 7 werkdagen definitief" : `${open} ${open === 1 ? "opname" : "opnames"} binnen 7 werkdagen zonder definitief script`,
    kleur: kleurAantal(open, 1),
    href: "/scripting",
  };
}

async function kpisContentCreative(userId: string, today: string): Promise<KpiStand[]> {
  const vanaf = dagenTerug(today, 30);
  const [scripts, videos, publicaties, rapportages] = await Promise.all([
    kpiScripts("scripts", "coordinator", userId, today),
    een<{ totaal: number; laat: number }>(sql`
      select count(*)::int as totaal,
        count(*) filter (where exists (
          select 1 from deadline_misses m where m.entity_type = 'deliverable' and m.entity_id = d.id
        ))::int as laat
      from deliverables d join clients c on c.id = d.client_id
      where c.coordinator_id = ${userId} and d.deleted_at is null
        and d.due_on < ${today}::date and d.due_on >= ${vanaf}::date`),
    een<{ totaal: number; open: number }>(sql`
      select count(*)::int as totaal, count(*) filter (where k.status <> 'published')::int as open
      from content_calendar k join clients c on c.id = k.client_id
      where c.coordinator_id = ${userId} and c.we_handle_posting and k.deleted_at is null
        and k.scheduled_on < ${today}::date and k.scheduled_on >= ${vanaf}::date`),
    een<{ laat: number }>(sql`
      select count(*)::int as laat from tasks t
      where t.assignee_id = ${userId} and t.dedupe_key like 'maandrapport:%'
        and t.status not in ('done', 'cancelled') and t.archived_at is null and t.deleted_at is null
        and t.due_on < ${today}::date`),
  ]);

  let videoStand: KpiStand;
  if (!videos) videoStand = geenMeting("videos", "Niet beschikbaar");
  else if (Number(videos.totaal) === 0) videoStand = { id: "videos", waarde: null, toelichting: "Geen opleveringen in de laatste 30 dagen", kleur: null, href: "/videos" };
  else {
    const totaal = Number(videos.totaal), laat = Number(videos.laat);
    const pct = Math.round(((totaal - laat) / totaal) * 100);
    videoStand = {
      id: "videos",
      waarde: `${pct}%`,
      toelichting: `${totaal - laat} van ${totaal} op tijd, laatste 30 dagen`,
      kleur: pct >= 95 ? "groen" : pct >= 85 ? "oranje" : "rood",
      href: "/videos",
    };
  }

  let pubStand: KpiStand;
  if (!publicaties) pubStand = geenMeting("publicaties", "Niet beschikbaar");
  else {
    const totaal = Number(publicaties.totaal), open = Number(publicaties.open);
    pubStand = {
      id: "publicaties",
      waarde: String(open),
      toelichting: totaal === 0 ? "Geen geplande publicaties in de laatste 30 dagen" : `${totaal - open} van ${totaal} geplaatst, laatste 30 dagen`,
      kleur: totaal === 0 ? null : kleurAantal(open, 2),
      href: "/calendar",
    };
  }

  const rapStand: KpiStand = rapportages
    ? {
        id: "rapportages",
        waarde: String(Number(rapportages.laat)),
        toelichting: Number(rapportages.laat) === 0 ? "Niets te laat" : "Openstaand na de deadline",
        kleur: kleurAantal(Number(rapportages.laat), 2),
        href: "/analytics/maandrapportages",
      }
    : geenMeting("rapportages", "Niet beschikbaar");

  return [scripts, geenMeting("klantvragen"), videoStand, pubStand, rapStand];
}

async function kpisVideograaf(userId: string, today: string): Promise<KpiStand[]> {
  const vanaf = dagenTerug(today, 30);
  const [scripts, afgerond] = await Promise.all([
    kpiScripts("draaiboeken", "videograaf", userId, today),
    een<{ totaal: number; ok: number }>(sql`
      select count(*)::int as totaal, count(*) filter (where d.status = 'afgerond')::int as ok
      from draaiboeken d join production_days p on p.id = d.production_day_id
      where p.videographer_id = ${userId} and d.deleted_at is null and p.deleted_at is null
        and d.status in ('afgerond', 'afgerond_open')
        and p.scheduled_on < ${today}::date and p.scheduled_on >= ${vanaf}::date`),
  ]);
  let af: KpiStand = geenMeting("afgerond");
  if (afgerond && Number(afgerond.totaal) > 0) {
    const totaal = Number(afgerond.totaal), ok = Number(afgerond.ok);
    const pct = Math.round((ok / totaal) * 100);
    af = {
      id: "afgerond",
      waarde: `${pct}%`,
      toelichting: `${ok} van ${totaal} volledig afgerond, laatste 30 dagen`,
      kleur: pct >= 100 ? "groen" : pct >= 90 ? "oranje" : "rood",
      href: "/productions",
    };
  }
  return [scripts, af, geenMeting("overdracht"), geenMeting("heropnames"), geenMeting("ontbrekend")];
}

async function mijnKlanten(userId: string, today: string): Promise<Omit<MijnKlant, "signalen">[]> {
  try {
    const res = await db.execute(sql`
      select c.slug, c.name, c.logo_url as "logoUrl", c.color, c.monthly_video_quota as quota,
        (select min(p.scheduled_on) from production_days p
          where p.client_id = c.id and p.deleted_at is null and p.status <> 'cancelled'
            and p.scheduled_on >= ${today}::date) as "volgendeOpname"
      from clients c
      where c.coordinator_id = ${userId} and c.status = 'active' and c.deleted_at is null
      order by c.name`);
    return rows<{ slug: string; name: string; logoUrl: string | null; color: string | null; quota: number; volgendeOpname: unknown }>(res).map((r) => ({
      slug: r.slug, name: r.name, logoUrl: r.logoUrl, color: r.color, quota: Number(r.quota ?? 0), volgendeOpname: iso(r.volgendeOpname),
    }));
  } catch {
    return [];
  }
}

async function mijnOpnames(userId: string, today: string): Promise<MijnOpname[]> {
  try {
    const tot = new Date(`${today}T12:00:00Z`);
    tot.setUTCDate(tot.getUTCDate() + 21);
    const res = await db.execute(sql`
      select p.id, p.title as titel, p.scheduled_on as datum, p.start_time as tijd,
        p.scripting_status as "scriptStatus", c.name as klant, c.logo_url as "logoUrl", c.color
      from production_days p join clients c on c.id = p.client_id
      where p.videographer_id = ${userId} and p.deleted_at is null and p.status <> 'cancelled'
        and p.scheduled_on >= ${today}::date and p.scheduled_on <= ${tot.toISOString().slice(0, 10)}::date
      order by p.scheduled_on, p.start_time nulls last
      limit 12`);
    return rows<{ id: string; titel: string; datum: unknown; tijd: string | null; scriptStatus: string; klant: string; logoUrl: string | null; color: string | null }>(res).map((r) => ({
      id: r.id, titel: r.titel, klant: r.klant, logoUrl: r.logoUrl, color: r.color,
      datum: iso(r.datum) ?? today, tijd: r.tijd ? String(r.tijd).slice(0, 5) : null, scriptKlaar: r.scriptStatus === "final",
    }));
  } catch {
    return [];
  }
}

const datumKort = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Open aandachtspunten van deze persoon, uit de bestaande Aandachtspunten. */
async function mijnSignalen(subject: Viewer, trusted: boolean, today: string): Promise<{ lijst: Signaal[]; totaal: number; perKlant: Map<string, number>; ok: boolean }> {
  try {
    const { items } = await getAttentionBoard(subject, { trusted });
    const rang = { hoog: 0, normaal: 1, laag: 2 } as const;
    const mijn = items
      .filter((i) => i.ownerId === subject.id && i.status !== "klaar")
      .sort((a, b) => rang[a.priority] - rang[b.priority] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
    const perKlant = new Map<string, number>();
    for (const i of mijn) if (i.clientName) perKlant.set(i.clientName, (perKlant.get(i.clientName) ?? 0) + 1);
    const lijst = mijn.slice(0, 6).map((i): Signaal => {
      const teLaat = Boolean(i.dueOn && i.dueOn < today);
      const wanneer = i.dueOn
        ? teLaat ? `Te laat sinds ${datumKort(i.dueOn)}` : i.dueOn === today ? "Vandaag" : `Uiterlijk ${datumKort(i.dueOn)}`
        : i.priority === "hoog" ? "Vandaag" : i.priority === "normaal" ? "Deze week" : "Later";
      return {
        key: i.key, klant: i.clientName, logoUrl: i.clientLogoUrl, color: i.clientColor,
        wat: i.reason, actie: i.action, wanneer, urgent: teLaat || i.priority === "hoog", href: i.href,
      };
    });
    return { lijst, totaal: mijn.length, perKlant, ok: true };
  } catch {
    return { lijst: [], totaal: 0, perKlant: new Map(), ok: false };
  }
}

/* ------------------------------------------------------------------ *
 * Directie (Jarno): de stand van heel Shortclips.
 * ------------------------------------------------------------------ */

const euro = (n: number) => `€ ${Math.round(n).toLocaleString("nl-NL")}`;

async function kpiOmzet(today: string): Promise<KpiStand> {
  const r = await een<{ mrr: number; klanten: number; doel: number | null }>(sql`
    select coalesce(sum(coalesce(c.monthly_revenue, 0) + coalesce(c.extra_revenue, 0)), 0)::float as mrr, count(*)::int as klanten,
      (select nullif(f.revenue_target, 0)::float from company_finance_months f where f.period = ${today.slice(0, 7)} limit 1) as doel
    from clients c where c.deleted_at is null and c.status = 'active'`);
  if (!r) return geenMeting("omzet", "Niet beschikbaar");
  const mrr = Number(r.mrr), klanten = Number(r.klanten), doel = r.doel ? Number(r.doel) : null;
  if (!doel) {
    return { id: "omzet", waarde: euro(mrr), toelichting: `${klanten} actieve klanten · geen maanddoel ingesteld`, kleur: null, href: "/financien" };
  }
  const pct = Math.round((mrr / doel) * 100);
  return {
    id: "omzet",
    waarde: euro(mrr),
    toelichting: `${pct}% van het maanddoel (${euro(doel)}) · ${klanten} actieve klanten`,
    kleur: pct >= 100 ? "groen" : pct >= 90 ? "oranje" : "rood",
    href: "/financien",
  };
}

type LeadStand = { open: number; achter: number; offertes: number; offerteWaarde: number; nieuweKlanten: number };
async function leadStand(today: string): Promise<LeadStand | null> {
  const maandStart = `${today.slice(0, 7)}-01`;
  const r = await een<LeadStand>(sql`
    select
      (select count(*)::int from sales_leads l where l.deleted_at is null and l.status in ('lead', 'offerte', 'onderhandeling')) as open,
      (select count(*)::int from sales_leads l where l.deleted_at is null and l.status in ('lead', 'offerte', 'onderhandeling')
        and l.follow_up_on < ${today}::date) as achter,
      (select count(*)::int from quotes q where q.deleted_at is null and q.status in ('verzonden', 'bekeken')) as offertes,
      (select coalesce(sum(q.amount), 0)::float from quotes q where q.deleted_at is null and q.status in ('verzonden', 'bekeken')) as "offerteWaarde",
      (select count(*)::int from clients c where c.deleted_at is null and c.status in ('onboarding', 'active')
        and c.started_on >= ${maandStart}::date and c.started_on <= ${today}::date) as "nieuweKlanten"`);
  return r ? { open: Number(r.open), achter: Number(r.achter), offertes: Number(r.offertes), offerteWaarde: Number(r.offerteWaarde), nieuweKlanten: Number(r.nieuweKlanten) } : null;
}

function kpiSales(l: LeadStand | null): KpiStand {
  if (!l) return geenMeting("sales", "Niet beschikbaar");
  const delen = [
    l.achter > 0 ? `${l.achter} ${l.achter === 1 ? "opvolging" : "opvolgingen"} te laat` : "Alle opvolgingen op tijd",
    `${l.offertes} ${l.offertes === 1 ? "offerte" : "offertes"} uitstaand${l.offerteWaarde > 0 ? ` (${euro(l.offerteWaarde)})` : ""}`,
    `${l.nieuweKlanten} ${l.nieuweKlanten === 1 ? "nieuwe klant" : "nieuwe klanten"} deze maand`,
  ];
  return { id: "sales", waarde: String(l.open), toelichting: delen.join(" · "), kleur: kleurAantal(l.achter, 2), href: "/leads" };
}

/** Knelpunten (persoon × periode boven 100%) in de komende 3 maanden: dezelfde rekenmotor als Capaciteit. */
async function kpiCapaciteit(): Promise<KpiStand> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const E: any = CapEngine;
  try {
    const data = await loadCapacityData();
    E.configure({ today: data.today, holidays: data.holidays });
    const engineData = { people: data.people, clients: data.clients, shoots: data.shoots, projects: data.projects };
    const st = { settings: { ...E.defaultSettings(), greenBelow: data.settings.greenBelow, orangeMax: data.settings.orangeMax, defaultTravel: data.settings.defaultTravel }, moves: {}, vgMoves: {}, snoozed: [] };
    const P = E.periods();
    const R = E.compute(engineData, st, Math.max(E.weeksUntil(P[P.length - 1].friday), 8));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WMAP: number[] = R.weeks.map((w: any) => P.findIndex((p: any) => w.days[2] >= p.monday && w.days[2] <= p.friday));
    const combos = new Set<string>();
    R.weeks.forEach((_: unknown, wi: number) => {
      const pi = WMAP[wi]!;
      if (pi < 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      R.vgRows.concat(R.edRows).forEach((r: any) => { if (r.cells[wi].key === "rood") combos.add(`${r.person.id}-${pi}`); });
    });
    const HW = WMAP.filter((x) => x >= 0).length;
    const sig = E.signals(engineData, st, R, HW, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sig.all.sort((a: any, b: any) => (a.week < 6 ? 0 : 1) - (b.week < 6 ? 0 : 1) || b.sev - a.sev);
    const n = combos.size;
    const eerst: string | null = sig.all[0]?.title ?? null;
    return {
      id: "capaciteit",
      waarde: String(n),
      toelichting: n === 0 ? "Geen knelpunten in de komende 3 maanden" : eerst ? `Eerst: ${eerst}` : "Knelpunten in de komende 3 maanden",
      kleur: kleurAantal(n, 2),
      href: "/capaciteit",
    };
  } catch (error) {
    console.error("[verantwoordelijkheden] capaciteit", error);
    return geenMeting("capaciteit", "Niet beschikbaar");
  }
}

async function kpiOperatie(today: string, teamTeLaat: number): Promise<KpiStand> {
  const vanaf = dagenTerug(today, 30);
  const r = await een<{ totaal: number; laat: number }>(sql`
    select count(*)::int as totaal,
      count(*) filter (where exists (
        select 1 from deadline_misses m where m.entity_type = 'deliverable' and m.entity_id = d.id
      ))::int as laat
    from deliverables d join clients c on c.id = d.client_id
    where c.deleted_at is null and d.deleted_at is null
      and d.due_on < ${today}::date and d.due_on >= ${vanaf}::date`);
  if (!r) return geenMeting("operatie", "Niet beschikbaar");
  const totaal = Number(r.totaal), laat = Number(r.laat);
  const team = teamTeLaat > 0 ? ` · ${teamTeLaat} aandachtspunten van het team over de deadline` : "";
  if (totaal === 0) return { id: "operatie", waarde: null, toelichting: `Geen opleveringen in de laatste 30 dagen${team}`, kleur: null, href: "/videos" };
  const pct = Math.round(((totaal - laat) / totaal) * 100);
  return {
    id: "operatie",
    waarde: `${pct}%`,
    toelichting: `${totaal - laat} van ${totaal} op tijd, alle klanten${team}`,
    kleur: pct >= 95 ? "groen" : pct >= 85 ? "oranje" : "rood",
    href: "/videos",
  };
}

async function alleActieveKlanten(): Promise<Omit<MijnKlant, "signalen">[]> {
  try {
    const res = await db.execute(sql`
      select c.slug, c.name, c.logo_url as "logoUrl", c.color, c.monthly_video_quota as quota
      from clients c where c.status = 'active' and c.deleted_at is null order by c.name`);
    return rows<{ slug: string; name: string; logoUrl: string | null; color: string | null; quota: number }>(res).map((r) => ({
      slug: r.slug, name: r.name, logoUrl: r.logoUrl, color: r.color, quota: Number(r.quota ?? 0), volgendeOpname: null,
    }));
  } catch {
    return [];
  }
}

async function overdueLeads(today: string): Promise<{ company: string; followUpOn: string }[]> {
  try {
    const res = await db.execute(sql`
      select l.company, l.follow_up_on as "followUpOn" from sales_leads l
      where l.deleted_at is null and l.status in ('lead', 'offerte', 'onderhandeling') and l.follow_up_on < ${today}::date
      order by l.follow_up_on limit 5`);
    return rows<{ company: string; followUpOn: unknown }>(res).map((r) => ({ company: r.company, followUpOn: iso(r.followUpOn) ?? today }));
  } catch {
    return [];
  }
}

async function getDirectieStand(subject: Viewer, trusted: boolean, today: string): Promise<LiveStand> {
  const rang = { hoog: 0, normaal: 1, laag: 2 } as const;
  const [board, contracten, doelen, leads, klanten, capaciteit, omzet, teLaatLeads] = await Promise.all([
    getAttentionBoard(subject, { trusted }).catch(() => null),
    getContractAttention(today).catch(() => null),
    getGoalsOverview(subject).catch(() => null),
    leadStand(today),
    alleActieveKlanten(),
    kpiCapaciteit(),
    kpiOmzet(today),
    overdueLeads(today),
  ]);

  const open = (board?.items ?? []).filter((i) => i.status !== "klaar");
  const teamNaam = new Map((board?.team ?? []).map((t) => [t.id, t.name]));
  const teamTeLaat = open.filter((i) => i.ownerId && i.ownerId !== subject.id && i.dueOn && i.dueOn < today);
  const operatie = await kpiOperatie(today, teamTeLaat.length);

  // Klantbehoud: klanten met een open klantbehoudsignaal (Aandachtspunten) of een contract dat actie vraagt.
  const behoudKlanten = new Set<string>();
  for (const i of open) if (i.key.startsWith("retentie-") && i.clientName) behoudKlanten.add(i.clientName);
  const contractItems = (contracten?.items ?? []).filter((c) => c.tone !== "info");
  for (const c of contractItems) behoudKlanten.add(c.clientName);
  const kritiek = contractItems.some((c) => c.tone === "kritiek");
  const behoud: KpiStand = !board && !contracten
    ? geenMeting("behoud", "Niet beschikbaar")
    : {
        id: "behoud",
        waarde: String(behoudKlanten.size),
        toelichting: behoudKlanten.size === 0
          ? "Geen klanten met een behoud- of contractsignaal"
          : `${contractItems.length} ${contractItems.length === 1 ? "contract vraagt" : "contracten vragen"} actie · ${behoudKlanten.size - new Set(contractItems.map((c) => c.clientName)).size} met andere signalen`,
        kleur: kritiek ? "rood" : kleurAantal(behoudKlanten.size, 2),
        href: contractItems.length > 0 ? "/contracten" : "/kwaliteit",
      };

  // Signalen voor de directeur: eigen punten, contracten, verlopen opvolging, team dat vastloopt, doelen die achterlopen.
  const signalen: (Signaal & { orde: number })[] = [];
  for (const i of open.filter((x) => x.ownerId === subject.id)) {
    const teLaat = Boolean(i.dueOn && i.dueOn < today);
    signalen.push({
      key: i.key, klant: i.clientName, logoUrl: i.clientLogoUrl, color: i.clientColor, wat: i.reason, actie: i.action,
      wanneer: i.dueOn ? (teLaat ? `Te laat sinds ${datumKort(i.dueOn)}` : i.dueOn === today ? "Vandaag" : `Uiterlijk ${datumKort(i.dueOn)}`) : i.priority === "hoog" ? "Vandaag" : "Deze week",
      urgent: teLaat || i.priority === "hoog", href: i.href, orde: teLaat || i.priority === "hoog" ? 0 : 1 + rang[i.priority],
    });
  }
  for (const c of contractItems) {
    const urgent = c.tone === "kritiek" || c.tone === "urgent";
    signalen.push({
      key: `contract-${c.key}`, klant: c.clientName, logoUrl: null, color: null, wat: c.detail, actie: c.title,
      wanneer: c.tone === "kritiek" ? "Vandaag" : urgent ? "Deze week" : "Binnenkort", urgent, href: "/contracten", orde: urgent ? 0 : 2,
    });
  }
  for (const [idx, l] of teLaatLeads.entries()) {
    signalen.push({
      key: `lead-${idx}-${l.company}`, klant: l.company, logoUrl: null, color: null, wat: "Opvolgdatum verstreken", actie: "Lead opvolgen",
      wanneer: `Te laat sinds ${datumKort(l.followUpOn)}`, urgent: true, href: "/leads", orde: 1,
    });
  }
  const perPersoon = new Map<string, number>();
  for (const i of teamTeLaat) perPersoon.set(i.ownerId!, (perPersoon.get(i.ownerId!) ?? 0) + 1);
  for (const [id, n] of perPersoon) {
    if (n < 3) continue;
    const wie = teamNaam.get(id) ?? "Teamlid";
    signalen.push({
      key: `team-${id}`, klant: null, logoUrl: null, color: null, eigenaar: wie,
      actie: `${wie} heeft ${n} aandachtspunten over de deadline`, wat: "Bespreek wat er vastloopt en of er hulp nodig is",
      wanneer: "Deze week", urgent: n >= 5, href: "/kwaliteit", orde: n >= 5 ? 0 : 2,
    });
  }
  for (const g of (doelen?.rows ?? []).filter((r) => r.status === "achter")) {
    signalen.push({
      key: `doel-${g.id}`, klant: null, logoUrl: null, color: null, eigenaar: g.ownerName,
      actie: `Doel loopt achter: ${g.title}`, wat: g.pillarLabel, wanneer: "Dit kwartaal", urgent: false, href: "/doelen", orde: 3,
    });
  }
  signalen.sort((a, b) => a.orde - b.orde);

  const pijlers: DoelPijler[] = (doelen?.pillars ?? []).map((p) => ({
    key: p.key, label: p.label, totaal: p.rows.length,
    opKoers: p.counts.op_koers, risico: p.counts.risico, achter: p.counts.achter, gehaald: p.counts.gehaald,
    overig: p.counts.gepland + p.counts.niet_bijgewerkt,
  }));

  const perKlant = new Map<string, number>();
  for (const i of open) if (i.clientName) perKlant.set(i.clientName, (perKlant.get(i.clientName) ?? 0) + 1);

  return {
    kpis: Object.fromEntries([omzet, kpiSales(leads), behoud, capaciteit, operatie].map((k) => [k.id, k])),
    klanten: klanten.map((k) => ({ ...k, signalen: perKlant.get(k.name) ?? 0 })),
    opnames: [],
    signalen: signalen.slice(0, 6).map((s) => { const { orde, ...rest } = s; void orde; return rest; }),
    signalenTotaal: signalen.length,
    signalenBeschikbaar: board !== null,
    doelen: doelen ? { pijlers, week: doelen.weekOfQuarter, weken: doelen.totalWeeks } : null,
  };
}

export async function getLiveStand(subject: Viewer, rol: Rol, opts: { trusted?: boolean } = {}): Promise<LiveStand> {
  const today = todayAmsterdam();
  if (rol.key === "directie") return getDirectieStand(subject, Boolean(opts.trusted), today);
  const [kpiLijst, klanten, opnames, signalen] = await Promise.all([
    rol.key === "cc" ? kpisContentCreative(subject.id, today) : kpisVideograaf(subject.id, today),
    rol.key === "cc" ? mijnKlanten(subject.id, today) : Promise.resolve([]),
    rol.key === "videograaf" ? mijnOpnames(subject.id, today) : Promise.resolve([]),
    mijnSignalen(subject, Boolean(opts.trusted), today),
  ]);
  return {
    kpis: Object.fromEntries(kpiLijst.map((k) => [k.id, k])),
    klanten: klanten.map((k) => ({ ...k, signalen: signalen.perKlant.get(k.name) ?? 0 })),
    opnames,
    signalen: signalen.lijst,
    signalenTotaal: signalen.totaal,
    signalenBeschikbaar: signalen.ok,
  };
}
