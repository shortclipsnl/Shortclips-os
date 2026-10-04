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
];

export const INTEGRATIONS: Array<{
  provider: "monday" | "frameio" | "google_drive" | "ayrshare" | "metricool";
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
