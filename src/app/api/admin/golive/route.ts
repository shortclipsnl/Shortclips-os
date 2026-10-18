import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { curateTeam } from "@/server/jobs/team-curate";
import { setupMissingTeamLogins } from "@/server/jobs/team-login-setup";
import { applyClientLogos } from "@/server/jobs/client-logos-apply";
import { cleanupDeliverables } from "@/server/jobs/deliverables-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Eenmalige go-live-setup, uitgevoerd ONDER het eigenaar-account (sessie), dus
 * zonder CRON_SECRET nodig. Alleen de eigenaar mag dit aanroepen. Idempotent en
 * niet-destructief:
 *  1. team.curate  — zorgt dat het echte team als teamleden bestaat (titels/rol).
 *  2. logins       — geeft alleen teamleden zónder wachtwoord een persoonlijk
 *                    wachtwoord; bestaande logins blijven ongemoeid.
 *  3. logos        — zet geverifieerde klantlogo's alleen waar nog geen logo staat.
 * Geeft de nieuw aangemaakte inloggegevens terug zodat de eigenaar ze eenmalig
 * kan verspreiden.
 */
async function handle() {
  const viewer = await getViewer();
  if (!isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de go-live-setup uitvoeren." }, { status: 403 });
  }

  const team = await curateTeam();
  const logins = await setupMissingTeamLogins();
  const logos = await applyClientLogos();
  const deliverables = await cleanupDeliverables();

  return NextResponse.json({ ok: true, team, logins, logos, deliverables });
}

// Bewust alleen POST: muteert data, dus niet per ongeluk via een GET/prefetch.
export const POST = handle;
