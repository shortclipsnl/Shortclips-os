import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, activeDriver } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Eenvoudige healthcheck voor monitoring en deploys. */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      database: { driver: activeDriver(), latencyMs: Date.now() - started },
      time: new Date().toISOString(),
    });
  } catch (error) {
    // Details alleen in de serverlog; de publieke healthcheck lekt geen
    // database-/verbindingsinformatie naar anonieme bellers.
    console.error("[health] database niet bereikbaar:", error);
    return NextResponse.json(
      { status: "error", database: { driver: activeDriver() } },
      { status: 503 },
    );
  }
}
