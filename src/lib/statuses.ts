import type { Tone } from "@/components/ui";

/**
 * Weergave van statussen. De database (`workflow_statuses`) is leidend voor
 * volgorde, SLA en zichtbaarheid richting de klant; dit bestand geeft de
 * labels en kleuren die de UI nodig heeft zonder extra query.
 */

export const VIDEO_STAGES = [
  "recorded",
  "footage_upload",
  "awaiting_editor",
  "editing",
  "internal_review",
  "editor_revision",
  "client_review",
  "client_revision",
  "approved",
  "ready_to_publish",
  "scheduled",
  "published",
  "analysis_available",
] as const;

export type VideoStage = (typeof VIDEO_STAGES)[number];

export const VIDEO_STATUS: Record<VideoStage, { label: string; tone: Tone; short: string }> = {
  recorded: { label: "Opgenomen", tone: "neutral", short: "Opgenomen" },
  footage_upload: { label: "Beelden uploaden", tone: "neutral", short: "Upload" },
  awaiting_editor: { label: "Wacht op editor", tone: "info", short: "Wacht op editor" },
  editing: { label: "Edit bezig", tone: "info", short: "Edit" },
  internal_review: { label: "Interne controle", tone: "info", short: "Intern" },
  editor_revision: { label: "Aanpassing editor", tone: "info", short: "Revisie editor" },
  client_review: { label: "Klantcontrole", tone: "warn", short: "Bij klant" },
  client_revision: { label: "Aanpassing klant", tone: "warn", short: "Revisie klant" },
  approved: { label: "Goedgekeurd", tone: "good", short: "Goedgekeurd" },
  ready_to_publish: { label: "Klaar voor publicatie", tone: "good", short: "Klaar" },
  scheduled: { label: "Ingepland", tone: "good", short: "Ingepland" },
  published: { label: "Gepubliceerd", tone: "ink", short: "Live" },
  analysis_available: { label: "Analyse beschikbaar", tone: "ink", short: "Analyse" },
};

/**
 * De zeven productiefases — één naam en één kleur, overal gelijk (#4). De 13
 * interne statussen vouwen samen tot deze fases voor elke fase-weergave; de
 * statussen zelf blijven bestaan voor de "Volgende stap"-besturing op de
 * detailpagina. "Live" is terminaal (ná de productie, de gepubliceerde video's).
 */
export type VideoPhase =
  | "gepland"
  | "beelden_binnen"
  | "in_edit"
  | "interne_controle"
  | "bij_klant"
  | "feedback_verwerken"
  | "klaar"
  | "live";

export const VIDEO_PHASE_META: Record<VideoPhase, { label: string; tone: Tone }> = {
  gepland: { label: "Gepland", tone: "neutral" },
  beelden_binnen: { label: "Beelden binnen", tone: "info" },
  in_edit: { label: "In edit", tone: "info" },
  interne_controle: { label: "Interne controle", tone: "info" },
  bij_klant: { label: "Bij klant", tone: "warn" },
  feedback_verwerken: { label: "Feedback verwerken", tone: "info" },
  klaar: { label: "Klaar", tone: "good" },
  live: { label: "Live", tone: "ink" },
};

/** Volgorde van de productiefases (zonder de terminale "live"). */
export const VIDEO_PHASE_ORDER: VideoPhase[] = [
  "gepland", "beelden_binnen", "in_edit", "interne_controle", "bij_klant", "feedback_verwerken", "klaar",
];

export const STATUS_TO_PHASE: Record<VideoStage, VideoPhase> = {
  recorded: "beelden_binnen",
  footage_upload: "beelden_binnen",
  awaiting_editor: "beelden_binnen",
  editing: "in_edit",
  editor_revision: "in_edit",
  internal_review: "interne_controle",
  client_review: "bij_klant",
  client_revision: "feedback_verwerken",
  approved: "klaar",
  ready_to_publish: "klaar",
  scheduled: "klaar",
  published: "live",
  analysis_available: "live",
};

/** De fase (naam + kleur) van een videostatus — de enige bron voor fase-weergave. */
export function videoPhase(status: string): { phase: VideoPhase; label: string; tone: Tone } {
  const phase = STATUS_TO_PHASE[status as VideoStage] ?? "beelden_binnen";
  const meta = VIDEO_PHASE_META[phase];
  return { phase, label: meta.label, tone: meta.tone };
}

/** Bij wie ligt de bal? Bepaalt de "wacht op"-kolom en de dashboardsignalen. */
export const VIDEO_WAITING_ON: Record<VideoStage, "shortclips" | "editor" | "client" | "none"> = {
  recorded: "shortclips",
  footage_upload: "shortclips",
  awaiting_editor: "shortclips",
  editing: "editor",
  internal_review: "shortclips",
  editor_revision: "editor",
  client_review: "client",
  client_revision: "editor",
  approved: "shortclips",
  ready_to_publish: "shortclips",
  scheduled: "none",
  published: "none",
  analysis_available: "none",
};

/** Streeftijden in dagen; overschrijding kleurt de rij. */
export const VIDEO_SLA_DAYS: Partial<Record<VideoStage, number>> = {
  footage_upload: 2,
  awaiting_editor: 2,
  editing: 4,
  internal_review: 1,
  editor_revision: 2,
  client_review: 3,
  client_revision: 2,
};

export const SCRIPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  idea: { label: "Idee", tone: "neutral" },
  concept: { label: "Concept", tone: "neutral" },
  internal_review: { label: "Interne controle", tone: "info" },
  client_review: { label: "Klantcontrole", tone: "lime" },
  revising: { label: "Aanpassen", tone: "warn" },
  approved: { label: "Goedgekeurd", tone: "good" },
  ready_to_shoot: { label: "Klaar voor opname", tone: "good" },
  shot: { label: "Opgenomen", tone: "ink" },
};

/** Scriptingfases voor het Scripting-dashboard. "final" telt als afgerond. */
export const SCRIPTING_STATUS: Record<string, { label: string; tone: Tone; done?: boolean }> = {
  afstemmen: { label: "Nog afstemmen met klant", tone: "neutral" },
  concepting: { label: "Concepting", tone: "info" },
  klaar_shortclips: { label: "Klaar Shortclips", tone: "lime" },
  scriptmeeting: { label: "Scriptmeeting", tone: "warn" },
  final: { label: "Final voor opname", tone: "good", done: true },
};
export const SCRIPTING_ORDER = ["afstemmen", "concepting", "klaar_shortclips", "scriptmeeting", "final"] as const;

export const PRODUCTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  concept: { label: "Concept", tone: "neutral" },
  planned: { label: "Gepland", tone: "info" },
  confirmed: { label: "Bevestigd", tone: "lime" },
  in_progress: { label: "Bezig", tone: "info" },
  completed: { label: "Afgerond", tone: "good" },
  cancelled: { label: "Geannuleerd", tone: "bad" },
};

export const PUBLICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  to_prepare: { label: "Nog voorbereiden", tone: "warn" },
  ready: { label: "Klaar", tone: "info" },
  scheduled: { label: "Ingepland", tone: "lime" },
  published: { label: "Gepubliceerd", tone: "good" },
  failed: { label: "Mislukt", tone: "bad" },
};

export const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  todo: { label: "Te doen", tone: "neutral" },
  in_progress: { label: "Bezig", tone: "info" },
  blocked: { label: "Geblokkeerd", tone: "bad" },
  done: { label: "Klaar", tone: "good" },
  cancelled: { label: "Vervallen", tone: "neutral" },
};

export const TASK_PRIORITY: Record<string, { label: string; tone: Tone }> = {
  low: { label: "Laag", tone: "neutral" },
  normal: { label: "Normaal", tone: "neutral" },
  high: { label: "Hoog", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Concept", tone: "neutral" },
  sent: { label: "Verstuurd", tone: "info" },
  partially_paid: { label: "Deels betaald", tone: "warn" },
  paid: { label: "Betaald", tone: "good" },
  overdue: { label: "Vervallen", tone: "bad" },
  credited: { label: "Gecrediteerd", tone: "neutral" },
};

export const CLIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  prospect: { label: "Prospect", tone: "neutral" },
  onboarding: { label: "Onboarding", tone: "info" },
  active: { label: "Actief", tone: "good" },
  paused: { label: "Gepauzeerd", tone: "warn" },
  churned: { label: "Gestopt", tone: "bad" },
};

export const RISK_LEVEL: Record<string, { label: string; tone: Tone }> = {
  none: { label: "Geen risico", tone: "good" },
  low: { label: "Laag risico", tone: "neutral" },
  medium: { label: "Aandacht", tone: "warn" },
  high: { label: "Risico", tone: "bad" },
};

export const PLATFORM: Record<string, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  tiktok: { label: "TikTok", color: "#111111" },
  youtube: { label: "YouTube", color: "#FF0000" },
  facebook: { label: "Facebook", color: "#1877F2" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
};

export const INTEGRATION_LABEL: Record<string, string> = {
  monday: "Monday.com",
  frameio: "Frame.io",
  google_drive: "Google Drive",
  ayrshare: "Ayrshare",
  metricool: "Metricool",
};

/** Hoeveel dagen staat deze video al in de huidige status, en is dat te lang? */
export function stageOverdue(stage: string, days: number): boolean {
  const sla = VIDEO_SLA_DAYS[stage as VideoStage];
  return sla !== undefined && days > sla;
}
