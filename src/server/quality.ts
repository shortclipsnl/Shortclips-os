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
import { getRetentionSignals, RETENTION_CATEGORIES } from "@/server/client-retention";
import { getEditorStatusSignals } from "@/server/editor-status-checks";
import { integrationHealth } from "@/server/integrations/registry";
import { countOpenLinkSuggestions } from "@/server/link-review";
import { VIDEO_WAITING_ON, type VideoStage } from "@/lib/statuses";
import { isOwner, scopeToClients, type Viewer } from "@/server/auth/context";
import { CORE_STAFF_EMAILS, isCoreStaff } from "@/server/core-staff";
import { notInactiveClient } from "@/server/client-activity";

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
  /** Korte, concrete actie ("Video versturen"). Samen met de klantnaam de regel. */
  action: string;
  /** Korte reden in een paar woorden ("Goedgekeurd 6 dagen geleden"). */
  reason: string;
  /** Wanneer: hoog = vandaag, normaal = deze week, laag = later. */
  priority: AttentionPriority;
  /** Indeling op de pagina (categorie-chips). */
  area: AttentionArea;
  /** Automatische verantwoordelijke (user-id), zie `routeOwner`. */
  ownerId?: string | null;
  /** Gebundelde punten (bijv. 5 deadlines in gevaar) — één regel met deze lijst. */
  kids?: { label: string; sub: string; href?: string }[];
  /** Concrete deadline (YYYY-MM-DD), waar bekend. */
  dueOn?: string;
};

export type AttentionPriority = "hoog" | "normaal" | "laag";
export type AttentionArea = "editing" | "klant" | "opname" | "script" | "resultaat" | "overig";

/** Welke categorie hoort bij welk actiegebied. */
const GROUP_OF: Record<string, QualityGroup> = {
  "Scripts controleren": "scripting",
  "Deadline in gevaar": "editing",
  "Video over deadline": "editing",
  "Eerste versie verwacht": "editing",
  "Editor moet opleveren": "editing",
  "Editor reageert niet": "editing",
  "Editor nog niet begonnen": "editing",
  "Video wacht op controle": "editing",
  "Feedback niet verwerkt": "editing",
  "Productiegegevens ontbreken": "editing",
  "Te laat bij klant": "klant",
  "Feedback ontbreekt": "klant",
  "Video klaar maar niet verstuurd": "klant",
  "Video niet gepubliceerd": "klant",
  "Klant vraagt aandacht": "klant",
  [RETENTION_CATEGORIES.resultaten]: "klant",
  [RETENTION_CATEGORIES.feedback]: "klant",
  [RETENTION_CATEGORIES.ernstig]: "klant",
  [RETENTION_CATEGORIES.beoordelen]: "klant",
  [RETENTION_CATEGORIES.contract]: "overig",
  [RETENTION_CATEGORIES.gegevens]: "overig",
  "Opname voorbereiden": "planning",
  "Geen opname gepland": "planning",
  "Planning onvoldoende gevuld": "planning",
  "Achter op afspraak": "planning",
  "Koppeling werkt niet": "overig",
  "Koppeling te bevestigen": "overig",
  "Doel achter": "overig",
  "Doel risico": "overig",
  "Stand ontbreekt": "overig",
  "Doel gepland": "overig",
};
const groupOf = (category: string): QualityGroup => GROUP_OF[category] ?? "overig";

/** Categorie-chip op de pagina. Wijkt alleen af van het actiegebied voor resultaten en opnames. */
const AREA_OF: Record<QualityGroup, AttentionArea> = {
  scripting: "script", editing: "editing", klant: "klant", planning: "opname", overig: "overig",
};
const areaOf = (category: string): AttentionArea =>
  category === RETENTION_CATEGORIES.resultaten ? "resultaat" : AREA_OF[groupOf(category)];

/**
 * Wie pakt welk punt op? Vaste verdeling, zodat niemand alles krijgt:
 *  - klantcontact, scripts, resultaten en editingplanning → de Content Creative
 *    die als coördinator op de klant staat (Klantbeheer);
 *  - opnames en de kwaliteit/voortgang van de editing → Rutger;
 *  - contracten en koppelingen → Jarno.
 * Ontbreekt de juiste persoon, dan valt het punt terug op Jarno.
 */
const TO_RUTGER = new Set([
  "Opname voorbereiden", "Eerste versie verwacht", "Video wacht op controle", "Video over deadline",
  "Editor moet opleveren", "Feedback niet verwerkt",
]);
// Contractmomenten gaan niet meer standaard naar Jarno: de klantbehoud-signalen
// (src/server/client-retention.ts) bepalen zelf de verantwoordelijke.
const TO_JARNO = new Set(["Koppeling werkt niet", "Koppeling te bevestigen"]);

type PartialItem = Omit<QualityItem, "action" | "reason" | "priority" | "area"> &
  Partial<Pick<QualityItem, "action" | "reason" | "priority" | "area">>;

const CC = ["operational_manager", "project_coordinator", "content_creator"];
const EDIT = ["operational_manager", "project_coordinator", "editor"];
const SHOOT = ["operational_manager", "project_coordinator", "videographer"];
const COORD = ["operational_manager", "project_coordinator"];

// Pipelinestatussen waarin een video "in productie" is (niet af, niet geannuleerd).
const ACTIVE_EDIT: VideoStage[] = [
  "recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision",
  "internal_review", "client_review", "client_revision",
];
// Statussen waarin nog geen eerste versie verwacht hoeft te zijn verwerkt.
const AT_EDITOR: VideoStage[] = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"];

const projTitle = (clientName: string, title: string) => (title === clientName ? "video" : title);

export async function getQualityOverview(viewer: Viewer, opts: { trusted?: boolean } = {}): Promise<{ items: QualityItem[]; counts: Record<QualitySeverity, number> }> {
  const owner = isOwner(viewer);
  const today = new Date().toISOString().slice(0, 10);

  const [
    data, projects, shootDeadlines, reviewQueue, scripting,
    missingVersion, missingData, clientRevision, readyNotSent, overduePublish,
    openLinks, integrations, retention, editorStatus,
  ] = await Promise.all([
    getDashboard(viewer),
    listEditingProjects(viewer),
    getShootDeadlines(viewer),
    getReviewQueue(viewer),
    listScripting(viewer, opts),
    // #2 Eerste versie verwacht: opname ≥7 werkdagen geleden, nog geen versie.
    db.select({
      id: deliverables.id, title: deliverables.title, shootDate: productionDays.scheduledOn,
      clientName: clients.name, clientSlug: clients.slug, editorName: users.fullName,
    }).from(deliverables)
      .innerJoin(productionDays, and(eq(productionDays.id, deliverables.productionDayId), isNull(productionDays.deletedAt)))
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), eq(deliverables.currentVersion, 0), inArray(deliverables.status, AT_EDITOR), scopeToClients(viewer, deliverables.clientId), notInactiveClient(deliverables.clientId)))
      .limit(60),
    // #9 Productiegegevens ontbreken: geen editor of geen deadline.
    db.select({
      id: deliverables.id, title: deliverables.title, editorId: deliverables.editorId, dueOn: deliverables.dueOn,
      clientName: clients.name, clientSlug: clients.slug,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ACTIVE_EDIT), or(isNull(deliverables.editorId), isNull(deliverables.dueOn)), scopeToClients(viewer, deliverables.clientId), notInactiveClient(deliverables.clientId)))
      .limit(40),
    // #10 Feedback niet verwerkt: klant gaf feedback (client_revision), bal bij editor.
    db.select({
      id: deliverables.id, title: deliverables.title, statusChangedAt: deliverables.statusChangedAt,
      clientName: clients.name, clientSlug: clients.slug, editorName: users.fullName,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "client_revision"), scopeToClients(viewer, deliverables.clientId), notInactiveClient(deliverables.clientId)))
      .limit(40),
    // #11 Video klaar maar niet verstuurd: goedgekeurd/klaar, nog niet ingepland of live.
    db.select({
      id: deliverables.id, title: deliverables.title, statusChangedAt: deliverables.statusChangedAt,
      clientName: clients.name, clientSlug: clients.slug,
    }).from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      // Alleen voor klanten waarvoor Shortclips de content plaatst: bij klanten
      // die zelf posten is inplannen/publiceren niet onze taak.
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, ["approved", "ready_to_publish"] as VideoStage[]), eq(clients.weHandlePosting, true), scopeToClients(viewer, deliverables.clientId), notInactiveClient(deliverables.clientId)))
      .limit(40),
    // #12 Video niet gepubliceerd: geplande publicatiedatum verstreken, nog niet live.
    db.select({
      id: contentCalendar.id, title: contentCalendar.title, scheduledOn: contentCalendar.scheduledOn,
      deliverableId: contentCalendar.deliverableId, clientName: clients.name, clientSlug: clients.slug,
    }).from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(and(isNull(contentCalendar.deletedAt), lt(contentCalendar.scheduledOn, today), ne(contentCalendar.status, "published"), eq(clients.weHandlePosting, true), scopeToClients(viewer, contentCalendar.clientId), notInactiveClient(contentCalendar.clientId)))
      .limit(40),
    // Owner-only bronnen.
    owner ? countOpenLinkSuggestions() : Promise.resolve(0),
    owner ? integrationHealth() : Promise.resolve([]),
    // Klantbehoud: teruglopende resultaten, klachten, contractmomenten en
    // ontbrekende gegevens, met eigen verantwoordelijke (incl. vervanging).
    getRetentionSignals(viewer.clientScope).catch((e) => { console.error("[klantbehoud]", e); return []; }),
    // Statuscheck editors: geen reactie na één werkdag of nog niet begonnen vlak
    // voor de editor deadline. Gaat naar de coördinator van de klant.
    getEditorStatusSignals((clientId) => viewer.clientScope === null || viewer.clientScope.includes(clientId))
      .catch((e) => { console.error("[statuscheck]", e); return []; }),
  ]);

  const items: PartialItem[] = [];

  /* ---------- LIJST A — Productie & deadlines ---------- */

  // Statuscheck editors (zie src/server/editor-status-checks.ts).
  for (const e of editorStatus) {
    const editor = e.editorName?.split(" ")[0] ?? "Editor";
    const project = projTitle(e.clientName, e.title);
    const due = e.editorDueOn ? ` · editor deadline ${e.editorDueOn.slice(8, 10)}-${e.editorDueOn.slice(5, 7)}` : "";
    if (e.kind === "geen_reactie") {
      items.push({
        id: `statuscheck-stil-${e.deliverableId}`, clientName: e.clientName, severity: "oranje", category: "Editor reageert niet",
        title: `${e.clientName} — ${project}`,
        detail: `${editor} gaf na een werkdag geen status door op de statuscheck${due} → even navragen`,
        href: `/videos/${e.deliverableId}`, roles: EDIT,
        action: `Voortgang navragen bij ${editor}`, reason: `${project} · geen reactie op statuscheck${due}`,
        priority: "normaal", dueOn: e.editorDueOn ?? undefined,
      });
    } else {
      items.push({
        id: `statuscheck-risico-${e.deliverableId}`, clientName: e.clientName, severity: "rood", category: "Editor nog niet begonnen",
        title: `${e.clientName} — ${project}`,
        detail: `${editor} is nog niet begonnen${due}${e.note ? ` · "${e.note}"` : ""} → bijsturen of herplannen`,
        href: `/videos/${e.deliverableId}`, roles: EDIT,
        action: `Editing bijsturen met ${editor}`, reason: `${project} · nog niet begonnen${due}`,
        priority: "hoog", dueOn: e.editorDueOn ?? undefined,
      });
    }
  }

  // #1 Deadline in gevaar — risico, nog niet te laat.
  for (const p of projects) {
    if (p.bucket === "aandacht" || p.risk.level !== "oranje") continue;
    items.push({
      id: `risk-${p.id}`, clientName: p.clientName, severity: "oranje", category: "Deadline in gevaar",
      title: `${p.clientName} — ${projTitle(p.clientName, p.title)}`,
      detail: `${p.risk.factors.join(" · ")} → vooruit plannen`,
      href: `/videos/${p.id}`, roles: EDIT,
      action: "Editing vooruit plannen", reason: `${projTitle(p.clientName, p.title)} · ${p.risk.factors.join(" · ")}`, priority: "hoog",
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
      action: atClient ? "Klant herinneren aan feedback" : "Video afmaken",
      reason: atClient ? `${projTitle(v.clientName, v.title)} · ${d} ${d === 1 ? "dag" : "dagen"} over deadline, wacht op klant` : `${projTitle(v.clientName, v.title)} · ${d} ${d === 1 ? "dag" : "dagen"} over deadline · ${v.editorName ?? "geen editor"}`,
      priority: "hoog",
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
      action: "Eerste versie opleveren", reason: `${wd} werkdagen na opname · ${v.editorName ?? "geen editor"}`,
      priority: wd >= 10 ? "hoog" : "normaal",
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
      action: `Editor laten opleveren (opname ${s.shootDate.slice(8, 10)}-${s.shootDate.slice(5, 7)})`,
      reason: s.workdaysToEditorDeadline === 0 ? "Editordeadline is vandaag" : `Editordeadline over ${s.workdaysToEditorDeadline} werkdag${s.workdaysToEditorDeadline === 1 ? "" : "en"}`,
      priority: s.workdaysToEditorDeadline <= 1 ? "hoog" : "normaal",
    });
  }

  // #4 Feedback ontbreekt — te lang bij klant zonder reactie.
  for (const v of data.videos.stalledAtClient.filter((x) => daysSince(x.statusChangedAt) > 3)) {
    items.push({
      id: `stall-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Feedback ontbreekt",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `${daysSince(v.statusChangedAt)} dagen geen klantfeedback → herinneren`,
      href: `/videos/${v.id}`, roles: CC,
      action: "Klant herinneren aan feedback", reason: `${daysSince(v.statusChangedAt)} dagen geen reactie op ${projTitle(v.clientName, v.title)}`,
      priority: daysSince(v.statusChangedAt) >= 7 ? "hoog" : "normaal",
    });
  }

  // #5 Video wacht op controle — editor heeft klaargezet (interne controle).
  for (const v of reviewQueue.teControleren) {
    items.push({
      id: `review-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Video wacht op controle",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `${Number(v.days)} dag(en) klaargezet · ${v.editorName ?? "geen editor"} → intern controleren`,
      href: `/videos/${v.id}`, roles: CC,
      action: "Video intern controleren",
      reason: `${projTitle(v.clientName, v.title)} · ${Number(v.days) <= 0 ? "vandaag klaargezet" : `${Number(v.days)} ${Number(v.days) === 1 ? "dag" : "dagen"} klaargezet`} door ${v.editorName ?? "de editor"}`,
      priority: Number(v.days) >= 3 ? "hoog" : "normaal",
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
        action: "Opname voorbereiden",
        reason: `${daysUntil(s.scheduledOn) <= 0 ? "Vandaag" : daysUntil(s.scheduledOn) === 1 ? "Morgen" : `Over ${daysUntil(s.scheduledOn)} dagen`} · ${bits.join(", ") || `${open} punt(en)`} nog open`,
        priority: daysUntil(s.scheduledOn) <= 1 ? "hoog" : "normaal",
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
      action: "Scripts controleren", reason: `Opname ${r.scheduledOn.slice(8, 10)}-${r.scheduledOn.slice(5, 7)} · geschreven door ${r.scriptWriterName ?? "onbekend"}`,
      priority: daysUntil(r.scheduledOn) <= 3 ? "hoog" : "normaal",
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
      clientName: undefined, action: `${h.spec.name}-koppeling herstellen`, reason: label.charAt(0).toUpperCase() + label.slice(1),
      priority: h.status === "error" ? "hoog" : "normaal",
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
      action: `${mist.charAt(0).toUpperCase() + mist.slice(1)} invullen`, reason: `${projTitle(v.clientName, v.title)} heeft nog geen ${mist}`,
      priority: "normaal",
    });
  }

  // #10 Feedback niet verwerkt — klantfeedback staat open.
  for (const v of clientRevision) {
    items.push({
      id: `clientrev-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Feedback niet verwerkt",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `Klantfeedback ${daysSince(v.statusChangedAt)} dag(en) open · ${v.editorName ?? "geen editor"} → verwerken`,
      href: `/videos/${v.id}`, roles: EDIT,
      action: "Klantfeedback laten verwerken", reason: `${daysSince(v.statusChangedAt)} ${daysSince(v.statusChangedAt) === 1 ? "dag" : "dagen"} open · ${v.editorName ?? "geen editor"}`,
      priority: daysSince(v.statusChangedAt) >= 3 ? "hoog" : "normaal",
    });
  }

  // #11 Video klaar maar niet verstuurd — goedgekeurd, nog niet ingepland/live.
  for (const v of readyNotSent) {
    items.push({
      id: `notsent-${v.id}`, clientName: v.clientName, severity: "oranje", category: "Video klaar maar niet verstuurd",
      title: `${v.clientName} — ${projTitle(v.clientName, v.title)}`,
      detail: `Goedgekeurd, ${daysSince(v.statusChangedAt)} dag(en) niet verstuurd → inplannen/publiceren`,
      href: `/videos/${v.id}`, roles: CC,
      action: "Video versturen of inplannen",
      reason: `${projTitle(v.clientName, v.title)} · ${daysSince(v.statusChangedAt) <= 0 ? "vandaag goedgekeurd" : `goedgekeurd ${daysSince(v.statusChangedAt)} ${daysSince(v.statusChangedAt) === 1 ? "dag" : "dagen"} geleden`}`,
      priority: daysSince(v.statusChangedAt) >= 7 ? "hoog" : "normaal",
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
      action: "Video publiceren", reason: `${p.title} · ${d} ${d === 1 ? "dag" : "dagen"} over de geplande datum`,
      priority: d >= 3 ? "hoog" : "normaal",
    });
  }

  // #13 Klantbehoud — vervangt de oude "Resultaten vallen terug" (alleen
  // weergaven, zonder datacontrole) en "Contract loopt af" (einddatum i.p.v.
  // opzegdeadline, standaard naar Jarno). Zie src/server/client-retention.ts.
  for (const r of retention) items.push(r);

  // (#14 "Planning onvoldoende gevuld" is verwijderd — zie de planning op /planning.)

  /* ---------- Bestaande, aanvullende signalen ---------- */

  // Klanten met risico.
  for (const c of data.clients.atRisk) {
    items.push({
      id: `clientrisk-${c.id}`, clientName: c.name, severity: c.riskLevel === "high" ? "rood" : "oranje", category: "Klant vraagt aandacht",
      title: c.name, detail: `${c.riskReason ?? "Gemarkeerd als risico"} → contact opnemen`,
      href: `/clients/${c.slug}`, roles: CC,
      action: "Contact opnemen met klant", reason: c.riskReason ?? "Gemarkeerd als risico",
      priority: c.riskLevel === "high" ? "hoog" : "normaal",
    });
  }

  // (Planning & capaciteit staat niet meer op deze pagina — "achter op de
  //  maandafspraak" en "klanten zonder geplande opname" gaven te veel ruis die
  //  het team niet oppakte. De planning zelf bewaak je op /productions en /planning.)

  // (Doelen-signalen staan niet meer op deze pagina: ze hebben hun eigen
  //  Doelen-pagina en gaven hier te veel ruis die het team niet gebruikte.)

  // Per rol filteren. Het vaste kernteam (Jarno, Milou, Jiska, Rutger) en de
  // eigenaar/admin zien alles, zodat iedereen kan wisselen naar "Hele team".
  const role = viewer.primaryRole;
  const seeAll = owner || role === "admin" || isCoreStaff(viewer.email);
  const visible = seeAll ? items : items.filter((i) => i.roles.includes(role));

  // Klantgegevens: logo, merkkleur en coördinator (voor de verdeling).
  const [clientRows, staffRows] = await Promise.all([
    db.select({ name: clients.name, logoUrl: clients.logoUrl, color: clients.color, coordinatorId: clients.coordinatorId }).from(clients),
    db.select({ id: users.id, email: users.email }).from(users)
      .where(and(inArray(users.email, [...CORE_STAFF_EMAILS]), isNull(users.deletedAt))),
  ]);
  const clientByName = new Map(clientRows.map((r) => [r.name, r]));
  const staffId = new Map(staffRows.map((r) => [r.email.toLowerCase().split("@")[0], r.id]));
  const coreIds = new Set(staffRows.map((r) => r.id));
  const jarno = staffId.get("jarno") ?? null;

  const routeOwner = (it: PartialItem): string | null => {
    if (TO_JARNO.has(it.category)) return jarno;
    if (TO_RUTGER.has(it.category)) return staffId.get("rutger") ?? jarno;
    const coord = it.clientName ? clientByName.get(it.clientName)?.coordinatorId : null;
    if (coord && coreIds.has(coord)) return coord;
    return staffId.get("milou") ?? jarno;
  };

  const sevToPrio: Record<QualitySeverity, AttentionPriority> = { rood: "hoog", oranje: "normaal", blauw: "laag" };
  const full: QualityItem[] = visible.map((it) => {
    const c = it.clientName ? clientByName.get(it.clientName) : undefined;
    return {
      ...it,
      action: it.action ?? it.title,
      reason: it.reason ?? it.detail,
      priority: it.priority ?? sevToPrio[it.severity],
      area: it.area ?? areaOf(it.category),
      group: groupOf(it.category),
      // Klantbehoud-signalen hebben hun eigen verantwoordelijke (incl. vervanging).
      ownerId: it.ownerId !== undefined ? it.ownerId : routeOwner(it),
      clientLogoUrl: c?.logoUrl ?? null,
      clientColor: c?.color ?? null,
    };
  });

  // Bundelen: losse "Deadline in gevaar"-regels worden één punt per
  // verantwoordelijke, en automatische contractverlengingen één punt. Zo blijft
  // de lijst kort en zie je toch per project wat er speelt.
  const out: QualityItem[] = [];
  const riskByOwner = new Map<string, QualityItem[]>();
  const autoRenew: QualityItem[] = [];
  for (const it of full) {
    if (it.category === "Deadline in gevaar") {
      const k = it.ownerId ?? "none";
      riskByOwner.set(k, [...(riskByOwner.get(k) ?? []), it]);
    } else if (it.category === "Contract loopt af" && it.action === "Automatische verlenging checken") {
      autoRenew.push(it);
    } else out.push(it);
  }
  for (const [ownerKey, list] of riskByOwner) {
    if (list.length === 1) { out.push(list[0]); continue; }
    out.push({
      ...list[0],
      id: `riskbundle-${ownerKey}`,
      clientName: undefined, clientLogoUrl: null, clientColor: null,
      title: `${list.length} deadlines in gevaar`,
      action: `${list.length} deadlines in gevaar: editing herverdelen`,
      reason: "Editors hebben meer werk dan ze aankunnen",
      detail: "Editors hebben meer werk dan ze aankunnen → vooruit plannen",
      href: "/planning",
      kids: list.map((x) => ({ label: x.title.replace(" — ", " · "), sub: x.detail.replace(/ → .*$/, ""), href: x.href })),
    });
  }
  if (autoRenew.length === 1) out.push(autoRenew[0]);
  else if (autoRenew.length > 1) {
    out.push({
      ...autoRenew[0],
      id: "contracts-autorenew",
      clientName: undefined, clientLogoUrl: null, clientColor: null,
      title: `${autoRenew.length} contracten verlengen automatisch`,
      action: `${autoRenew.length} automatische verlengingen checken`,
      reason: "Alleen actie als pakket of prijs moet veranderen",
      detail: "Verlengen vanzelf → alleen actie als pakket of prijs moet veranderen",
      href: "/klantenbeheer",
      kids: autoRenew.map((x) => ({ label: x.clientName ?? x.title, sub: x.reason.replace(" · verlengt automatisch", ""), href: x.href })),
    });
  }

  const order: Record<AttentionPriority, number> = { hoog: 0, normaal: 1, laag: 2 };

  // Zelfde soort punt bij dezelfde klant (bijv. vier video's wachten op
  // feedback) wordt één regel met de lijst eronder: één actie, niet vier.
  const sameKind = new Map<string, QualityItem[]>();
  const merged: QualityItem[] = [];
  for (const it of out) {
    // Klantbehoud-punten niet samenvoegen: elk heeft een eigen opvolging.
    if (!it.clientName || it.kids?.length || it.id.startsWith("retentie-")) { merged.push(it); continue; }
    const k = `${it.category}|${it.clientName}|${it.ownerId ?? ""}`;
    sameKind.set(k, [...(sameKind.get(k) ?? []), it]);
  }
  for (const list of sameKind.values()) {
    if (list.length === 1) { merged.push(list[0]); continue; }
    list.sort((a, b) => order[a.priority] - order[b.priority]);
    const first = list[0];
    const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    merged.push({
      ...first,
      id: `bundle-${slug(first.category)}-${slug(first.clientName ?? "")}`,
      reason: `${first.reason} (+${list.length - 1} meer)`,
      href: first.href,
      kids: list.map((x) => ({ label: x.title.replace(/^.*? — /, ""), sub: x.reason, href: x.href })),
    });
  }
  out.length = 0;
  out.push(...merged);
  out.sort((a, b) => order[a.priority] - order[b.priority] || a.category.localeCompare(b.category));

  const counts: Record<QualitySeverity, number> = { rood: 0, oranje: 0, blauw: 0 };
  for (const i of out) counts[i.severity]++;

  return { items: out, counts };
}
