import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer, isOwner } from "@/server/auth/context";
import { resetTeamLogin } from "@/server/jobs/team-login-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ userId: z.string().uuid() });

/**
 * Stelt voor één teamlid een nieuw wachtwoord in en geeft het éénmalig terug.
 * Alleen de eigenaar mag dit, onder de eigen sessie (geen CRON_SECRET).
 */
async function handle(req: Request) {
  const viewer = await getViewer();
  if (!isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan wachtwoorden opnieuw instellen." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 });
  }

  const result = await resetTeamLogin(parsed.data.userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 404 });
  }
  return NextResponse.json(result);
}

export const POST = handle;
