/**
 * Configuratie die het platform nodig heeft om te werken: statussen,
 * automatiseringsregels en de lijst met integraties. Dit is géén demodata —
 * deze rijen horen ook in productie te staan.
 */

export const WORKFLOW_STATUSES: Array<{
  domain: string;
  key: string;
  label: string;
  color: string;
  sortOrder: number;
  isClientVisible: boolean;
  slaHours?: number;
}> = [
  // --- Video pipeline ---
  { domain: "video", key: "recorded", label: "Opgenomen", color: "#8A8A9C", sortOrder: 10, isClientVisible: false },
  { domain: "video", key: "footage_upload", label: "Beelden uploaden", color: "#8A8A9C", sortOrder: 20, isClientVisible: false, slaHours: 48 },
  { domain: "video", key: "awaiting_editor", label: "Wacht op editor", color: "#D98200", sortOrder: 30, isClientVisible: false, slaHours: 48 },
  { domain: "video", key: "editing", label: "Edit bezig", color: "#00AFFA", sortOrder: 40, isClientVisible: true, slaHours: 96 },
  { domain: "video", key: "internal_review", label: "Interne controle", color: "#00AFFA", sortOrder: 50, isClientVisible: false, slaHours: 24 },
  { domain: "video", key: "editor_revision", label: "Aanpassing editor", color: "#D98200", sortOrder: 60, isClientVisible: false, slaHours: 48 },
  { domain: "video", key: "client_review", label: "Klantcontrole", color: "#8FB300", sortOrder: 70, isClientVisible: true, slaHours: 72 },
  { domain: "video", key: "client_revision", label: "Aanpassing klant", color: "#D98200", sortOrder: 80, isClientVisible: true, slaHours: 48 },
  { domain: "video", key: "approved", label: "Goedgekeurd", color: "#2E9A6E", sortOrder: 90, isClientVisible: true },
  { domain: "video", key: "ready_to_publish", label: "Klaar voor publicatie", color: "#2E9A6E", sortOrder: 100, isClientVisible: true },
  { domain: "video", key: "scheduled", label: "Ingepland", color: "#2E9A6E", sortOrder: 110, isClientVisible: true },
  { domain: "video", key: "published", label: "Gepubliceerd", color: "#00003B", sortOrder: 120, isClientVisible: true },
  { domain: "video", key: "analysis_available", label: "Analyse beschikbaar", color: "#00003B", sortOrder: 130, isClientVisible: true },

  // --- Scripts ---
  { domain: "script", key: "idea", label: "Idee", color: "#8A8A9C", sortOrder: 10, isClientVisible: false },
  { domain: "script", key: "concept", label: "Concept", color: "#8A8A9C", sortOrder: 20, isClientVisible: false },
  { domain: "script", key: "internal_review", label: "Interne controle", color: "#00AFFA", sortOrder: 30, isClientVisible: false, slaHours: 24 },
  { domain: "script", key: "client_review", label: "Klantcontrole", color: "#8FB300", sortOrder: 40, isClientVisible: true, slaHours: 72 },
  { domain: "script", key: "revising", label: "Aanpassen", color: "#D98200", sortOrder: 50, isClientVisible: false },
  { domain: "script", key: "approved", label: "Goedgekeurd", color: "#2E9A6E", sortOrder: 60, isClientVisible: true },
  { domain: "script", key: "ready_to_shoot", label: "Klaar voor opname", color: "#2E9A6E", sortOrder: 70, isClientVisible: true },
  { domain: "script", key: "shot", label: "Opgenomen", color: "#00003B", sortOrder: 80, isClientVisible: true },

  // --- Publicaties ---
  { domain: "publication", key: "to_prepare", label: "Nog voorbereiden", color: "#D98200", sortOrder: 10, isClientVisible: false },
  { domain: "publication", key: "ready", label: "Klaar", color: "#00AFFA", sortOrder: 20, isClientVisible: true },
  { domain: "publication", key: "scheduled", label: "Ingepland", color: "#8FB300", sortOrder: 30, isClientVisible: true },
  { domain: "publication", key: "published", label: "Gepubliceerd", color: "#2E9A6E", sortOrder: 40, isClientVisible: true },
  { domain: "publication", key: "failed", label: "Mislukt", color: "#D9483B", sortOrder: 50, isClientVisible: true },

  // --- Producties ---
  { domain: "production", key: "concept", label: "Concept", color: "#8A8A9C", sortOrder: 10, isClientVisible: false },
  { domain: "production", key: "planned", label: "Gepland", color: "#00AFFA", sortOrder: 20, isClientVisible: true },
  { domain: "production", key: "confirmed", label: "Bevestigd", color: "#8FB300", sortOrder: 30, isClientVisible: true },
  { domain: "production", key: "in_progress", label: "Bezig", color: "#00AFFA", sortOrder: 40, isClientVisible: true },
  { domain: "production", key: "completed", label: "Afgerond", color: "#2E9A6E", sortOrder: 50, isClientVisible: true },
  { domain: "production", key: "cancelled", label: "Geannuleerd", color: "#D9483B", sortOrder: 60, isClientVisible: true },
];

export const AUTOMATION_RULES: Array<{
  key: string;
  name: string;
  description: string;
  trigger: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
}> = [
  {
    key: "video_to_client_review_notifies_client",
    name: "Video naar klantcontrole → klant informeren",
    description:
      "Zodra een video op klantcontrole komt, krijgt de klant een melding in het portaal met een directe link naar de goedkeuring.",
    trigger: "video.status_changed",
    conditions: { to: "client_review" },
    actions: [
      { type: "create_approval", kind: "video" },
      {
        type: "notify_client",
        title: "Nieuwe video klaar om te bekijken",
        level: "info",
      },
    ],
  },
  {
    key: "frame_approval_sets_video_approved",
    name: "Frame.io-goedkeuring → video goedgekeurd",
    description:
      "Komt er via Frame.io een approval binnen, dan gaat de video in ShortClips OS automatisch naar Goedgekeurd.",
    trigger: "frameio.asset_approved",
    conditions: {},
    actions: [{ type: "set_video_status", status: "approved" }],
  },
  {
    key: "approved_video_creates_publish_task",
    name: "Video goedgekeurd → publicatietaak aanmaken",
    description:
      "Na goedkeuring komt er automatisch een taak om de video in te plannen, met de geplande publicatiedatum als deadline.",
    trigger: "video.status_changed",
    conditions: { to: "approved" },
    actions: [
      { type: "create_task", title: "Video inplannen voor publicatie", priority: "high" },
      { type: "set_video_status", status: "ready_to_publish" },
    ],
  },
  {
    key: "all_videos_done_updates_project",
    name: "Alle video's van een opnamedag klaar → project bijwerken",
    description:
      "Zijn alle video's van een opnamedag gepubliceerd, dan gaat de bijbehorende productie op Afgerond.",
    trigger: "video.status_changed",
    conditions: { to: "published" },
    actions: [{ type: "complete_production_if_all_published" }],
  },
  {
    key: "contract_renewal_60_days",
    name: "Contract loopt over 60 dagen af → verlengingstaak",
    description:
      "Zestig dagen voor de einddatum ontstaat er een verlengingstaak voor de projectcoördinator.",
    trigger: "schedule.daily",
    conditions: { contractEndsInDays: 60 },
    actions: [
      { type: "create_task", title: "Verlenging bespreken", priority: "high" },
      { type: "notify_owner", level: "warning" },
    ],
  },
  {
    key: "shoot_within_48h_without_approved_scripts",
    name: "Opname binnen 48 uur zonder goedgekeurde scripts → risico",
    description:
      "Staan er binnen twee dagen opnames gepland terwijl scripts of benodigdheden niet rond zijn, dan wordt de opnamedag als risico gemarkeerd.",
    trigger: "schedule.hourly",
    conditions: { shootWithinHours: 48, scriptsApproved: false },
    actions: [
      { type: "flag_production_risk" },
      { type: "notify_coordinator", level: "critical" },
    ],
  },
  {
    key: "editor_deadline_missed",
    name: "Editordeadline overschreden → coördinator waarschuwen",
    description:
      "Levert een editor niet op tijd, dan krijgt de projectcoördinator meteen een melding.",
    trigger: "schedule.hourly",
    conditions: { editorDeadlinePassed: true },
    actions: [{ type: "notify_coordinator", level: "warning" }],
  },
  {
    key: "client_silent_for_5_days",
    name: "Klant reageert 5 dagen niet → opvolgtaak",
    description:
      "Wacht een video langer dan vijf dagen op klantfeedback, dan komt er een opvolgtaak voor de coördinator.",
    trigger: "schedule.daily",
    conditions: { awaitingClientDays: 5 },
    actions: [
      { type: "create_task", title: "Klant opvolgen over openstaande feedback", priority: "normal" },
    ],
  },
  {
    key: "invoice_overdue",
    name: "Factuur vervallen → finance melden",
    description: "Een factuur die de vervaldatum passeert, wordt gemeld bij finance.",
    trigger: "schedule.daily",
    conditions: { invoiceOverdue: true },
    actions: [{ type: "notify_finance", level: "warning" }],
  },
  {
    key: "publish_tomorrow_reminder",
    name: "Publicatie morgen → herinnering",
    description:
      "Content die morgen live moet en nog niet klaarstaat, wordt vandaag gemeld bij de verantwoordelijke.",
    trigger: "schedule.daily",
    conditions: { publishInDays: 1, statusNot: ["scheduled", "published"] },
    actions: [{ type: "notify_owner_of_item", level: "warning" }],
  },

  /* ---- Scripts: minder handwerk rond checken & goedkeuren ---- */
  {
    key: "script_to_client_review_notifies_client",
    name: "Script naar klantcontrole → klant informeren",
    description:
      "Zodra een script op klantcontrole komt, krijgt de klant een melding in het portaal en wordt er een goedkeuring aangemaakt.",
    trigger: "script.status_changed",
    conditions: { to: "client_review" },
    actions: [
      { type: "create_approval", kind: "script" },
      { type: "notify_client", title: "Nieuw script om te checken", level: "info" },
    ],
  },
  {
    key: "script_approved_plans_shoot",
    name: "Script goedgekeurd → opnamedag inplannen",
    description:
      "Keurt de klant een script goed, dan ontstaat automatisch een taak om de opnamedag in te plannen en wordt de coördinator geïnformeerd.",
    trigger: "script.status_changed",
    conditions: { to: "approved" },
    actions: [
      { type: "notify_coordinator", title: "Script goedgekeurd — opnamedag inplannen", level: "info" },
      { type: "create_task", title: "Opnamedag inplannen (script goedgekeurd)", priority: "high" },
    ],
  },
  {
    key: "script_changes_requested_alerts_staff",
    name: "Klant vraagt scriptwijziging → team waarschuwen",
    description:
      "Plaatst de klant een opmerking op een script, dan krijgt de coördinator direct een melding en een taak om de feedback te verwerken.",
    trigger: "script.status_changed",
    conditions: { to: "revising" },
    actions: [
      { type: "notify_coordinator", title: "Klant vroeg een scriptwijziging", level: "warning" },
      { type: "create_task", title: "Scriptfeedback verwerken", priority: "high" },
    ],
  },
  {
    key: "script_silent_reminds_client",
    name: "Script wacht te lang op de klant → herinneren",
    description:
      "Staat een script langer dan drie werkdagen op klantcontrole, dan krijgt de klant een herinnering en de coördinator een opvolgtaak.",
    trigger: "schedule.daily",
    conditions: { awaitingClientScriptDays: 3 },
    actions: [
      { type: "notify_client", title: "Herinnering: er staat nog een script voor je klaar", level: "info" },
      { type: "create_task", title: "Klant opvolgen over openstaand script", priority: "normal" },
    ],
  },

  /* ---- Videofeedback: minder handwerk rond revisies ---- */
  {
    key: "video_client_revision_routes_to_editor",
    name: "Klant vraagt videowijziging → naar editor routeren",
    description:
      "Vraagt de klant een wijziging op een video, dan krijgt de coördinator een melding en ontstaat er een taak om de feedback naar de editor te zetten.",
    trigger: "video.status_changed",
    conditions: { to: "client_revision" },
    actions: [
      { type: "notify_coordinator", title: "Klant vroeg een videowijziging", level: "warning" },
      { type: "create_task", title: "Videofeedback naar editor zetten", priority: "high" },
    ],
  },
  {
    key: "frame_comment_notifies_coordinator",
    name: "Nieuwe Frame.io-opmerking → coördinator melden",
    description:
      "Komt er via Frame.io een nieuwe opmerking binnen, dan ziet de coördinator dat meteen in ShortClips OS — geen Frame.io-controle meer nodig.",
    trigger: "frameio.comment_created",
    conditions: {},
    actions: [
      { type: "notify_coordinator", title: "Nieuwe opmerking op een video (Frame.io)", level: "info" },
    ],
  },
  {
    key: "client_silent_5_days_reminds_client",
    name: "Klant reageert 5 dagen niet → klant herinneren",
    description:
      "Wacht een video langer dan vijf dagen op klantfeedback, dan krijgt ook de klant zelf een herinnering (naast de opvolgtaak voor de coördinator).",
    trigger: "schedule.daily",
    conditions: { awaitingClientDays: 5 },
    actions: [
      { type: "notify_client", title: "Herinnering: er wacht nog een video op je feedback", level: "info" },
    ],
  },

  /* ---- Overgenomen uit Monday: team- en eigenaarmeldingen ---- */
  {
    key: "video_internal_review_notifies_team",
    name: "Video klaar met edit → interne review melden",
    description:
      "Zodra een video op interne review komt, krijgt de coördinator een melding dat de edit klaar is om te controleren.",
    trigger: "video.status_changed",
    conditions: { to: "internal_review" },
    actions: [
      { type: "notify_coordinator", title: "Video klaar met edit — staat voor interne review", level: "info" },
    ],
  },
  {
    key: "video_delivered_notifies_team",
    name: "Video afgerond → opgeleverd melden",
    description:
      "Is een video goedgekeurd/afgerond, dan krijgt de coördinator een melding dat die definitief is opgeleverd.",
    trigger: "video.status_changed",
    conditions: { to: "approved" },
    actions: [
      { type: "notify_coordinator", title: "Video afgerond en opgeleverd 🎉", level: "info" },
    ],
  },
  {
    key: "lead_won_notifies_owner",
    name: "Lead gewonnen → eigenaar melden",
    description:
      "Gaat een lead op Gewonnen, dan krijgt de eigenaar een melding om de nieuwe klant in het klantenbeheer te zetten.",
    trigger: "lead.won",
    conditions: {},
    actions: [
      { type: "notify_owner", title: "🎉 Nieuwe klant gewonnen — zet 'm in het klantenbeheer", level: "success" },
    ],
  },
  {
    key: "lead_quote_sent_notifies_owner",
    name: "Offerte verstuurd → opvolgherinnering",
    description:
      "Zet je een lead op Offerte, dan komt er een melding om binnen drie werkdagen op te volgen.",
    trigger: "lead.quote_sent",
    conditions: {},
    actions: [
      { type: "notify_owner", title: "📋 Offerte verstuurd — volg binnen 3 werkdagen op", level: "info" },
    ],
  },
  {
    key: "leave_approved_notifies_owner",
    name: "Vakantie goedgekeurd → capaciteit controleren",
    description:
      "Na goedkeuring van verlof krijgt de eigenaar een melding dat de teamcapaciteit daalt, om de planning te controleren.",
    trigger: "leave.approved",
    conditions: {},
    actions: [
      { type: "notify_owner", title: "Vakantie goedgekeurd — teamcapaciteit daalt, controleer de planning", level: "info" },
    ],
  },

  /* ---- Tijd-gestuurde herinneringen (overgenomen uit Monday) ---- */
  {
    key: "contract_45d_plan_evaluation",
    name: "Contract loopt over 45 dagen af → evaluatie inplannen",
    description:
      "Vijfenveertig dagen voor de einddatum komt er een taak om de verlenging/evaluatie in te plannen en wordt de coördinator geïnformeerd.",
    trigger: "schedule.daily",
    conditions: { contractDaysLeft: 45 },
    actions: [
      { type: "create_task", title: "Contractverlenging/evaluatie inplannen", priority: "normal" },
      { type: "notify_coordinator", title: "Contract loopt over 45 dagen af — evaluatie inplannen", level: "info" },
    ],
  },
  {
    key: "contract_7d_warns_owner",
    name: "Contract loopt over 7 dagen af → eigenaar waarschuwen",
    description: "Een week voor de einddatum krijgt de eigenaar een waarschuwing.",
    trigger: "schedule.daily",
    conditions: { contractDaysLeft: 7 },
    actions: [{ type: "notify_owner", level: "warning" }],
  },
  {
    key: "contract_expires_today",
    name: "Contract verloopt vandaag → eigenaar + taak",
    description: "Op de einddatum zelf krijgt de eigenaar een kritieke melding en ontstaat er een actietaak.",
    trigger: "schedule.daily",
    conditions: { contractDaysLeft: 0 },
    actions: [
      { type: "notify_owner", level: "critical" },
      { type: "create_task", title: "Contract verloopt vandaag — verlengen of afsluiten", priority: "high" },
    ],
  },
  {
    key: "shoot_missing_videographer",
    name: "Opname zonder videograaf → coördinator melden",
    description:
      "Staat er binnen 7 of 2 dagen een opname zonder videograaf, dan krijgt de coördinator een melding om iemand in te plannen.",
    trigger: "schedule.daily",
    conditions: { videographerMissing: true },
    actions: [
      { type: "notify_coordinator", title: "Opname zonder videograaf — plan iemand in", level: "warning" },
    ],
  },
];

export const INTEGRATIONS: Array<{
  provider:
    | "monday"
    | "frameio"
    | "google_drive"
    | "google_calendar"
    | "ayrshare"
    | "metricool";
  requiredEnv: string[];
  config: Record<string, unknown>;
}> = [
  {
    provider: "monday",
    requiredEnv: ["MONDAY_API_TOKEN"],
    config: { apiVersion: "2026-07", webhookPath: "/api/webhooks/monday" },
  },
  {
    provider: "frameio",
    requiredEnv: ["FRAMEIO_TOKEN"],
    config: { webhookPath: "/api/webhooks/frameio" },
  },
  {
    provider: "google_drive",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
    config: { webhookPath: "/api/webhooks/drive" },
  },
  {
    provider: "google_calendar",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
    config: { note: "Hergebruikt Google-OAuth; scope calendar.readonly vereist" },
  },
  { provider: "ayrshare", requiredEnv: ["AYRSHARE_API_KEY"], config: {} },
  { provider: "metricool", requiredEnv: [], config: { note: "Nog niet ingericht" } },
];

export const SOP_DOCUMENTS = [
  {
    slug: "opnamedag-voorbereiding",
    title: "Opnamedag voorbereiden",
    category: "Productie",
    body: "1. Scripts goedgekeurd door klant\n2. Shotlist compleet\n3. Apparatuur gecheckt (camera, lens, 2x microfoon, lampen, statief)\n4. Locatie en contactpersoon bevestigd\n5. Reistijd ingepland\n6. Drive-map aangemaakt voor ruwe beelden",
  },
  {
    slug: "interne-videocontrole",
    title: "Interne videocontrole",
    category: "Kwaliteit",
    body: "Controleer op: hook in de eerste 2 seconden, ondertiteling volledig en foutloos, audio genormaliseerd, merkkleuren correct, CTA aanwezig, beeldverhouding 9:16, geen zwarte frames aan het einde.",
  },
  {
    slug: "klantfeedback-verwerken",
    title: "Klantfeedback verwerken",
    category: "Klant",
    body: "Feedback verzamelen in één ronde. Losse opmerkingen bundelen tot één briefing voor de editor. Terugkerende correcties vastleggen in Klantkennis, zodat ze de volgende keer niet opnieuw ontstaan.",
  },
  {
    slug: "maandrapportage",
    title: "Maandrapportage opleveren",
    category: "Rapportage",
    body: "Rapport wordt automatisch samengesteld uit de cijfers. Voeg één persoonlijke toelichting toe: wat ging goed, wat kan beter, wat is de volgende stap. Publiceer daarna naar het klantportaal.",
  },
];
