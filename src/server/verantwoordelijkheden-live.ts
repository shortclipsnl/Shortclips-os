import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Viewer } from "@/server/auth/context";
import { getAttentionBoard } from "@/server/attention";
import { addWorkingDays } from "@/lib/workdays";
import { todayAmsterdam } from "@/lib/planning-deadline";
import type { Rol } from "@/lib/verantwoordelijkheden/rol";

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

export async function getLiveStand(subject: Viewer, rol: Rol, opts: { trusted?: boolean } = {}): Promise<LiveStand> {
  const today = todayAmsterdam();
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
