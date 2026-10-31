import "server-only";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar, deliverables, productionDays, users } from "@/db/schema";
import { daysSince, daysUntil } from "@/lib/format";
import { workingDaysBetween } from "@/lib/workdays";
import { getDashboard } from "@/server/dashboard";
import { listEditingProjects } from "@/server/editing";
import { getShootDeadlines } from "@/server/shoot-deadlines";
import { getReviewQueue } from "@/server/videos";
import { listScripting } from "@/server/scripting";
import { getScreenData } from "@/server/screen";
import { integrationHealth } from "@/server/integrations/registry";
import { countOpenLinkSuggestions } from "@/server/link-review";
import { VIDEO_WAITING_ON, type VideoStage } from "@/lib/statuses";
import { isOwner, scopeToClients, type Viewer } from "@/server/auth/context";

/**
 * Centrale kwaliteitsbewaking: bundelt alle automatisch gesignaleerde punten tot
 * één actiegerichte lijst, per rol gefilterd. Elk item is concreet, heeft een
 * ernst (kleur) en een directe link. De signalen volgen de vaste catalogus:
 * productie & deadlines + algemene gezondheid (koppelingen, planning, resultaten).
 * Geen nieuwe meetlogica waar het al bestaat — hergebruikt de bestaande bronnen.
 */

export type QualitySeverity = "rood" | "oranje" | "blauw";
/** Actiegebied, zodat het team per soort werk kan sturen. */
export type QualityGroup = "scripting" | "editing" | "klant" | "planning" | "overig";
export type QualityItem = {
  id: string;
  severity: QualitySeverity;
  category: string;
  title: string;
  detail: string;
  href: string;
  /** Rollen waarvoor dit relevant is; eigenaar/admin zien alles. */
  roles: string[];
  /** Actiegebied (afgeleid van de categorie), voor de indeling op de pagina. */
  group?: QualityGroup;
  /** De klant waar dit punt over gaat, zodat de pagina links het klantlogo kan
   *  tonen en in één oogopslag scanbaar is welke klant het betreft. Leeg bij
   *  punten zonder klant (koppelingen, planninggaten). */
  clientName?: string;
  clientLogoUrl?: string | null;
  clientColor?: string | null;
};

/** Welke categorie hoort bij welk actiegebied. */
const GROUP_OF: Record<string, QualityGroup> = {
  "Scripts controleren": "scripting",
  "Deadline in gevaar": "editing",
  "Video over deadline": "editing",
  "Eerste versie verwacht": "editing",
  "Editor moet opleveren": "editing",
  "Video wacht op controle": "editing",
  "Feedback niet verwerkt": "editing",
  "Productiegegevens ontbreken": "editing",
  "Te laat bij klant": "klant",
  "Feedback ontbreekt": "klant",
  "Video klaar maar niet verstuurd": "klant",
  "Video niet gepubliceerd": "klant",
  "Klant vraagt aandacht": "klant",
  "Resultaten vallen terug": "klant",
  "Opname voorbereiden": "planning",
  "Geen opname gepland": "planning",
  "Planning onvoldoende gevuld": "planning",
  "Achter op afspraak": "planning",
  "Koppeling werkt niet": "overig",
  "Koppeling te bevestigen": "overig",
  "Contract loopt af": "overig",
  "Doel achter": "overig",
  "Doel risico": "overig",
  "Stand ontbreekt": "overig",
  "Doel gepland": "overig",
};
const groupOf = (category: string): QualityGroup => GROUP_OF[category] ?? "overig";

const CC = ["project_coordinator", "content_creator"];
const EDIT = ["project_coordinator", "editor"];
const SHOOT = ["project_coordinator", "videographer"];
const COORD = ["project_coordinator"];

// Pipelinestatussen waarin een video "in productie" is (niet af, niet geannuleerd).
const ACTIVE_EDIT: VideoStage[] = [
  "recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision",
  "internal_review", "client_review", "client_revision",
];
// Statussen waarin nog geen eerste versie verwacht hoeft te zijn verwerkt.
const AT_EDITOR: VideoStage[] = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"];

const projTitle = (clientName: string, title: string) => (title === clientName ? "video" : title);

export async function getQualityOverview(viewer: Viewer): Promise<{ items: QualityItem[]; counts: Record<QualitySeverity, number> }> {
  const owner = isOwner(viewer);
  const today = new Date().toISOString().slice(0, 10);

  const [
    data, projects, shootDeadlines, reviewQueue, scripting,
    missingVersion, missingData, clientRevision, readyNotSent, overduePublish,
    openLinks, integrations, screen,
  ] = await Promise.all([
    getDashboard(viewer),
    listEditingProjects(viewer),
    getShootDeadlines(viewer),
    getReviewQueue(viewer),
    listScripting(viewer),
    // #2 Eerste versie verwacht: opname ≥7 werkdagen geleden, nog geen versie.
    db.select({
      id: deliverables.id, title: deliverables.title, shootDate: productionDays.scheduledOn,
      clientName: clients.name, clientSlug: clients.slug, editorName: users.fullName,
    }).from(deliverables)
      .innerJoin(productionDays, and(eq(productionDays.id, deliverables.productionDayId), isNull(productionDays.deletedAt)))
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), eq(deliverables.currentVersion, 0), inArray(deliverables.status, AT_EDITOR), scopeToClients(viewer, deliverables.clientId)))
      .limit(60),
    // #9 Productiegegevens ontbreken: geen editor of geen deadline.
    db.select({
      id: deliverables.id, title: deliverables.title, editorId: deliverables.editorId, dueOn: deliverables.dueOn,
      clientName: clients.name, clientSlug: clients.slug,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ACTIVE_EDIT), or(isNull(deliverables.editorId), isNull(deliverables.dueOn)), scopeToClients(viewer, deliverables.clientId)))
      .limit(40),
    // #10 Feedback niet verwerkt: klant gaf feedback (client_revision), bal bij editor.
    db.select({
      id: deliverables.id, title: deliverables.title, statusChangedAt: deliverables.statusChangedAt,
      clientName: clients.name, clientSlug: clients.slug, editorName: users.fullName,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "client_revision"), scopeToClients(viewer, deliverables.clientId)))
      .limit(40),
    // #11 Video klaar maar niet verstuurd: goedgekeurd/klaar, nog niet ingepland of live.
    db.select({
      id: deliverables.id, title: deliverables.title, statusChangedAt: deliverables.statusChangedAt,
      clientName: clients.name, clientSlug: clients.slug,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      // Alleen voor klanten waarvoor Shortclips de content plaatst: bij klanten
      // die zelf posten is inplannen/publiceren niet onze taak.
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ["approved", "ready_to_publish"] as VideoStage[]), eq(clients.weHandlePosting, true), scopeToClients(viewer, deliverables.clientId)))
      .limit(40),
    // #12 Video niet gepubliceerd: geplande publicatiedatum verstreken, nog niet live.
    db.select({
      id: contentCalendar.id, title: contentCalendar.title, scheduledOn: contentCalendar.scheduledOn,
      deliverableId: contentCalendar.deliverableId, clientName: clients.name, clientSlug: clients.slug,
    }).from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(and(isNull(contentCalendar.deletedAt), lt(contentCalendar.scheduledOn, today), ne(contentCalendar.status, "published"), eq(clients.weHandlePosting, true), scopeToClients(viewer, contentCalendar.clientId)))
      .limit(40),
    // Owner-only bronnen.
    owner ? countOpenLinkSuggestions() : Promise.resolve(0),
    owner ? integrationHealth() : Promise.resolve([]),
    // Achterblijvende klanten (resultaten vallen terug): ook voor coördinatoren,
    // niet alleen de eigenaar — het is een analysesignaal, geen financiële data.
    getScreenData(30).catch(() => null),
  ]);

  const items: QualityItem[] = [];

  /* ---------- LIJST A — Productie & deadlines ---------- */

  // #1 Deadline in gevaar — risico, nog niet te laat.
  for (const p of projects) {
    if (p.bucket === "aandacht" || p.risk.level !== "oranje") continue;
    items.push({
      id: `risk-${p.id}`, clientName: p.clientName, severity: "oranje", category: "Deadline in gevaar",
      title: `${p.clientName} — ${projTitle(p.clientName, p.title)}`,
      detail: `${p.risk.factors.join(" · ")} → vooruit plannen`,
      href: `/videos/${p.id}`, roles: EDIT,
    });
  }

  // Video over deadline — al te laat (directe actie).
  for (const v of data.videos.late) {
    const d = Math.max(1, -daysUntil(v.dueOn));
    const atClient = VIDEO_WAITING_ON[v.status as VideoStage] === "client";
    items.push({
      id: `late-${v.id}`, clientName: v.clientName, severity: "rood",
      category: atClient ? "Te laat bij klant" : "Video over deadline",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: atClient ? `${d} dag(en) te laat · wacht op klant → herinneren` : `${d} dag(en) te laat · ${v.editorName ?? "geen editor"} → afmaken`,
      href: `/videos/${v.id}`, roles: atClient ? CC : EDIT,
    });
  }

  // #2 Eerste versie verwacht — werkdag 7 na opname, nog geen versie.
  for (const v of missingVersion) {
    if (!v.shootDate) continue;
    const wd = workingDaysBetween(v.shootDate, today);
    if (wd < 7) continue;
    items.push({
      id: `firstcut-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Eerste versie verwacht",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `${wd} werkdagen na opname · nog geen eerste versie · ${v.editorName ?? "geen editor"} → eerste cut maken`,
      href: `/videos/${v.id}`, roles: EDIT,
    });
  }

  // #3 Editor moet opleveren — editordeadline binnen 2 werkdagen, nog bij editor.
  for (const s of shootDeadlines) {
    const anyAtEditor = s.shorts.some((x) => x.atEditor);
    if (!anyAtEditor || s.workdaysToEditorDeadline < 0 || s.workdaysToEditorDeadline > 2) continue;
    items.push({
      id: `editordue-${s.shootId}`, clientName: s.clientName, severity: "oranje", category: "Editor moet opleveren",
      title: `${s.clientName} — opname ${s.shootDate.slice(5)}`,
      detail: `${s.riskReason ?? `Editordeadline over ${s.workdaysToEditorDeadline} werkdag(en)`} → opleveren`,
      href: `/productions/${s.shootId}`, roles: EDIT,
    });
  }

  // #4 Feedback ontbreekt — te lang bij klant zonder reactie.
  for (const v of data.videos.stalledAtClient.filter((x) => daysSince(x.statusChangedAt) > 3)) {
    items.push({
      id: `stall-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Feedback ontbreekt",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `${daysSince(v.statusChangedAt)} dagen geen klantfeedback → herinneren`,
      href: `/videos/${v.id}`, roles: CC,
    });
  }

  // #5 Video wacht op controle — editor heeft klaargezet (interne controle).
  for (const v of reviewQueue.teControleren) {
    items.push({
      id: `review-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Video wacht op controle",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `${Number(v.days)} dag(en) klaargezet · ${v.editorName ?? "geen editor"} → intern controleren`,
      href: `/videos/${v.id}`, roles: CC,
    });
  }

  // #6 Opname voorbereiden — scripts/locatie/benodigdheden ontbreken.
  for (const s of data.shoots) {
    const open = Number(s.openBlockers) + Number(s.unapprovedScripts) + (s.locationName ? 0 : 1);
    if (open > 0 && daysUntil(s.scheduledOn) <= 2) {
      const bits = [
        Number(s.unapprovedScripts) > 0 ? "scripts" : null,
        s.locationName ? null : "locatie",
        Number(s.openBlockers) > 0 ? "benodigdheden" : null,
      ].filter(Boolean);
      items.push({
        id: `shoot-${s.id}`, clientName: s.clientName, severity: daysUntil(s.scheduledOn) <= 0 ? "rood" : "oranje", category: "Opname voorbereiden",
        title: `${s.clientName} — opname`, detail: `${bits.join(", ") || `${open} punt(en)`} nog open · ${s.videographerName ?? "geen videograaf"} → voorbereiden`,
        href: `/productions/${s.id}`, roles: SHOOT,
      });
    }
  }

  // #7 Scripts controleren — scripts klaar voor interne controle.
  for (const r of scripting.rows.filter((x) => x.status === "klaar_shortclips")) {
    items.push({
      id: `scriptcheck-${r.id}`, clientName: r.clientName, severity: "oranje", category: "Scripts controleren",
      title: `${r.clientName} — opname ${r.scheduledOn.slice(5)}`,
      detail: `Script staat klaar · ${r.scriptWriterName ?? "geen verantwoordelijke"} → intern controleren`,
      href: "/scripting", roles: CC,
    });
  }

  /* ---------- LIJST B — Algemene gezondheid ---------- */

  // #8 Koppeling werkt niet — Agenda/Drive/Frame.io synct niet.
  const WATCH = new Set(["google_calendar", "google_drive", "frameio"]);
  for (const h of integrations as Array<{ spec: { provider: string; name: string }; configured: boolean; status: string; lastErrorMessage: string | null }>) {
    if (!WATCH.has(h.spec.provider) || !h.configured) continue;
    if (!["error", "stale", "never_synced"].includes(h.status)) continue;
    const label = h.status === "error" ? "synct niet (fout)" : h.status === "stale" ? "al >24u niet gesynct" : "nog nooit gesynct";
    items.push({
      id: `integ-${h.spec.provider}`, severity: h.status === "error" ? "rood" : "oranje", category: "Koppeling werkt niet",
      title: `${h.spec.name} ${label}`,
      detail: `${h.lastErrorMessage ?? "Geen recente synchronisatie"} → verbinding controleren`,
      href: "/settings/integrations", roles: COORD,
    });
  }

  // #9 Productiegegevens ontbreken — geen editor of geen deadline.
  for (const v of missingData) {
    const mist = [!v.editorId ? "editor" : null, !v.dueOn ? "deadline" : null].filter(Boolean).join(" en ");
    items.push({
      id: `missing-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Productiegegevens ontbreken",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `Geen ${mist} ingevuld → aanvullen`,
      href: `/videos/${v.id}`, roles: COORD,
    });
  }

  // #10 Feedback niet verwerkt — klantfeedback staat open.
  for (const v of clientRevision) {
    items.push({
      id: `clientrev-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Feedback niet verwerkt",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `Klantfeedback ${daysSince(v.statusChangedAt)} dag(en) open · ${v.editorName ?? "geen editor"} → verwerken`,
      href: `/videos/${v.id}`, roles: EDIT,
    });
  }

  // #11 Video klaar maar niet verstuurd — goedgekeurd, nog niet ingepland/live.
  for (const v of readyNotSent) {
    items.push({
      id: `notsent-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Video klaar maar niet verstuurd",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `Goedgekeurd, ${daysSince(v.statusChangedAt)} dag(en) niet verstuurd → inplannen/publiceren`,
      href: `/videos/${v.id}`, roles: CC,
    });
  }

  // #12 Video niet gepubliceerd — geplande publicatiedatum verstreken.
  for (const p of overduePublish) {
    const d = Math.max(1, -daysUntil(p.scheduledOn));
    items.push({
      id: `unpub-${p.id}`, clientName: p.clientName, severity: "oranje", category: "Video niet gepubliceerd",
      title: `${p.clientName} — ${p.title}`,
      detail: `${d} dag(en) over geplande publicatie → publiceren`,
      href: p.deliverableId ? `/videos/${p.deliverableId}` : "/calendar", roles: CC,
    });
  }

  // #13 Resultaten vallen terug — klantresultaten dalen opvallend.
  if (screen) {
    for (const c of (screen.laggards ?? []).filter((x) => (x.growthPct ?? 0) <= -25)) {
      items.push({
        id: `drop-${c.slug}`, clientName: c.name, severity: "oranje", category: "Resultaten vallen terug",
        title: c.name,
        detail: `Weergaven ${c.growthPct}% t.o.v. vorige periode → resultaten bekijken`,
        href: `/analytics/${c.slug}`, roles: COORD,
      });
    }
  }

  // (#14 "Planning onvoldoende gevuld" is verwijderd — zie de planning op /planning.)

  /* ---------- Bestaande, aanvullende signalen ---------- */

  // Klanten met risico.
  for (const c of data.clients.atRisk) {
    items.push({
      id: `clientrisk-${c.id}`, clientName: c.name, severity: c.riskLevel === "high" ? "rood" : "oranje", category: "Klant vraagt aandacht",
      title: c.name, detail: `${c.riskReason ?? "Gemarkeerd als risico"} → contact opnemen`,
      href: `/clients/${c.slug}`, roles: CC,
    });
  }

  // (Planning & capaciteit staat niet meer op deze pagina — "achter op de
  //  maandafspraak" en "klanten zonder geplande opname" gaven te veel ruis die
  //  het team niet oppakte. De planning zelf bewaak je op /productions en /planning.)

  // Aflopende contracten (vooruitkijken).
  for (const c of data.contracts.slice(0, 6)) {
    const d = daysUntil(c.endsOn);
    items.push({
      id: `contract-${c.id}`, clientName: c.clientName, severity: d < 30 ? "oranje" : "blauw", category: "Contract loopt af",
      title: c.clientName, detail: `Over ${d} dagen · ${c.autoRenew ? "verlengt automatisch" : "verlengt niet"}`,
      href: `/clients/${c.clientSlug}?tab=contract`, roles: COORD,
    });
  }

  // (Doelen-signalen staan niet meer op deze pagina: ze hebben hun eigen
  //  Doelen-pagina en gaven hier te veel ruis die het team niet gebruikte.)

  // Ernst-volgorde: rood, oranje, blauw; daarbinnen per categorie gegroepeerd,
  // zodat je per soort melding kunt scannen.
  const order: Record<QualitySeverity, number> = { rood: 0, oranje: 1, blauw: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category));

  // Per rol filteren — eigenaar/admin zien alles.
  const role = viewer.primaryRole;
  const seeAll = owner || role === "admin";
  const visible = seeAll ? items : items.filter((i) => i.roles.includes(role));

  // Tellers op de échte totalen (vóór het inkorten).
  const counts: Record<QualitySeverity, number> = { rood: 0, oranje: 0, blauw: 0 };
  for (const i of visible) counts[i.severity]++;

  // Per categorie beperken zodat de pagina scanbaar blijft: toon de eerste paar,
  // en vat de rest samen in één "+N meer"-regel.
  const CAP = 5;
  const CAT_HREF: Record<string, string> = {
    "Video niet gepubliceerd": "/calendar",
    "Editor moet opleveren": "/productions",
    "Opname voorbereiden": "/productions",
    "Scripts controleren": "/scripting",
    "Geen opname gepland": "/clients",
    "Achter op afspraak": "/clients",
    "Klant vraagt aandacht": "/clients",
  };
  const seenPerCat = new Map<string, number>();
  const overflow = new Map<string, { severity: QualitySeverity; count: number; href: string }>();
  const capped: QualityItem[] = [];
  for (const it of visible) {
    const n = seenPerCat.get(it.category) ?? 0;
    if (n < CAP) {
      capped.push(it);
      seenPerCat.set(it.category, n + 1);
    } else {
      const o = overflow.get(it.category) ?? { severity: it.severity, count: 0, href: CAT_HREF[it.category] ?? it.href };
      o.count++;
      overflow.set(it.category, o);
    }
  }
  for (const [category, o] of overflow) {
    capped.push({
      id: `more-${category}`, severity: o.severity, category,
      title: `+${o.count} meer`, detail: "Bekijk de volledige lijst →", href: o.href, roles: [],
    });
  }
  capped.sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category));

  // Klantlogo + merkkleur erbij, zodat de pagina links een logo kan tonen en in
  // één oogopslag scanbaar is welke klant het betreft. Eén query, via de naam
  // gekoppeld (die elk klant-item al meekrijgt).
  const logoRows = await db
    .select({ name: clients.name, logoUrl: clients.logoUrl, color: clients.color })
    .from(clients);
  const logoByName = new Map(logoRows.map((r) => [r.name, { logoUrl: r.logoUrl, color: r.color }]));

  // Actiegebied per item afleiden, zodat de pagina per soort werk kan indelen.
  const withGroup = capped.map((it) => {
    const logo = it.clientName ? logoByName.get(it.clientName) : undefined;
    return {
      ...it,
      group: groupOf(it.category),
      clientLogoUrl: logo?.logoUrl ?? null,
      clientColor: logo?.color ?? null,
    };
  });

  return { items: withGroup, counts };
}
