import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { setupMissingTeamLogins } from "@/server/jobs/team-login-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Geeft teamleden zónder wachtwoord een persoonlijk inlogwachtwoord, zodat ze op
 * het interne dashboard kunnen inloggen. Draait onder het eigenaar-account (geen
 * CRON_SECRET nodig) en alleen de eigenaar mag het aanroepen. Bestaande logins
 * blijven ongemoeid. De nieuwe inloggegevens komen terug in het antwoord, zodat
 * de eigenaar ze eenmalig kan doorgeven (ze staan nergens anders).
 */
async function handle() {
  const viewer = await getViewer();
  if (!isOwner(viewer)) {
    return NextResponse.json(
      { error: "Alleen de eigenaar kan inloggegevens aanmaken." },
      { status: 403 },
    );
  }

  const result = await setupMissingTeamLogins();
  return NextResponse.json(result);
}

// Bewust alleen POST: muteert data, dus niet per ongeluk via een GET/prefetch.
export const POST = handle;
