import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/server/quotes/pandadoc-client";
import { syncPandaDocDocument } from "@/server/quotes/pandadoc-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PandaDoc-webhook: bij elke gebeurtenis (status gewijzigd, bekeken,
 * ondertekend, bijgewerkt) haalt het portaal het document direct opnieuw op bij
 * PandaDoc. We vertrouwen dus nooit de inhoud van de webhook zelf, alleen het
 * document-id; PandaDoc blijft de bron. Beveiligd met de HMAC-handtekening.
 */
export async function POST(request: Request) {
  if (!env.PANDADOC_WEBHOOK_KEY) {
    return NextResponse.json({ error: "Niet geconfigureerd: PANDADOC_WEBHOOK_KEY ontbreekt." }, { status: 503 });
  }
  const raw = await request.text();
  const url = new URL(request.url);
  const signature = url.searchParams.get("signature") ?? request.headers.get("x-pd-signature");
  if (!verifyWebhookSignature(raw, signature, env.PANDADOC_WEBHOOK_KEY)) {
    return NextResponse.json({ error: "Ongeldige handtekening." }, { status: 401 });
  }

  let events: unknown;
  try {
    events = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }

  // PandaDoc stuurt een lijst gebeurtenissen; elk met data.id (document-id).
  const list = Array.isArray(events) ? events : [events];
  const ids = new Set<string>();
  for (const ev of list) {
    const e = ev as { event?: string; data?: { id?: string } };
    if (e?.event === "document_deleted") continue;
    if (typeof e?.data?.id === "string") ids.add(e.data.id);
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      await syncPandaDocDocument(id);
      results.push({ id, ok: true });
    } catch (err) {
      console.error("[pandadoc.webhook]", id, err);
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Altijd 200: PandaDoc hoeft niet te herhalen; de periodieke sync vangt fouten op.
  return NextResponse.json({ ok: true, results });
}
