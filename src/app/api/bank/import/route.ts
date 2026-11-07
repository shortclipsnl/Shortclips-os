import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { importCamtBestand } from "@/server/bank/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Machine-import van Knab CAMT.053-bestanden (voor de geplande maandtaak).
 * Body: { "bestanden": [{ "naam": "...xml", "inhoud": "<?xml ..." }] }
 * Beveiligd met KOSTEN_IMPORT_TOKEN (Bearer), dezelfde sleutel als de
 * Kostenmonitor-import. Zonder dat geheim is het endpoint dicht.
 * Idempotent: bestaande boekingen worden overgeslagen, nooit gewijzigd.
 */
function authorized(request: Request): boolean {
  const secret = env.KOSTEN_IMPORT_TOKEN;
  if (!secret) return false;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Niet toegestaan. Stuur KOSTEN_IMPORT_TOKEN mee als Bearer-token." }, { status: 401 });
  }
  let body: { bestanden?: { naam?: string; inhoud?: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }
  const bestanden = Array.isArray(body.bestanden) ? body.bestanden : [];
  if (!bestanden.length) return NextResponse.json({ error: "Verwacht { bestanden: [{ naam, inhoud }] }." }, { status: 400 });

  const resultaten = [];
  const fouten = [];
  for (const f of bestanden) {
    try {
      resultaten.push(await importCamtBestand(db, String(f.naam ?? "camt053.xml"), String(f.inhoud ?? "")));
    } catch (e) {
      fouten.push({ bestand: f.naam, fout: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: fouten.length === 0, resultaten, fouten }, { status: resultaten.length ? 200 : 400 });
}
