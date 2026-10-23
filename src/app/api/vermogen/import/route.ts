import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { upsertVermogenDocs } from "@/server/vermogen/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Maandelijkse import van het vermogensdashboard.
 *
 * De geplande taak die DigiBoox/bankexports uitleest, stuurt het exportformaat
 * ({ "docs": { "<pad>": data } }) hierheen. Elk meegestuurd pad wordt met
 * upsert opgeslagen; verwijderen kan via deze route niet.
 *
 * Beveiligd met VERMOGEN_IMPORT_TOKEN als Bearer-token — zonder dat geheim is
 * het endpoint dicht (dus geen sessie, bedoeld voor machines).
 */
function authorized(request: Request): boolean {
  const secret = env.VERMOGEN_IMPORT_TOKEN;
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
      { error: "Niet toegestaan. Zet VERMOGEN_IMPORT_TOKEN en stuur die mee als Bearer-token." },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON in de body." }, { status: 400 });
  }

  const docs = (payload as { docs?: unknown })?.docs;
  if (!docs || typeof docs !== "object" || Array.isArray(docs)) {
    return NextResponse.json({ error: "Verwacht { \"docs\": { \"<pad>\": data } }." }, { status: 400 });
  }

  const count = await upsertVermogenDocs(docs as Record<string, unknown>);
  return NextResponse.json({ ok: true, imported: count });
}
