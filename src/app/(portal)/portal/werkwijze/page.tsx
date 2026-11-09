import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { getPortalProfile } from "@/server/portal";
import { ZoWerkenWij, type Pakket } from "./zo-werken-wij";

export const metadata: Metadata = { title: "Zo werken wij" };
export const dynamic = "force-dynamic";

/**
 * "Zo werken wij": de terugkerende maandcyclus van Shortclips. Laat zien hoe
 * weinig de klant zelf hoeft te doen en wat Shortclips allemaal regelt.
 * Stap 9 en 10 volgen het pakket uit het klantdossier (advertenties of zelf
 * publiceren); verder is de inhoud voor iedere klant gelijk.
 */
export default async function PortalZoWerkenWijPage() {
  const viewer = await requirePortal();
  const profile = await getPortalProfile(viewer);

  const pakket: Pakket =
    profile.contentFocus === "advertentie"
      ? "advertentie"
      : !profile.weHandlePosting
        ? "zelf-publiceren"
        : "organisch";

  return <ZoWerkenWij pakket={pakket} />;
}
