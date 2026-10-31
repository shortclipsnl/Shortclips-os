import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Alle statussen van ShortClips OS op één plek.
 *
 * Let op: enums zijn bewust "breed" gekozen zodat statussen die het team
 * vandaag gebruikt allemaal passen. Configureerbare labels/volgorde per
 * status staan in de tabel `workflow_statuses` (zie platform.ts), zodat de
 * beheerder de weergave kan aanpassen zonder migratie.
 */

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "project_coordinator",
  "content_creator",
  "videographer",
  "editor",
  "finance",
  "client",
]);

export const userStatusEnum = pgEnum("user_status", [
  "invited",
  "active",
  "suspended",
]);

export const clientStatusEnum = pgEnum("client_status", [
  "prospect",
  "onboarding",
  "active",
  "paused",
  "churned",
]);

export const riskLevelEnum = pgEnum("risk_level", [
  "none",
  "low",
  "medium",
  "high",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);

export const productionStatusEnum = pgEnum("production_status", [
  "concept",
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
]);

export const scriptStatusEnum = pgEnum("script_status", [
  "idea",
  "concept",
  "internal_review",
  "client_review",
  "revising",
  "approved",
  "ready_to_shoot",
  "shot",
]);

/** De 13 stappen van de video pipeline, in volgorde. */
export const videoStatusEnum = pgEnum("video_status", [
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
]);

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const publicationStatusEnum = pgEnum("publication_status", [
  "to_prepare",
  "ready",
  "scheduled",
  "published",
  "failed",
]);

export const platformEnum = pgEnum("platform", [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "linkedin",
]);

export const approvalKindEnum = pgEnum("approval_kind", [
  "script",
  "video",
  "publication",
  "report",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "changes_requested",
  "expired",
]);

export const commentVisibilityEnum = pgEnum("comment_visibility", [
  "internal",
  "client",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "credited",
]);

export const contractStatusEnum = pgEnum("contract_status", [
  "draft",
  "active",
  "notice_given",
  "expired",
  "terminated",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "monday",
  "frameio",
  "google_drive",
  "google_calendar",
  "gmail",
  "ayrshare",
  "metricool",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "not_configured",
  "connected",
  "degraded",
  "disconnected",
  "error",
]);

export const syncDirectionEnum = pgEnum("sync_direction", [
  "inbound",
  "outbound",
  "bidirectional",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "success",
  "partial",
  "error",
  "cancelled",
]);

export const eventProcessingStatusEnum = pgEnum("event_processing_status", [
  "received",
  "processing",
  "processed",
  "failed",
  "skipped",
]);

export const notificationLevelEnum = pgEnum("notification_level", [
  "info",
  "success",
  "warning",
  "critical",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "whatsapp",
  "slack",
]);

export const aiInsightKindEnum = pgEnum("ai_insight_kind", [
  "hook_performance",
  "topic_performance",
  "revision_pattern",
  "feedback_pattern",
  "risk_signal",
  "editor_performance",
  "bottleneck",
  "monthly_summary",
  "quarterly_review",
  "content_recommendation",
]);

export const fileSourceEnum = pgEnum("file_source", [
  "shortclips_os",
  "google_drive",
  "frameio",
  "monday",
  "upload",
]);

/* ---- Video Intelligence ---- */

export const videoAnalysisStatusEnum = pgEnum("video_analysis_status", [
  "queued", // aangemaakt, wacht op verwerking
  "downloading", // bron ophalen (yt-dlp)
  "processing", // ffmpeg/AI bezig
  "needs_ai", // meetbare stappen klaar; transcriptie/visuele AI nog niet beschikbaar (geen tool/sleutel)
  "partial", // deels gelukt (sommige stappen overgeslagen)
  "complete", // alle stappen klaar
  "failed", // kernstap mislukt
]);

export const videoAnalysisSourceEnum = pgEnum("video_analysis_source", [
  "platform_url", // publieke TikTok/Reel/Short-link, opgehaald via yt-dlp
  "upload", // handmatig geüpload MP4
  "frameio", // later: origineel uit Frame.io
]);

export const videoAnalysisStepEnum = pgEnum("video_analysis_step", [
  "download",
  "probe",
  "shots",
  "editing",
  "transcribe",
  "ocr",
  "vision",
  "hook",
  "structure",
  "insights",
]);

export const videoAnalysisStepStatusEnum = pgEnum("video_analysis_step_status", [
  "pending",
  "running",
  "done",
  "skipped", // bewust overgeslagen (tool/sleutel ontbreekt) — géén nepdata
  "failed",
]);

export const importRunStatusEnum = pgEnum("import_run_status", [
  "dry_run",
  "reviewed",
  "committed",
  "cancelled",
  "failed",
]);

export const matchDecisionEnum = pgEnum("match_decision", [
  "pending",
  "linked",
  "created",
  "skipped",
]);

/** Status van een script-PDF-review in het klantportaal (Adobe-vervanger). */
export const scriptReviewStatusEnum = pgEnum("script_review_status", [
  "klaar_controle",   // Klaar voor controle — ligt bij de klant
  "feedback_gegeven", // Klant heeft opmerkingen geplaatst
  "wordt_aangepast",  // Shortclips verwerkt de feedback
  "opnieuw_controle", // Nieuwe versie klaar — opnieuw bij de klant
  "goedgekeurd",      // Definitief goedgekeurd
]);

/** Status van een offerte (PandaDoc-vervanger). */
export const quoteStatusEnum = pgEnum("quote_status", [
  "concept",       // Nog niet gedeeld
  "verzonden",     // Als gedeeld gemarkeerd, nog niet bekeken
  "bekeken",       // Klant heeft de offertelink geopend
  "geaccepteerd",  // Klant heeft digitaal geaccepteerd
  "ondertekend",   // Gekwalificeerde e-handtekening gezet (QES)
  "afgewezen",     // Klant heeft afgewezen
  "verlopen",      // Vervaldatum voorbij zonder actie
]);
