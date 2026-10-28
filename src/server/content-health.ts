import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireInternal } from "@/server/auth/context";

/**
 * Automatische contentgezondheidscheck per klant (proactief). Bundelt bestaande
 * signalen tot één per-klant status (groen/oranje/rood) over vier pijlers —
 * planning, resultaten, variatie en productie — met telkens de oorzakende factor
 * én een concreet verbetervoorstel. Volledig deterministisch met transparante
 * regels (zoals risk.ts en computeProfitabilitySignals), zodat het ook zonder
 * AI-sleutel werkt; de nachtelijke job kan het voorstel optioneel met AI
 * aanscherpen. Alle cijfers komen uit bestaande tabellen — niets verzonnen; waar
 * data ontbreekt wordt de pijler overgeslagen i.p.v. geschat.
 *
 * `trusted` = aangeroepen vanuit een vertrouwde server-job (cron) zonder sessie.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const num = (v: unknown) => Number(v ?? 0);

/* -------------------------------------------------------------- drempels */
// Planning: hoeveel van de komende 8 weken content ingepland hebben.
const PLANNING_WEKEN_VENSTER = 8;
const PLANNING_LETOP = 3; // < 3 weken gevuld → aandacht
// Resultaten: groei (laatste 30d vs 30d daarvoor).
const RESULTAAT_LETOP = -20; // ≤ −20% → aandacht
const RESULTAAT_ACTIE = -40; // ≤ −40% → actie
// Variatie: aandeel van de meest gebruikte pijler/format in recente scripts.
const VARIATIE_MIN_SCRIPTS = 5;
const VARIATIE_LETOP = 0.8; // ≥ 80% hetzelfde → weinig afwisseling
// Productie: openstaande opleveringen over de deadline.
const PRODUCTIE_LETOP = 1;
const PRODUCTIE_ACTIE = 3;

const DELIVERABLE_KLAAR = ["published", "approved", "scheduled", "ready_to_publish", "analysis_available"];

export type HealthLevel = "groen" | "oranje" | "rood";
export type PillarKey = "planning" | "resultaten" | "variatie" | "productie";

export type HealthFactor = {
  pijler: PillarKey;
  level: "let_op" | "actie";
  titel: string;
  oorzaak: string;
  voorstel: string;
};

export type ClientHealth = {
  clientId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  status: HealthLevel;
  score: number; // hoger = ongezonder (voor sortering)
  factors: HealthFactor[];
  metrics: {
    planningWeken: number | null; // null = klant plaatst zelf (geen posting-signaal)
    volgendeOpname: string | null;
    groeiPct: number | null; // null = geen resultaatdata via de koppeling
    variatieAandeel: number | null; // null = te weinig scripts
    variatieLabel: string | null;
    overdue: number;
    recenteScripts: number;
  };
};

export type HealthOverview = {
  generatedAt: string;
  rows: ClientHealth[];
  counts: { groen: number; oranje: number; rood: number };
};

/** ISO-weeksleutel (maandag) van een datumstring, voor het tellen van gevulde weken. */
function weekKey(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  planning: "Contentplanning",
  resultaten: "Resultaten",
  variatie: "Contentvariatie",
  productie: "Productie",
};

export { PILLAR_LABEL };

/**
 * Bepaalt de gezondheid van alle actieve klanten. Eén query per bron, daarna in
 * JS gecombineerd — zodat de regels op één plek staan en overal identiek zijn.
 */
export async function getContentHealth(trusted = false): Promise<HealthOverview> {
  if (!trusted) await requireInternal();

  const [clientRes, planRes, shootRes, metricRes, scriptRes, overdueRes] = await Promise.all([
    db.execute(sql`
      select c.id, c.slug, c.name, c.logo_url as "logoUrl", c.color,
             c.coordinator_id as "coordinatorId", c.we_handle_posting as "weHandlePosting",
             u.full_name as "coordinatorName"
      from clients c
      left join users u on u.id = c.coordinator_id
      where c.deleted_at is null and c.status = 'active'
      order by c.name
    `),
    // Geplande publicaties in de komende 8 weken (contentplanning).
    db.execute(sql`
      select client_id as "clientId", scheduled_on::text as d
      from content_calendar
      where deleted_at is null
        and scheduled_on >= current_date
        and scheduled_on < current_date + (${PLANNING_WEKEN_VENSTER} * 7) * interval '1 day'
    `),
    // Eerstvolgende geplande opname per klant.
    db.execute(sql`
      select client_id as "clientId", min(scheduled_on)::text as "next"
      from production_days
      where deleted_at is null and status <> 'cancelled' and scheduled_on >= current_date
      group by client_id
    `),
    // Weergaven laatste 30 dagen vs. de 30 dagen daarvoor (betrouwbaar: daily_metrics).
    db.execute(sql`
      select client_id as "clientId",
             coalesce(sum(case when measured_on >= current_date - interval '30 days' then views else 0 end),0)::bigint as cur,
             coalesce(sum(case when measured_on >= current_date - interval '60 days' and measured_on < current_date - interval '30 days' then views else 0 end),0)::bigint as prev,
             count(*)::int as dagen
      from daily_metrics
      where measured_on >= current_date - interval '60 days'
      group by client_id
    `),
    // Recente scripts voor de variatie-analyse (pijler/format).
    db.execute(sql`
      select client_id as "clientId", pillar, format
      from scripts
      where deleted_at is null and created_at >= now() - interval '120 days'
    `),
    // Openstaande opleveringen over de deadline.
    db.execute(sql`
      select client_id as "clientId", count(*)::int as n
      from deliverables
      where deleted_at is null and due_on is not null and due_on < current_date
        and status not in (${sql.join(DELIVERABLE_KLAAR.map((s) => sql`${s}`), sql`, `)})
      group by client_id
    `),
  ]);

  const clientRows = rows<{ id: string; slug: string; name: string; logoUrl: string | null; color: string | null; coordinatorId: string | null; weHandlePosting: boolean; coordinatorName: string | null }>(clientRes);

  // Planning → gevulde weken per klant.
  const weeksByClient = new Map<string, Set<string>>();
  for (const r of rows<{ clientId: string; d: string }>(planRes)) {
    if (!weeksByClient.has(r.clientId)) weeksByClient.set(r.clientId, new Set());
    weeksByClient.get(r.clientId)!.add(weekKey(r.d));
  }
  const shootByClient = new Map(rows<{ clientId: string; next: string }>(shootRes).map((r) => [r.clientId, r.next]));
  const metricByClient = new Map(rows<{ clientId: string; cur: string; prev: string; dagen: number }>(metricRes).map((r) => [r.clientId, r]));
  const overdueByClient = new Map(rows<{ clientId: string; n: number }>(overdueRes).map((r) => [r.clientId, num(r.n)]));

  // Scripts → aandeel van de meest voorkomende pijler/format per klant.
  const scriptsByClient = new Map<string, { pillars: string[]; formats: string[] }>();
  for (const r of rows<{ clientId: string; pillar: string | null; format: string | null }>(scriptRes)) {
    if (!scriptsByClient.has(r.clientId)) scriptsByClient.set(r.clientId, { pillars: [], formats: [] });
    const bucket = scriptsByClient.get(r.clientId)!;
    if (r.pillar) bucket.pillars.push(r.pillar.toLowerCase().trim());
    if (r.format) bucket.formats.push(r.format.toLowerCase().trim());
  }
  const dominant = (list: string[]): { share: number; value: string } | null => {
    if (list.length === 0) return null;
    const counts = new Map<string, number>();
    for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = "", max = 0;
    for (const [v, c] of counts) if (c > max) { max = c; best = v; }
    return { share: max / list.length, value: best };
  };

  const out: ClientHealth[] = clientRows.map((c) => {
    const factors: HealthFactor[] = [];

    /* Pijler 1 — Planning (alleen als Shortclips voor deze klant plaatst). */
    const planningWeken = c.weHandlePosting ? (weeksByClient.get(c.id)?.size ?? 0) : null;
    const volgendeOpname = shootByClient.get(c.id) ?? null;
    if (planningWeken !== null) {
      if (planningWeken === 0) {
        factors.push({
          pijler: "planning", level: "actie",
          titel: "Geen content ingepland",
          oorzaak: `Er staat niets in de contentplanning voor de komende ${PLANNING_WEKEN_VENSTER} weken.`,
          voorstel: "Plan samen met de klant de komende weken in: kies onderwerpen en zet publicatiedata in de contentplanning.",
        });
      } else if (planningWeken < PLANNING_LETOP) {
        factors.push({
          pijler: "planning", level: "let_op",
          titel: "Planning raakt leeg",
          oorzaak: `Slechts ${planningWeken} van de komende ${PLANNING_WEKEN_VENSTER} weken hebben content ingepland.`,
          voorstel: "Vul de planning 6–8 weken vooruit aan, zodat er geen gat valt en opnames op tijd gepland kunnen worden.",
        });
      }
      if (!volgendeOpname) {
        factors.push({
          pijler: "planning", level: "let_op",
          titel: "Geen opname gepland",
          oorzaak: "Er staat geen toekomstige opnamedag gepland voor deze klant.",
          voorstel: "Plan een opnamedag in om de contentvoorraad op peil te houden.",
        });
      }
    }

    /* Pijler 2 — Resultaten (alleen als er resultaatdata via de koppeling is). */
    const m = metricByClient.get(c.id);
    const cur = m ? num(m.cur) : 0;
    const prev = m ? num(m.prev) : 0;
    const groeiPct = m && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    if (groeiPct !== null) {
      if (groeiPct <= RESULTAAT_ACTIE) {
        factors.push({
          pijler: "resultaten", level: "actie",
          titel: "Resultaten vallen sterk terug",
          oorzaak: `De weergaven daalden ${Math.abs(groeiPct)}% t.o.v. de voorgaande 30 dagen.`,
          voorstel: "Analyseer welke hooks/formats eerder wél werkten en stuur de content daarop bij; bespreek de koers met de klant.",
        });
      } else if (groeiPct <= RESULTAAT_LETOP) {
        factors.push({
          pijler: "resultaten", level: "let_op",
          titel: "Resultaten lopen terug",
          oorzaak: `De weergaven daalden ${Math.abs(groeiPct)}% t.o.v. de voorgaande 30 dagen.`,
          voorstel: "Bekijk de best presterende video's en herhaal die aanpak (hook, onderwerp, format) in de komende content.",
        });
      }
    }

    /* Pijler 3 — Variatie (alleen bij genoeg recente scripts). */
    const sc = scriptsByClient.get(c.id) ?? { pillars: [], formats: [] };
    const recenteScripts = Math.max(sc.pillars.length, sc.formats.length);
    let variatieAandeel: number | null = null;
    let variatieLabel: string | null = null;
    if (recenteScripts >= VARIATIE_MIN_SCRIPTS) {
      const dp = dominant(sc.pillars);
      const df = dominant(sc.formats);
      const top = dp && df ? (dp.share >= df.share ? { ...dp, soort: "pijler" } : { ...df, soort: "format" }) : dp ? { ...dp, soort: "pijler" } : df ? { ...df, soort: "format" } : null;
      if (top) {
        variatieAandeel = Math.round(top.share * 100);
        variatieLabel = `${top.value} (${top.soort})`;
        if (top.share >= VARIATIE_LETOP) {
          factors.push({
            pijler: "variatie", level: "let_op",
            titel: "Weinig afwisseling",
            oorzaak: `${variatieAandeel}% van de recente scripts gebruikt dezelfde ${top.soort} ("${top.value}").`,
            voorstel: "Wissel onderwerpen, hooks en formats af — voeg een ander contenttype toe om de doelgroep fris te houden.",
          });
        }
      }
    }

    /* Pijler 4 — Productie (openstaande opleveringen over de deadline). */
    const overdue = overdueByClient.get(c.id) ?? 0;
    if (overdue >= PRODUCTIE_ACTIE) {
      factors.push({
        pijler: "productie", level: "actie",
        titel: "Meerdere opleveringen te laat",
        oorzaak: `${overdue} opleveringen staan over de afgesproken deadline.`,
        voorstel: "Loop de achterstand na met de editor, herplan realistisch en informeer de klant proactief.",
      });
    } else if (overdue >= PRODUCTIE_LETOP) {
      factors.push({
        pijler: "productie", level: "let_op",
        titel: "Oplevering te laat",
        oorzaak: `${overdue} oplevering${overdue === 1 ? " staat" : "en staan"} over de deadline.`,
        voorstel: "Pak de te late oplevering op of herplan de deadline in overleg.",
      });
    }

    const heeftActie = factors.some((f) => f.level === "actie");
    const heeftLetOp = factors.some((f) => f.level === "let_op");
    const status: HealthLevel = heeftActie ? "rood" : heeftLetOp ? "oranje" : "groen";
    const score = factors.reduce((s, f) => s + (f.level === "actie" ? 100 : 10), 0);

    return {
      clientId: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl, color: c.color,
      coordinatorId: c.coordinatorId, coordinatorName: c.coordinatorName,
      status, score, factors,
      metrics: { planningWeken, volgendeOpname, groeiPct, variatieAandeel, variatieLabel, overdue, recenteScripts },
    };
  });

  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const counts = { groen: 0, oranje: 0, rood: 0 };
  for (const r of out) counts[r.status]++;

  return { generatedAt: new Date().toISOString(), rows: out, counts };
}

/* ---------------------------------------------------------- auto-taken */

export type HealthTask = {
  clientId: string;
  clientName: string;
  coordinatorId: string | null;
  priority: "normal" | "high";
  pijler: PillarKey;
  titel: string;
  oorzaak: string;
  voorstel: string;
  dedupeKey: string;
};

/**
 * Leidt uit de gezondheidscheck de automatische taken af: alleen de écht
 * urgente factoren (level "actie"), per klant/pijler, met een wekelijkse
 * dedupe-sleutel zodat dezelfde taak nooit dubbel ontstaat. Toegewezen aan de
 * verantwoordelijke coördinator. Gedeeld door de job (aanmaken) — de regels
 * blijven zo op één plek.
 */
export function computeHealthTasks(overview: HealthOverview, dedupeSuffix: string): HealthTask[] {
  const out: HealthTask[] = [];
  for (const c of overview.rows) {
    for (const f of c.factors) {
      if (f.level !== "actie") continue; // alleen urgente problemen worden een taak
      // Op verzoek géén dagelijkse taak meer voor deze twee (te veel ruis op het
      // Taken-overzicht). Ze blijven wel zichtbaar in de gezondheidscheck zelf.
      if (f.titel === "Geen content ingepland" || f.titel === "Resultaten vallen sterk terug") continue;
      out.push({
        clientId: c.clientId,
        clientName: c.name,
        coordinatorId: c.coordinatorId,
        priority: "high",
        pijler: f.pijler,
        titel: `${c.name}: ${f.titel}`,
        oorzaak: f.oorzaak,
        voorstel: f.voorstel,
        dedupeKey: `content_health:${c.clientId}:${f.pijler}:${dedupeSuffix}`,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------- hulp signaleren */

const EDITING_STATES = ["editing", "editor_revision", "awaiting_editor"];

export type OverloadedPerson = {
  userId: string;
  name: string;
  role: string | null;
  unitLabel: string;
  load: number | null;
  green: number | null;
  occupancy: number | null;
  overdueTasks: number;
  reasons: string[];
  level: "hoog" | "kritiek";
};

/**
 * Signaleert medewerkers die (te) zwaar belast zijn, zodat werk herverdeeld kan
 * worden vóórdat deadlines sneuvelen. Combineert bestaande bronnen: de
 * capaciteitsgrenzen (capacity_people), de actuele werklast (edits in bewerking /
 * opnames gepland) en openstaande taken over de deadline. Geen nieuwe meetlogica.
 */
export async function getOverloadedPeople(trusted = false): Promise<OverloadedPerson[]> {
  if (!trusted) await requireInternal();

  const [peopleRes, editRes, shootRes, taskRes] = await Promise.all([
    db.execute(sql`
      select cp.user_id as "userId", cp.name, cp.role, cp.unit,
             cp.limit_green as "green", cp.limit_orange as "orange", cp.limit_max as "max",
             u.full_name as "fullName"
      from capacity_people cp
      join users u on u.id = cp.user_id
      where cp.user_id is not null and u.deleted_at is null and u.status = 'active'
        and cp.unit in ('shorts_4w','opnames_4w')
    `),
    db.execute(sql`
      select editor_id as "userId", count(*)::int as n
      from deliverables
      where deleted_at is null and editor_id is not null
        and status in (${sql.join(EDITING_STATES.map((s) => sql`${s}`), sql`, `)})
      group by editor_id
    `),
    db.execute(sql`
      select videographer_id as "userId", count(*)::int as n
      from production_days
      where deleted_at is null and status <> 'cancelled' and videographer_id is not null
        and scheduled_on between current_date and current_date + interval '28 days'
      group by videographer_id
    `),
    db.execute(sql`
      select assignee_id as "userId", count(*)::int as n
      from tasks
      where deleted_at is null and assignee_id is not null
        and status <> 'done' and due_on is not null and due_on < current_date
      group by assignee_id
    `),
  ]);

  const editMap = new Map(rows<{ userId: string; n: number }>(editRes).map((r) => [r.userId, num(r.n)]));
  const shootMap = new Map(rows<{ userId: string; n: number }>(shootRes).map((r) => [r.userId, num(r.n)]));
  const taskMap = new Map(rows<{ userId: string; n: number }>(taskRes).map((r) => [r.userId, num(r.n)]));

  const TASK_LETOP = 4; // ≥ 4 taken over de deadline → meetellen als overbelasting
  const out: OverloadedPerson[] = [];

  for (const p of rows<{ userId: string; name: string; role: string | null; unit: string; green: string | null; orange: string | null; max: string | null; fullName: string }>(peopleRes)) {
    const load = p.unit === "shorts_4w" ? (editMap.get(p.userId) ?? 0) : (shootMap.get(p.userId) ?? 0);
    const green = p.green != null ? Number(p.green) : null;
    const orange = p.orange != null ? Number(p.orange) : null;
    const max = p.max != null ? Number(p.max) : null;
    const overdueTasks = taskMap.get(p.userId) ?? 0;
    const occupancy = load !== null && green ? Math.round((load / green) * 100) : null;
    const unitLabel = p.unit === "shorts_4w" ? "shorts in bewerking" : "opnames komende 4 weken";

    // Zelfde realistische banden als Teamcapaciteit: rood (kritiek) pas boven het
    // plafond (max/oranje, met terugval 50% boven groen) — niet al zodra iemand
    // nét boven de comfortabele groene grens zit.
    const ceiling = green !== null && green > 0 ? (max && max > green ? max : orange && orange > green ? orange : green * 1.5) : null;
    const reasons: string[] = [];
    let level: "hoog" | "kritiek" | null = null;
    if (green !== null && load > green) {
      if (ceiling !== null && load > ceiling) { level = "kritiek"; reasons.push(`${load} ${unitLabel} — ${occupancy}% van de comfortabele grens (${green}), boven het plafond.`); }
      else { level = "hoog"; reasons.push(`${load} ${unitLabel} — ${occupancy}% van de comfortabele grens (${green}).`); }
    }
    if (overdueTasks >= TASK_LETOP) {
      reasons.push(`${overdueTasks} taken staan over de deadline.`);
      if (!level) level = "hoog";
      else if (level === "hoog") level = "kritiek";
    }
    if (!level) continue;

    out.push({
      userId: p.userId, name: p.fullName || p.name, role: p.role, unitLabel,
      load, green, occupancy, overdueTasks, reasons, level,
    });
  }

  const order = { kritiek: 0, hoog: 1 } as const;
  out.sort((a, b) => order[a.level] - order[b.level] || (b.occupancy ?? 0) - (a.occupancy ?? 0));
  return out;
}
