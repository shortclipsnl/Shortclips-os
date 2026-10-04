CREATE TYPE "public"."ai_insight_kind" AS ENUM('hook_performance', 'topic_performance', 'revision_pattern', 'feedback_pattern', 'risk_signal', 'editor_performance', 'bottleneck', 'monthly_summary', 'quarterly_review', 'content_recommendation');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('script', 'video', 'publication', 'report');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'changes_requested', 'expired');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('prospect', 'onboarding', 'active', 'paused', 'churned');--> statement-breakpoint
CREATE TYPE "public"."comment_visibility" AS ENUM('internal', 'client');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'notice_given', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."event_processing_status" AS ENUM('received', 'processing', 'processed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."file_source" AS ENUM('shortclips_os', 'google_drive', 'frameio', 'monday', 'upload');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('dry_run', 'reviewed', 'committed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('monday', 'frameio', 'google_drive', 'ayrshare', 'metricool');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_configured', 'connected', 'degraded', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'credited');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'success', 'partial', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."match_decision" AS ENUM('pending', 'linked', 'created', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'whatsapp', 'slack');--> statement-breakpoint
CREATE TYPE "public"."notification_level" AS ENUM('info', 'success', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'tiktok', 'youtube', 'facebook', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."production_status" AS ENUM('concept', 'planned', 'confirmed', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('to_prepare', 'ready', 'scheduled', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('none', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."script_status" AS ENUM('idea', 'concept', 'internal_review', 'client_review', 'revising', 'approved', 'ready_to_shoot', 'shot');--> statement-breakpoint
CREATE TYPE "public"."sync_direction" AS ENUM('inbound', 'outbound', 'bidirectional');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'project_coordinator', 'content_creator', 'videographer', 'editor', 'finance', 'client');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('recorded', 'footage_upload', 'awaiting_editor', 'editing', 'internal_review', 'editor_revision', 'client_review', 'client_revision', 'approved', 'ready_to_publish', 'scheduled', 'published', 'analysis_available');--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(96) NOT NULL,
	"resource" varchar(48) NOT NULL,
	"action" varchar(32) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_unique" UNIQUE("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_portal_role" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_title" varchar(120),
	"weekly_capacity_hours" integer DEFAULT 40 NOT NULL,
	"weekly_video_capacity" integer DEFAULT 0 NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"color" varchar(9),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_members_user_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_member_id" uuid NOT NULL,
	"starts_on" timestamp with time zone NOT NULL,
	"ends_on" timestamp with time zone NOT NULL,
	"reason" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_unique" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text,
	"full_name" varchar(160) NOT NULL,
	"avatar_url" text,
	"phone" varchar(40),
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"primary_role" "user_role" DEFAULT 'editor' NOT NULL,
	"client_id" uuid,
	"locale" varchar(8) DEFAULT 'nl' NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"role" varchar(120),
	"email" varchar(320),
	"phone" varchar(40),
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_approver" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"external_name" varchar(240),
	"external_url" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_integrations_unique" UNIQUE("client_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "client_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"category" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"confidence" numeric(4, 3),
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"videos_per_month" integer DEFAULT 0 NOT NULL,
	"shoot_days_per_month" integer DEFAULT 0 NOT NULL,
	"monthly_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"includes_reporting" boolean DEFAULT true NOT NULL,
	"includes_strategy" boolean DEFAULT false NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"legal_name" varchar(200),
	"sector" varchar(120),
	"website" text,
	"logo_url" text,
	"color" varchar(9),
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"risk_level" "risk_level" DEFAULT 'none' NOT NULL,
	"risk_reason" text,
	"started_on" date,
	"coordinator_id" uuid,
	"videographer_id" uuid,
	"monthly_video_quota" integer DEFAULT 0 NOT NULL,
	"monthly_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_contact_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"reference" varchar(80),
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"renewal_months" integer DEFAULT 12 NOT NULL,
	"monthly_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"document_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" varchar(160) NOT NULL,
	"profile_url" text,
	"external_account_id" varchar(200),
	"followers" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_unique" UNIQUE("client_id","platform","handle")
);
--> statement-breakpoint
CREATE TABLE "production_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_day_id" uuid NOT NULL,
	"label" varchar(240) NOT NULL,
	"category" varchar(48) DEFAULT 'general' NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_id" uuid,
	"client_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"scheduled_on" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"location_name" varchar(200),
	"location_address" text,
	"status" "production_status" DEFAULT 'planned' NOT NULL,
	"videographer_id" uuid,
	"coordinator_id" uuid,
	"contact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule" text,
	"notes" text,
	"drive_folder_id" varchar(200),
	"frame_project_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "productions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"name" varchar(200) NOT NULL,
	"status" "production_status" DEFAULT 'planned' NOT NULL,
	"briefing" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"period" varchar(7),
	"starts_on" date,
	"due_on" date,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"status" "script_status" NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_versions_unique" UNIQUE("script_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"production_day_id" uuid,
	"title" varchar(240) NOT NULL,
	"status" "script_status" DEFAULT 'idea' NOT NULL,
	"pillar" varchar(120),
	"format" varchar(120),
	"hook" text,
	"body" text,
	"cta" text,
	"shot_list" text,
	"requirements" text,
	"location_name" varchar(200),
	"presenter" varchar(160),
	"internal_notes" text,
	"client_notes" text,
	"creator_id" uuid,
	"current_version" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"blocked_by_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_unique" UNIQUE("task_id","blocked_by_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"title" varchar(240) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"created_by_rule_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decided_by_contact_id" uuid,
	"comment" text,
	"source" varchar(32) DEFAULT 'portal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"script_id" uuid,
	"production_day_id" uuid,
	"title" varchar(240) NOT NULL,
	"status" "video_status" DEFAULT 'recorded' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"editor_id" uuid,
	"due_on" date,
	"planned_publish_on" date,
	"aspect_ratio" varchar(12) DEFAULT '9:16' NOT NULL,
	"duration_seconds" integer,
	"thumbnail_url" text,
	"frame_asset_id" varchar(200),
	"frame_project_id" varchar(200),
	"frame_url" text,
	"drive_folder_id" varchar(200),
	"current_version" integer DEFAULT 0 NOT NULL,
	"internal_revision_rounds" integer DEFAULT 0 NOT NULL,
	"client_revision_rounds" integer DEFAULT 0 NOT NULL,
	"edit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"briefing" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "editor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"delivered_at" timestamp with time zone,
	"turnaround_hours" integer,
	"briefing" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editor_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"client_id" uuid,
	"amount" numeric(10, 2) NOT NULL,
	"period" varchar(7) NOT NULL,
	"description" varchar(240),
	"is_paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"display_name" varchar(160) NOT NULL,
	"email" varchar(320),
	"is_freelance" boolean DEFAULT true NOT NULL,
	"rate_per_video" numeric(10, 2) DEFAULT '0' NOT NULL,
	"rate_per_hour" numeric(10, 2) DEFAULT '0' NOT NULL,
	"weekly_capacity" integer DEFAULT 0 NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"author_contact_id" uuid,
	"author_name" varchar(160),
	"source" varchar(32) DEFAULT 'shortclips_os' NOT NULL,
	"frame_comment_id" varchar(200),
	"timecode_ms" integer,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_comments_frame_unique" UNIQUE("frame_comment_id")
);
--> statement-breakpoint
CREATE TABLE "review_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"video_version_id" uuid,
	"visibility" "comment_visibility" DEFAULT 'internal' NOT NULL,
	"timecode_ms" integer,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"frame_comment_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "video_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"label" varchar(120),
	"frame_asset_id" varchar(200),
	"file_url" text,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"file_size_bytes" numeric(20, 0),
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_versions_unique" UNIQUE("deliverable_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "client_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period_type" varchar(16) DEFAULT 'month' NOT NULL,
	"period" varchar(10) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manual_note" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"generated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "client_reports_unique" UNIQUE("client_id","period_type","period")
);
--> statement-breakpoint
CREATE TABLE "content_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"title" varchar(240) NOT NULL,
	"scheduled_on" date NOT NULL,
	"scheduled_at" time,
	"status" "publication_status" DEFAULT 'to_prepare' NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caption" text,
	"hashtags" text,
	"cover_url" text,
	"location_tag" varchar(160),
	"content_type" varchar(80),
	"owner_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "platform",
	"measured_on" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"engagements" integer DEFAULT 0 NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"follower_delta" integer DEFAULT 0 NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"source" varchar(32) DEFAULT 'aggregate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metrics_unique" UNIQUE("client_id","platform","measured_on")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"calendar_item_id" uuid,
	"deliverable_id" uuid,
	"social_account_id" uuid,
	"platform" "platform" NOT NULL,
	"status" "publication_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_post_id" varchar(200),
	"external_url" text,
	"caption" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "publications_external_unique" UNIQUE("platform","external_post_id")
);
--> statement-breakpoint
CREATE TABLE "social_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"measured_on" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"watch_time_seconds" integer DEFAULT 0 NOT NULL,
	"avg_watch_seconds" numeric(8, 2),
	"completion_rate" numeric(5, 4),
	"retention_curve" jsonb,
	"profile_visits" integer DEFAULT 0 NOT NULL,
	"follower_delta" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer,
	"conversions" integer,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_metrics_unique" UNIQUE("publication_id","measured_on")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" varchar(240) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT '0.21' NOT NULL,
	"line_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"number" varchar(40) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"due_on" date,
	"period" varchar(7),
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"external_id" varchar(200),
	"external_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"method" varchar(40),
	"reference" varchar(120),
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"mrr" numeric(12, 2) DEFAULT '0' NOT NULL,
	"invoiced" numeric(12, 2) DEFAULT '0' NOT NULL,
	"editor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"videos_delivered" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_snapshots_unique" UNIQUE("client_id","period")
);
--> statement-breakpoint
CREATE TABLE "drive_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"drive_id" varchar(120),
	"folder_id" varchar(200) NOT NULL,
	"folder_name" varchar(400),
	"subfolder_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_token" text,
	"watch_channel_id" varchar(120),
	"watch_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_mappings_folder_unique" UNIQUE("entity_type","folder_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"name" varchar(400) NOT NULL,
	"mime_type" varchar(160),
	"size_bytes" numeric(20, 0),
	"source" "file_source" DEFAULT 'google_drive' NOT NULL,
	"external_id" varchar(240),
	"external_url" text,
	"category" varchar(64),
	"path" text,
	"parent_external_id" varchar(240),
	"is_folder" boolean DEFAULT false NOT NULL,
	"modified_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frame_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"account_id" varchar(120),
	"workspace_id" varchar(120),
	"project_id" varchar(120),
	"folder_id" varchar(120),
	"asset_id" varchar(120),
	"last_synced_at" timestamp with time zone,
	"last_payload_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frame_mappings_asset_unique" UNIQUE("entity_type","asset_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'not_configured' NOT NULL,
	"required_env" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_webhook_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"items_synced" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_event_id" varchar(240) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"signature_valid" boolean,
	"status" "event_processing_status" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_events_external_unique" UNIQUE("provider","external_event_id")
);
--> statement-breakpoint
CREATE TABLE "monday_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"board_id" varchar(60) NOT NULL,
	"group_id" varchar(60),
	"item_id" varchar(60),
	"column_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"direction" "sync_direction" DEFAULT 'inbound' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_payload_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monday_mappings_item_unique" UNIQUE("entity_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"job_type" varchar(80) NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"direction" "sync_direction" DEFAULT 'inbound' NOT NULL,
	"scope_type" varchar(40),
	"scope_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"triggered_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"type" varchar(80) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"title" varchar(300) NOT NULL,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_name" varchar(160),
	"is_client_visible" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"kind" "ai_insight_kind" NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"method" varchar(24) DEFAULT 'deterministic' NOT NULL,
	"model" varchar(80),
	"period" varchar(10),
	"is_client_visible" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category" varchar(48) DEFAULT 'general' NOT NULL,
	"description" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" varchar(320),
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"client_id" uuid,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"outcome" varchar(16) DEFAULT 'allow' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"trigger" varchar(80) NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"client_id" uuid,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "automation_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"trigger_event" varchar(80) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(32) NOT NULL,
	"source" varchar(120),
	"message" text NOT NULL,
	"stack" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_id" varchar(240) NOT NULL,
	"external_name" varchar(400) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_entity_id" uuid,
	"suggested_name" varchar(400),
	"match_score" integer DEFAULT 0 NOT NULL,
	"decision" "match_decision" DEFAULT 'pending' NOT NULL,
	"decided_entity_id" uuid,
	"conflict_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_candidates_unique" UNIQUE("run_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" "import_run_status" DEFAULT 'dry_run' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by_id" uuid,
	"committed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_unique" UNIQUE("user_id","type","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"type" varchar(80) NOT NULL,
	"level" "notification_level" DEFAULT 'info' NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" text,
	"href" text,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"dedupe_key" varchar(200),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "sop_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"category" varchar(80),
	"body" text,
	"file_id" uuid,
	"external_url" text,
	"owner_id" uuid,
	"visible_to_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sop_documents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workflow_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(24) NOT NULL,
	"key" varchar(48) NOT NULL,
	"label" varchar(80) NOT NULL,
	"color" varchar(9),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_client_visible" boolean DEFAULT false NOT NULL,
	"sla_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_statuses_unique" UNIQUE("domain","key")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_integrations" ADD CONSTRAINT "client_integrations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_knowledge" ADD CONSTRAINT "client_knowledge_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_knowledge" ADD CONSTRAINT "client_knowledge_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_videographer_id_users_id_fk" FOREIGN KEY ("videographer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_checklist_items" ADD CONSTRAINT "production_checklist_items_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_days" ADD CONSTRAINT "production_days_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_days" ADD CONSTRAINT "production_days_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_days" ADD CONSTRAINT "production_days_videographer_id_users_id_fk" FOREIGN KEY ("videographer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_days" ADD CONSTRAINT "production_days_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_by_task_id_tasks_id_fk" FOREIGN KEY ("blocked_by_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_production_day_id_production_days_id_fk" FOREIGN KEY ("production_day_id") REFERENCES "public"."production_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_assignments" ADD CONSTRAINT "editor_assignments_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_assignments" ADD CONSTRAINT "editor_assignments_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_costs" ADD CONSTRAINT "editor_costs_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_costs" ADD CONSTRAINT "editor_costs_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_costs" ADD CONSTRAINT "editor_costs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_thread_id_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_video_version_id_video_versions_id_fk" FOREIGN KEY ("video_version_id") REFERENCES "public"."video_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_generated_by_id_users_id_fk" FOREIGN KEY ("generated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD CONSTRAINT "content_calendar_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD CONSTRAINT "content_calendar_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_calendar" ADD CONSTRAINT "content_calendar_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_calendar_item_id_content_calendar_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."content_calendar"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_snapshots" ADD CONSTRAINT "revenue_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permissions_resource_idx" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "time_off_member_idx" ON "time_off" USING btree ("team_member_id","starts_on");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_client_idx" ON "users" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("primary_role");--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_integrations_provider_idx" ON "client_integrations" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "client_knowledge_client_idx" ON "client_knowledge" USING btree ("client_id","category");--> statement-breakpoint
CREATE INDEX "client_knowledge_pinned_idx" ON "client_knowledge" USING btree ("is_pinned");--> statement-breakpoint
CREATE INDEX "client_packages_client_idx" ON "client_packages" USING btree ("client_id","is_active");--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clients_coordinator_idx" ON "clients" USING btree ("coordinator_id");--> statement-breakpoint
CREATE INDEX "clients_risk_idx" ON "clients" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contracts_end_idx" ON "contracts" USING btree ("ends_on");--> statement-breakpoint
CREATE INDEX "social_accounts_client_idx" ON "social_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "production_checklist_day_idx" ON "production_checklist_items" USING btree ("production_day_id");--> statement-breakpoint
CREATE INDEX "production_days_client_idx" ON "production_days" USING btree ("client_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "production_days_date_idx" ON "production_days" USING btree ("scheduled_on");--> statement-breakpoint
CREATE INDEX "production_days_videographer_idx" ON "production_days" USING btree ("videographer_id");--> statement-breakpoint
CREATE INDEX "productions_client_idx" ON "productions" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "projects_period_idx" ON "projects" USING btree ("period");--> statement-breakpoint
CREATE INDEX "script_versions_script_idx" ON "script_versions" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "scripts_client_idx" ON "scripts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "scripts_day_idx" ON "scripts" USING btree ("production_day_id");--> statement-breakpoint
CREATE INDEX "scripts_status_idx" ON "scripts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_dependencies_task_idx" ON "task_dependencies" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "tasks_entity_idx" ON "tasks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvals_entity_idx" ON "approvals" USING btree ("kind","entity_id");--> statement-breakpoint
CREATE INDEX "approvals_client_idx" ON "approvals" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "deliverables_client_idx" ON "deliverables" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "deliverables_status_idx" ON "deliverables" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "deliverables_editor_idx" ON "deliverables" USING btree ("editor_id","status");--> statement-breakpoint
CREATE INDEX "deliverables_due_idx" ON "deliverables" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "deliverables_frame_asset_idx" ON "deliverables" USING btree ("frame_asset_id");--> statement-breakpoint
CREATE INDEX "editor_assignments_editor_idx" ON "editor_assignments" USING btree ("editor_id","is_active");--> statement-breakpoint
CREATE INDEX "editor_assignments_deliverable_idx" ON "editor_assignments" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "editor_costs_editor_idx" ON "editor_costs" USING btree ("editor_id","period");--> statement-breakpoint
CREATE INDEX "editor_costs_client_idx" ON "editor_costs" USING btree ("client_id","period");--> statement-breakpoint
CREATE INDEX "editors_user_idx" ON "editors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_comments_thread_idx" ON "review_comments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "review_threads_deliverable_idx" ON "review_threads" USING btree ("deliverable_id","visibility");--> statement-breakpoint
CREATE INDEX "review_threads_frame_idx" ON "review_threads" USING btree ("frame_comment_id");--> statement-breakpoint
CREATE INDEX "video_versions_deliverable_idx" ON "video_versions" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "video_versions_frame_idx" ON "video_versions" USING btree ("frame_asset_id");--> statement-breakpoint
CREATE INDEX "client_reports_client_idx" ON "client_reports" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "content_calendar_client_idx" ON "content_calendar" USING btree ("client_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "content_calendar_date_idx" ON "content_calendar" USING btree ("scheduled_on","status");--> statement-breakpoint
CREATE INDEX "daily_metrics_client_idx" ON "daily_metrics" USING btree ("client_id","measured_on");--> statement-breakpoint
CREATE INDEX "publications_client_idx" ON "publications" USING btree ("client_id","published_at");--> statement-breakpoint
CREATE INDEX "publications_platform_idx" ON "publications" USING btree ("platform","status");--> statement-breakpoint
CREATE INDEX "social_metrics_client_idx" ON "social_metrics" USING btree ("client_id","measured_on");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_on","status");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_client_idx" ON "payments" USING btree ("client_id","paid_on");--> statement-breakpoint
CREATE INDEX "drive_mappings_entity_idx" ON "drive_mappings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "files_client_idx" ON "files" USING btree ("client_id","category");--> statement-breakpoint
CREATE INDEX "files_external_idx" ON "files" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "files_parent_idx" ON "files" USING btree ("parent_external_id");--> statement-breakpoint
CREATE INDEX "frame_mappings_entity_idx" ON "frame_mappings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "frame_mappings_project_idx" ON "frame_mappings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integration_events_hash_idx" ON "integration_events" USING btree ("provider","payload_hash");--> statement-breakpoint
CREATE INDEX "integration_events_status_idx" ON "integration_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "monday_mappings_entity_idx" ON "monday_mappings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "monday_mappings_board_idx" ON "monday_mappings" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_provider_idx" ON "sync_jobs" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX "sync_jobs_created_idx" ON "sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_events_client_idx" ON "activity_events" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_entity_idx" ON "activity_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_events_type_idx" ON "activity_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ai_insights_client_idx" ON "ai_insights" USING btree ("client_id","kind");--> statement-breakpoint
CREATE INDEX "ai_insights_generated_idx" ON "ai_insights" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "automation_rules_trigger_idx" ON "automation_rules" USING btree ("trigger","is_enabled");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_entity_idx" ON "automation_runs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "error_logs_category_idx" ON "error_logs" USING btree ("category","occurred_at");--> statement-breakpoint
CREATE INDEX "import_candidates_run_idx" ON "import_candidates" USING btree ("run_id","entity_type");--> statement-breakpoint
CREATE INDEX "import_runs_provider_idx" ON "import_runs" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");