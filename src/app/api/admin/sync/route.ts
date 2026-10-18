import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { integrationConfig } from "@/lib/env";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { runMetricoolSync } from "@/server/jobs/metricool-sync";
import { pullFrameProjects, pullFrameDeliverables, pullFrameComments } from "@/server/jobs/frameio-sync";
import { frameio } from "@/server/integrations/frameio";
import { runDriveSync, linkDriveFolders } from "@/server/jobs/drive-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Eén koppeling-sync handmatig starten, ONDER het eigenaar-account (sessie), dus
 * zonder CRON_SECRET. Draait alleen de koppeling die is geconfigureerd (env).
 * Gebruik: POST /api/admin/sync?which=metricool|frameio|calendar|drive
 * De nachtelijke cron blijft daarnaast gewoon draaien; dit is om meteen te
 * kunnen vullen zodra een koppeling net is ingesteld.
 */
async function handle(request: Request) {
  const viewer = await getViewer();
  if (!isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan een sync starten." }, { status: 403 });
  }

  const url = new URL(request.url);
  const which = url.searchParams.get("which");
  if (!which || !["metricool", "frameio", "calendar", "drive", "drive_link"].includes(which)) {
    return NextResponse.json({ error: "Geef ?which=metricool|frameio|calendar|drive|drive_link mee." }, { status: 400 });
  }

  const cfg = integrationConfig();

  if (which === "drive_link") {
    if (!cfg.google_drive.configured) return NextResponse.json({ ok: false, reason: "Google Drive niet geconfigureerd." }, { status: 200 });
    const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit") ?? 5)));
    return NextResponse.json({ ok: true, which, result: await linkDriveFolders(limit) });
  }

  if (which === "metricool") {
    if (!cfg.metricool.configured) return NextResponse.json({ ok: false, reason: "Metricool niet geconfigureerd (METRICOOL_USER_TOKEN ontbreekt)." }, { status: 200 });
    return NextResponse.json({ ok: true, which, result: await runMetricoolSync() });
  }
  if (which === "frameio") {
    if (!cfg.frameio.configured) return NextResponse.json({ ok: false, reason: "Frame.io niet geconfigureerd." }, { status: 200 });
    // Eerst een verbindingstest zodat de échte onderliggende fout (HTTP-status
    // van Adobe IMS / Frame.io) zichtbaar wordt bij diagnose.
    const test = await frameio.testConnection();
    const projects = await pullFrameProjects();
    const deliverables = await pullFrameDeliverables();
    const comments = await pullFrameComments();
    return NextResponse.json({ ok: true, which, test, result: { projects, deliverables, comments } });
  }
  if (which === "calendar") {
    if (!cfg.google_calendar.configured) return NextResponse.json({ ok: false, reason: "Google Agenda niet geconfigureerd (CLIENT_SECRET/REFRESH_TOKEN ontbreken)." }, { status: 200 });
    return NextResponse.json({ ok: true, which, result: await runCalendarSync() });
  }
  // drive
  if (!cfg.google_drive.configured) return NextResponse.json({ ok: false, reason: "Google Drive niet geconfigureerd." }, { status: 200 });
  return NextResponse.json({ ok: true, which, result: await runDriveSync() });
}

export const POST = handle;
