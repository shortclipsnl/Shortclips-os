import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { CORE_STAFF_EMAILS } from "@/server/core-staff";
import { getNumberSetting } from "@/server/app-settings";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays } from "@/lib/workdays";
import {
  RETENTION_DEFAULTS, clientHealth, commercialFollowUp, contractMoment, coverFor, evaluateResults, platformLabel, routeSignal,
  suggestFeedback, FEEDBACK_CATEGORY_LABEL,
  type ContractMoment, type DailyRow, type FeedbackCategory, type FeedbackKind, type HealthStatus, type OpenFeedback,
  type ResultsVerdict, type StaffKey, type VideoRow,
} from "@/lib/client-retention";

/**
 * Klantbehoud: past de regels uit `src/lib/client-retention.ts` toe op de
 * echte gegevens. Eén plek die bepaalt per actieve klant:
 *  - hoe de resultaten zich ontwikkelen (Metricool-koppeling, per platform);
 *  - welke klachten openstaan (geregistreerde klantfeedback);
 *  - waar het contract staat (opzegdeadline/einddatum, gecontroleerd of niet);
 *  - de klantgezondheid (tevredenheid) en, apart, de commerciële opvolging;
 *  - wie verantwoordelijk is, rekening houdend met afwezigheid.
 * Aandachtspunten, de klantenpagina's en de nachtelijke taken lezen allemaal
 * hieruit, zodat het overal hetzelfde zegt.
 */

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export const RETENTION_DROP_SETTING = "retention.results_drop_pct";

export type RetentionFeedback = {
  id: string;
  kind: FeedbackKind;
  category: FeedbackCategory;
  source: string;
  summary: string;
  followUp: string;
  dueOn: string;
  status: string;
  ownerId: string | null;
  createdAt: string;
};

export type ClientRetention = {
  clientId: string;
  name: string;
  slug: string;
  coordinatorId: string | null;
  coordinatorKey: StaffKey | null;
  results: ResultsVerdict;
  contract: ContractMoment & { contractId: string | null; startsOn: string | null; endsOn: string | null; autoRenew: boolean | null; noticePeriodDays: number | null; verified: boolean; ownerManaged: boolean };
  openFeedback: RetentionFeedback[];
  health: { status: HealthStatus; reasons: string[] };
  commercial: ReturnType<typeof commercialFollowUp>;
  /** Resultaten niet gemeten (geen koppeling): wel tonen, geen statusverlaging. */
  notMeasured: boolean;
};

export type RetentionContext = {
  today: string;
  staff: Map<StaffKey, string>;
  staffKeyById: Map<string, StaffKey>;
  absent: Set<StaffKey>;
  /** Verantwoordelijke ná vervanging. */
  ownerFor: (key: StaffKey) => string | null;
  dropPct: number;
};

export async function retentionContext(today = new Date().toISOString().slice(0, 10)): Promise<RetentionContext> {
  const staffRows = rows<{ id: string; email: string }>(await db.execute(sql`
    select id, lower(email) as email from users where deleted_at is null and lower(email) in (${sql.join(CORE_STAFF_EMAILS.map((e) => sql`${e}`), sql`, `)})
  `));
  const staff = new Map<StaffKey, string>();
  const staffKeyById = new Map<string, StaffKey>();
  for (const r of staffRows) {
    const k = r.email.split("@")[0] as StaffKey;
    staff.set(k, r.id);
    staffKeyById.set(r.id, k);
  }
  const leave = rows<{ userId: string }>(await db.execute(sql`
    select user_id as "userId" from leave_requests
    where status = 'approved' and start_on <= ${today}::date and end_on >= ${today}::date
  `));
  const absent = new Set<StaffKey>(leave.map((l) => staffKeyById.get(l.userId)).filter((k): k is StaffKey => !!k));
  const dropPct = await getNumberSetting(RETENTION_DROP_SETTING, RETENTION_DEFAULTS.dropPct);
  return {
    today, staff, staffKeyById, absent, dropPct,
    ownerFor: (key) => staff.get(coverFor(key, absent)) ?? staff.get(key) ?? null,
  };
}

/**
 * Klantbehoud-overzicht van alle actieve klanten (of een selectie). Alleen
 * aanroepen vanuit code die zelf de toegang al heeft gecontroleerd.
 */
export async function getRetentionOverview(ctx: RetentionContext, clientIds?: string[]): Promise<ClientRetention[]> {
  const W = RETENTION_DEFAULTS.windowDays;
  const from = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 2 * W * 864e5).toISOString().slice(0, 10);
  const only = clientIds?.length ? sql`and c.id in (${sql.join(clientIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;

  const [clientRes, dailyRes, videoRes, integRes, contractRes, feedbackRes] = await Promise.all([
    db.execute(sql`
      select c.id, c.name, c.slug, c.coordinator_id as "coordinatorId"
      from clients c where c.deleted_at is null and c.status in ('active','onboarding') ${only} order by c.name
    `),
    db.execute(sql`
      select dm.client_id as "clientId", coalesce(dm.platform::text,'onbekend') as platform, dm.measured_on as "measuredOn",
             dm.views, dm.reach, dm.engagements, dm.follower_delta as "followerDelta"
      from daily_metrics dm join clients c on c.id = dm.client_id
      where dm.measured_on >= ${from}::date and c.deleted_at is null ${only}
    `),
    // Video's met hun laatst gemeten weergaven (de laatste meetdag per publicatie).
    db.execute(sql`
      select p.client_id as "clientId", p.platform::text as platform, p.published_at as "publishedAt",
             coalesce(p.caption, '') as title, p.external_url as href,
             (select sm.views from social_metrics sm where sm.publication_id = p.id order by sm.measured_on desc limit 1) as views
      from publications p join clients c on c.id = p.client_id
      where p.deleted_at is null and p.published_at is not null and p.published_at >= ${from}::date and c.deleted_at is null ${only}
    `),
    db.execute(sql`
      select distinct c.id as "clientId" from clients c
      where c.deleted_at is null ${only} and (
        exists (select 1 from social_accounts sa where sa.client_id = c.id and sa.is_active)
        or exists (select 1 from daily_metrics dm where dm.client_id = c.id)
      )
    `),
    // Het lopende contract per klant (meest recente start).
    db.execute(sql`
      select distinct on (k.client_id) k.client_id as "clientId", k.id, k.starts_on as "startsOn", k.ends_on as "endsOn",
             k.notice_period_days as "noticePeriodDays", k.auto_renew as "autoRenew", k.verified_at as "verifiedAt", k.owner_managed as "ownerManaged"
      from contracts k join clients c on c.id = k.client_id
      where k.deleted_at is null and k.status in ('active','notice_given') and c.deleted_at is null ${only}
      order by k.client_id, k.starts_on desc nulls last, k.created_at desc
    `),
    db.execute(sql`
      select f.id, f.client_id as "clientId", f.kind, f.category, f.source, f.summary, f.follow_up as "followUp",
             f.due_on as "dueOn", f.status, f.owner_id as "ownerId", f.created_at as "createdAt"
      from client_feedback f join clients c on c.id = f.client_id
      where f.deleted_at is null and f.status <> 'opgelost' and f.kind in ('aandacht','ernstig') and c.deleted_at is null ${only}
      order by f.created_at
    `),
  ]);

  const group = <T extends { clientId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const daily = group(rows<{ clientId: string; platform: string; measuredOn: unknown; views: number; reach: number; engagements: number; followerDelta: number }>(dailyRes));
  const videos = group(rows<{ clientId: string; platform: string; publishedAt: unknown; title: string; href: string | null; views: number | null }>(videoRes));
  const integrated = new Set(rows<{ clientId: string }>(integRes).map((r) => r.clientId));
  const contracts = new Map(rows<{ clientId: string; id: string; startsOn: unknown; endsOn: unknown; noticePeriodDays: number | null; autoRenew: boolean | null; verifiedAt: unknown; ownerManaged: boolean | null }>(contractRes).map((r) => [r.clientId, r]));
  const feedback = group(rows<{ clientId: string; id: string; kind: FeedbackKind; category: FeedbackCategory; source: string; summary: string; followUp: string; dueOn: unknown; status: string; ownerId: string | null; createdAt: unknown }>(feedbackRes));

  return rows<{ id: string; name: string; slug: string; coordinatorId: string | null }>(clientRes).map((c) => {
    const d: DailyRow[] = (daily.get(c.id) ?? []).map((r) => ({
      platform: r.platform, measuredOn: iso(r.measuredOn)!, views: Number(r.views), reach: Number(r.reach),
      engagements: Number(r.engagements), followerDelta: Number(r.followerDelta),
    }));
    const v: VideoRow[] = (videos.get(c.id) ?? []).map((r) => ({
      platform: r.platform, publishedOn: new Date(r.publishedAt as string).toISOString().slice(0, 10),
      views: r.views == null ? null : Number(r.views), title: r.title.split("\n")[0].slice(0, 80) || "Video", href: r.href ?? undefined,
    }));
    const results = evaluateResults({ today: ctx.today, daily: d, videos: v, hasIntegration: integrated.has(c.id), settings: { dropPct: ctx.dropPct } });

    const k = contracts.get(c.id);
    const verified = !!k?.verifiedAt;
    const moment = contractMoment(k ? { startsOn: iso(k.startsOn), endsOn: iso(k.endsOn), noticePeriodDays: k.noticePeriodDays, autoRenew: k.autoRenew, verified } : null, ctx.today);

    const fb: RetentionFeedback[] = (feedback.get(c.id) ?? []).map((f) => ({
      id: f.id, kind: f.kind, category: f.category, source: f.source, summary: f.summary, followUp: f.followUp,
      dueOn: iso(f.dueOn)!, status: f.status, ownerId: f.ownerId, createdAt: new Date(f.createdAt as string).toISOString(),
    }));
    const open: OpenFeedback[] = fb.map((f) => ({ kind: f.kind, category: f.category, createdOn: f.createdAt.slice(0, 10), summary: f.summary }));

    // Contractgegevens zijn commerciële opvolging en tellen niet mee voor de
    // tevredenheid (die staan apart bij het contractmoment). "Niet gemeten" (geen
    // koppeling) evenmin, anders staat bijna elke klant op oranje zonder reden.
    const health = clientHealth({ results, openFeedback: open, dataIssues: [] });
    const notMeasured = results.state === "geen_koppeling";
    if (notMeasured) health.reasons.push("Resultaten worden niet gemeten (geen koppeling).");

    return {
      clientId: c.id, name: c.name, slug: c.slug, coordinatorId: c.coordinatorId,
      coordinatorKey: c.coordinatorId ? ctx.staffKeyById.get(c.coordinatorId) ?? null : null,
      results,
      contract: { ...moment, contractId: k?.id ?? null, startsOn: iso(k?.startsOn), endsOn: iso(k?.endsOn), autoRenew: k?.autoRenew ?? null, noticePeriodDays: k?.noticePeriodDays ?? null, verified, ownerManaged: k?.ownerManaged === true },
      openFeedback: fb, health, commercial: commercialFollowUp(moment), notMeasured,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Signalen voor Aandachtspunten
 * ------------------------------------------------------------------ */

/** Zelfde vorm als de items in quality.ts, zonder afhankelijkheid ervan. */
export type RetentionSignal = {
  id: string;
  clientName?: string;
  severity: "rood" | "oranje" | "blauw";
  category: string;
  title: string;
  detail: string;
  href: string;
  roles: string[];
  action: string;
  reason: string;
  priority: "hoog" | "normaal" | "laag";
  area: "klant" | "resultaat" | "overig";
  ownerId: string | null;
  dueOn: string;
  kids?: { label: string; sub: string; href?: string }[];
};

const ROLES = ["operational_manager", "project_coordinator", "content_creator"];
const fmt = (n: number) => n.toLocaleString("nl-NL");
const nlDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

export const RETENTION_CATEGORIES = {
  resultaten: "Resultaten lopen terug",
  feedback: "Klant ontevreden",
  ernstig: "Klantbehoud in gevaar",
  beoordelen: "Feedback beoordelen",
  contract: "Contractmoment",
  gegevens: "Gegevens ontbreken",
} as const;

/** Sleutel van het contractsignaal per fase; ook gebruikt om eerdere acties terug te vinden. */
export const contractSignalKey = (contractId: string, decisionDate: string, stage: string | number) =>
  `retentie-contract-${contractId}-${decisionDate}-${stage}`;

/**
 * Zet het overzicht om in aandachtspunten. Per klant en per soort maximaal één
 * punt (statistieken worden gegroepeerd), met een vaste sleutel zodat de status,
 * notities en meldingen blijven hangen. Verdwijnt het probleem, dan verdwijnt
 * het punt vanzelf.
 *
 * `actedOn` = sleutels waarop al actie is vastgelegd (notitie, opgepakt of
 * afgerond): nodig voor de 14-dagencontrole.
 */
export function retentionSignals(list: ClientRetention[], ctx: RetentionContext, actedOn: ReadonlySet<string>, pendingComments: PendingComment[] = []): RetentionSignal[] {
  const out: RetentionSignal[] = [];
  const holidays = nlHolidaySet();
  const inWorkdays = (n: number) => addWorkingDays(ctx.today, n, holidays);
  const month = ctx.today.slice(0, 7);
  const owner = (kind: Parameters<typeof routeSignal>[0], coord: StaffKey | null) => ctx.ownerFor(routeSignal(kind, coord));

  const staleData: { c: ClientRetention }[] = [];
  const contractData: { c: ClientRetention; urgent: boolean }[] = [];
  const notMeasured: ClientRetention[] = [];

  for (const c of list) {
    /* 1. Resultaten — één punt per klant per maand, alle dalende statistieken erin. */
    if (c.results.state === "daling") {
      const kids: { label: string; sub: string; href?: string }[] = c.results.platforms.flatMap((p) => p.declined.map((m) => ({
        label: `${platformLabel(p.platform)} · ${m.label}`,
        sub: `${fmt(m.prev)} → ${fmt(m.cur)}${m.key === "engagement" ? "%" : ""} (${m.pct}%)`,
      })));
      for (const w of c.results.weakVideos.slice(0, 3)) kids.push({ label: `Zwakke video: ${w.title}`, sub: `${fmt(w.views ?? 0)} weergaven`, href: w.href });
      const p = c.results.period;
      out.push({
        id: `retentie-resultaten-${c.clientId}-${month}`, clientName: c.name, severity: "oranje", category: RETENTION_CATEGORIES.resultaten,
        title: `Let op: resultaten van ${c.name} lopen terug`,
        detail: `${c.results.summary} Vergeleken: ${nlDate(p.curFrom)}–${nlDate(p.curTo)} tegenover ${nlDate(p.prevFrom)}–${nlDate(p.prevTo)}. Bekijk de resultaten en bepaal welke verbeteringen nodig zijn voor de volgende contentproductie. Leg je verbeteractie vast als notitie voordat je afrondt.`,
        href: `/analytics/${c.slug}`, roles: ROLES,
        action: "Resultaten analyseren en verbeteractie vastleggen", reason: c.results.summary,
        priority: "normaal", area: "resultaat", ownerId: owner("resultaten", c.coordinatorKey), dueOn: inWorkdays(5), kids,
      });
    } else if (c.results.state === "verouderd") staleData.push({ c });
    else if (c.notMeasured) notMeasured.push(c);

    /* 2. Geregistreerde klachten — elk een eigen punt (bundelen per klant gebeurt in quality.ts). */
    for (const f of c.openFeedback) {
      const serious = f.kind === "ernstig";
      const kind = f.category === "techniek" ? "techniek" : "feedback";
      const ownerKey = f.ownerId ? ctx.staffKeyById.get(f.ownerId) ?? null : null;
      const ownerId = ownerKey ? ctx.ownerFor(ownerKey) : owner(kind, c.coordinatorKey);
      const overdue = f.dueOn < ctx.today;
      out.push({
        id: `retentie-feedback-${f.id}`, clientName: c.name, severity: serious ? "rood" : "oranje",
        category: serious ? RETENTION_CATEGORIES.ernstig : RETENTION_CATEGORIES.feedback,
        title: `${c.name}: ${f.summary}`,
        detail: `${FEEDBACK_CATEGORY_LABEL[f.category]} · vervolgactie: ${f.followUp}${serious ? " Valt de oplossing buiten je bevoegdheid (bijv. klant wil stoppen, korting, gratis werk), volg dan de Beslissingshulp." : ""}`,
        href: `/clients/${c.slug}?tab=klantbehoud`, roles: ROLES,
        action: f.followUp.length > 90 ? `${f.followUp.slice(0, 87)}…` : f.followUp,
        reason: `${serious ? "Ernstig" : "Klacht"}: ${f.summary}${overdue ? ` · deadline ${nlDate(f.dueOn)} verstreken` : ` · uiterlijk ${nlDate(f.dueOn)}`}`,
        priority: serious || f.dueOn <= ctx.today ? "hoog" : "normaal", area: "klant", ownerId, dueOn: f.dueOn,
      });
    }

    /* 3. Contractmomenten — commerciële opvolging, los van tevredenheid. */
    const k = c.contract;
    if (k.issues.length) contractData.push({ c, urgent: k.stage === 30 || k.stage === 14 || k.stage === "voorbij" });
    if (k.contractId && k.decisionDate && k.stage !== null && !(k.stage === "voorbij" && !k.verified)) {
      const unsure = k.verified ? "" : " (contractgegevens nog niet gecontroleerd)";
      const when = `${k.decisionLabel === "opzegdeadline" ? "Opzegdeadline" : "Einddatum"} ${nlDate(k.decisionDate)}`;
      const base = { clientName: c.name, category: RETENTION_CATEGORIES.contract, href: `/clients/${c.slug}?tab=klantbehoud`, roles: ROLES, area: "overig" as const, ownerId: owner("contract", c.coordinatorKey) };
      const acted = (stage: number) => actedOn.has(contractSignalKey(k.contractId!, k.decisionDate!, stage));
      if (k.stage === 60) {
        out.push({ ...base, id: contractSignalKey(k.contractId, k.decisionDate, 60), severity: "blauw", title: `${c.name}: contractmoment over ${k.daysToDecision} dagen`,
          detail: `${when}${unsure}. Beoordeel de klantrelatie en de resultaten, zodat je over een maand goed voorbereid het gesprek ingaat.`,
          action: "Klantrelatie en resultaten beoordelen", reason: `${when} · over ${k.daysToDecision} dagen${unsure}`, priority: "laag", dueOn: addWorkingDays(ctx.today, 10, holidays) });
      } else if (k.stage === 30) {
        out.push({ ...base, id: contractSignalKey(k.contractId, k.decisionDate, 30), severity: "oranje", title: `${c.name}: contact opnemen over de samenwerking`,
          detail: `${when}${unsure}. Neem contact op en evalueer de samenwerking. Leg vast wat er is afgesproken.`,
          action: "Contact opnemen en samenwerking evalueren", reason: `${when} · over ${k.daysToDecision} dagen${unsure}`, priority: "normaal", dueOn: addWorkingDays(ctx.today, 5, holidays) });
      } else if (k.stage === 14 && !acted(30)) {
        out.push({ ...base, id: contractSignalKey(k.contractId, k.decisionDate, 14), severity: "rood", title: `${c.name}: nog geen actie op contractmoment`,
          detail: `${when}${unsure}, over ${k.daysToDecision} dagen. Er is nog geen contact of evaluatie vastgelegd. Neem vandaag contact op.`,
          action: "Nog geen actie vastgelegd: vandaag contact opnemen", reason: `${when} · over ${k.daysToDecision} dagen, geen actie vastgelegd${unsure}`, priority: "hoog", dueOn: ctx.today });
      } else if (k.stage === "voorbij") {
        out.push({ ...base, id: contractSignalKey(k.contractId, k.decisionDate, "voorbij"), severity: "oranje", title: `${c.name}: beslismoment contract gepasseerd`,
          detail: `${when} is gepasseerd en het contract loopt tot ${nlDate(k.endsOn!)}. Leg vast wat er met de klant is afgesproken (verlengd, gestopt of nieuw voorstel) en werk het contract bij.`,
          action: "Afspraak over verlenging vastleggen", reason: `${when} gepasseerd`, priority: "normaal", dueOn: addWorkingDays(ctx.today, 3, holidays) });
      }
    }
  }

  /* 4. Feedback die automatisch is herkend in Frame.io of scriptcontrole: alleen een voorstel om te beoordelen. */
  for (const pc of pendingComments) {
    const c = list.find((x) => x.clientId === pc.clientId);
    if (!c) continue;
    out.push({
      id: `retentie-check-${pc.commentId}`, clientName: c.name, severity: "blauw", category: RETENTION_CATEGORIES.beoordelen,
      title: `${c.name}: mogelijk ontevreden reactie`,
      detail: `Herkend in ${pc.source === "frame" ? "Frame.io" : "de scriptcontrole"}: "${pc.body.slice(0, 220)}". Dit is een automatische herkenning, geen conclusie. Is het een echte klacht, registreer hem dan bij de klant; is het een normale correctie, rond dit punt af.`,
      href: `/clients/${c.slug}?tab=klantbehoud`, roles: ROLES,
      action: "Beoordelen: normale correctie of klacht?", reason: `Herkend: "${pc.matched.join('", "')}"`,
      priority: "normaal", area: "klant", ownerId: owner(pc.category === "techniek" ? "techniek" : "feedback", c.coordinatorKey), dueOn: inWorkdays(2),
    });
  }

  /* 5. Ontbrekende gegevens — gebundeld tot één punt per soort, voor Jiska. */
  if (staleData.length) {
    out.push({
      id: `retentie-gegevens-resultaten-${month}`, severity: "oranje", category: RETENTION_CATEGORIES.gegevens,
      title: "Resultatenkoppeling levert geen nieuwe gegevens", detail: "Voor deze klanten komen geen actuele resultaten binnen, waardoor een daling niet gesignaleerd kan worden. Controleer de Metricool-koppeling (Instellingen > Koppelingen) of de accounts.",
      href: "/settings/integrations", roles: ROLES, action: `Resultatenkoppeling controleren (${staleData.length} ${staleData.length === 1 ? "klant" : "klanten"})`,
      reason: "Geen actuele resultaten", priority: "normaal", area: "overig", ownerId: ctx.ownerFor("jiska"), dueOn: inWorkdays(2),
      kids: staleData.map(({ c }) => ({ label: c.name, sub: c.results.lastMeasured ? `laatst ${nlDate(c.results.lastMeasured)}` : "nooit", href: `/analytics/${c.slug}` })),
    });
  }
  if (contractData.length) {
    const urgent = contractData.some((x) => x.urgent);
    out.push({
      id: "retentie-gegevens-contracten", severity: urgent ? "oranje" : "blauw", category: RETENTION_CATEGORIES.gegevens,
      title: "Contractgegevens controleren", detail: "Van deze klanten zijn de contractgegevens onvolledig of nog niet gecontroleerd tegen de getekende overeenkomst. Zolang dat zo is, kan het systeem verlengmomenten niet betrouwbaar signaleren. Controleer startdatum, einddatum, opzegtermijn en verlenging en klik op de klantpagina op Gegevens gecontroleerd.",
      href: "/clients", roles: ROLES,
      action: `Contractgegevens controleren (${contractData.length} ${contractData.length === 1 ? "klant" : "klanten"})`,
      reason: urgent ? "Bij een deel nadert het verlengmoment" : "Nodig voor betrouwbare verlengsignalen",
      priority: urgent ? "normaal" : "laag", area: "overig", ownerId: ctx.ownerFor("jiska"), dueOn: inWorkdays(urgent ? 3 : 10),
      kids: contractData.map(({ c, urgent: u }) => ({ label: c.name, sub: `${u ? "nadert · " : ""}${c.contract.issues.join(", ").toLowerCase()}`, href: `/clients/${c.slug}?tab=klantbehoud` })),
    });
  }
  if (notMeasured.length) {
    out.push({
      id: "retentie-gegevens-niet-gemeten", severity: "blauw", category: RETENTION_CATEGORIES.gegevens,
      title: "Klanten zonder resultatenkoppeling", detail: "Van deze actieve klanten komen geen resultaten binnen. Teruglopende resultaten kunnen voor hen dus niet automatisch worden gesignaleerd. Koppel hun accounts in Metricool als dat mogelijk is.",
      href: "/settings/integrations", roles: ROLES, action: `Resultaten koppelen (${notMeasured.length} klanten)`,
      reason: "Geen automatische resultatencontrole mogelijk", priority: "laag", area: "overig", ownerId: ctx.ownerFor("jiska"), dueOn: inWorkdays(15),
      kids: notMeasured.map((c) => ({ label: c.name, sub: "geen koppeling", href: `/analytics/${c.slug}` })),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Automatische herkenning in binnengekomen opmerkingen
 * ------------------------------------------------------------------ */

export type PendingComment = { commentId: string; clientId: string; source: "frame" | "script"; body: string; matched: string[]; category: FeedbackCategory };

/**
 * Klantreacties van de afgelopen 14 dagen (Frame.io en scriptcontrole) die
 * mogelijk ontevredenheid uitdrukken en nog niet als feedback zijn
 * geregistreerd. Alleen een voorstel: het team beoordeelt.
 */
export async function pendingFeedbackComments(clientIds: string[]): Promise<PendingComment[]> {
  if (!clientIds.length) return [];
  const ids = sql.join(clientIds.map((id) => sql`${id}::uuid`), sql`, `);
  const res = await db.execute(sql`
    select rc.id as "commentId", d.client_id as "clientId", 'frame' as source, rc.body
    from review_comments rc
    join review_threads rt on rt.id = rc.thread_id and rt.deleted_at is null
    join deliverables d on d.id = rt.deliverable_id
    where rc.deleted_at is null and rc.author_user_id is null and rc.created_at >= now() - interval '14 days' and d.client_id in (${ids})
    union all
    select c.id, sr.client_id, 'script', c.body
    from script_review_comments c
    join script_review_threads t on t.id = c.thread_id
    join script_reviews sr on sr.id = t.review_id
    where c.author_user_id is null and c.is_internal = false and c.created_at >= now() - interval '14 days' and sr.client_id in (${ids})
  `);
  const registered = new Set(rows<{ ref: string }>(await db.execute(sql`select source_ref as ref from client_feedback where source_ref is not null`)).map((r) => r.ref));
  const out: PendingComment[] = [];
  for (const r of rows<{ commentId: string; clientId: string; source: "frame" | "script"; body: string }>(res)) {
    if (registered.has(r.commentId)) continue;
    const s = suggestFeedback(r.body);
    if (s.kind === "correctie") continue;
    out.push({ ...r, matched: s.matched, category: s.category });
  }
  return out;
}

/** Sleutels waarop al actie is vastgelegd (notitie, opgepakt of afgerond). */
export async function actedOnKeys(prefix = "retentie-"): Promise<Set<string>> {
  const res = await db.execute(sql`
    select signal_key as key from attention_states
    where signal_key like ${prefix + "%"} and (status <> 'open' or jsonb_array_length(notes) > 0)
  `);
  return new Set(rows<{ key: string }>(res).map((r) => r.key));
}

/** Alles in één keer voor Aandachtspunten. */
export async function getRetentionSignals(clientScope?: string[] | null): Promise<RetentionSignal[]> {
  const ctx = await retentionContext();
  const list = await getRetentionOverview(ctx, clientScope ?? undefined);
  const scoped = clientScope ? list.filter((c) => clientScope.includes(c.clientId)) : list;
  const [acted, pending] = await Promise.all([actedOnKeys(), pendingFeedbackComments(scoped.map((c) => c.clientId))]);
  return retentionSignals(scoped, ctx, acted, pending);
}

/** Afgehandelde feedback van één klant (voor de historie op de klantpagina). */
export async function recentResolvedFeedback(clientId: string, limit = 8) {
  const res = await db.execute(sql`
    select f.id, f.kind, f.category, f.summary, f.resolution, f.resolved_at as "resolvedAt", u.full_name as "resolvedBy"
    from client_feedback f left join users u on u.id = f.resolved_by_id
    where f.client_id = ${clientId}::uuid and f.deleted_at is null and f.status = 'opgelost'
    order by f.resolved_at desc nulls last limit ${limit}
  `);
  return rows<{ id: string; kind: FeedbackKind; category: FeedbackCategory; summary: string; resolution: string | null; resolvedAt: unknown; resolvedBy: string | null }>(res)
    .map((r) => ({ ...r, resolvedAt: r.resolvedAt ? new Date(r.resolvedAt as string).toISOString() : null }));
}
