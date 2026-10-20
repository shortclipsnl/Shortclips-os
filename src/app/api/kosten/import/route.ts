import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { importKostenData } from "@/server/kosten/import-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Maandelijkse import van de Kostenmonitor.
 *
 * De geplande taak die op de 1e DigiBoox uitleest, stuurt het exportformaat
 * (dezelfde JSON als voorheen) hierheen. Alleen de maanden die in de payload
 * zitten worden vervangen; de rest blijft staan.
 *
 * Beveiligd met KOSTEN_IMPORT_TOKEN als Bearer-token — zonder dat geheim is het
 * endpoint dicht.
 */
function authorized(request: Request): boolean {
  const secret = env.KOSTEN_IMPORT_TOKEN;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Niet toegestaan. Zet KOSTEN_IMPORT_TOKEN en stuur die mee als Bearer-token." },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON in de body." }, { status: 400 });
  }

  try {
    // Geen onlyNewMonths: het endpoint is gezaghebbend en vervangt de maanden
    // die het meekrijgt (per maand eerst verwijderen, dan opnieuw invoegen).
    const result = await importKostenData(db, payload as never, {});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende fout bij importeren.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
