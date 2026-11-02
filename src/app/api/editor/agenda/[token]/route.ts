import { NextResponse } from "next/server";
import { buildEditorIcal, resolveUserByIcalToken } from "@/server/editor-ical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persoonlijke iCal-agendafeed van een editor. Token-geauthenticeerd (geen login):
 * de abonnementslink bevat het geheime token. Toont uitsluitend de deadlines van
 * de aan die editor toegewezen video's. Google Agenda ververst deze URL periodiek.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  const user = await resolveUserByIcalToken(token);
  if (!user) return new NextResponse("Agenda niet gevonden of ingetrokken.", { status: 404 });

  const ics = await buildEditorIcal(user);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=\"shortclips-agenda.ics\"",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
