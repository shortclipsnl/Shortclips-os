import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { vapidPublicKey } from "@/server/push";
import { env } from "@/lib/env";
import { InstallGuide } from "@/components/portal-app/install-guide";

export const metadata: Metadata = { title: "De Shortclips app" };
export const dynamic = "force-dynamic";

/** Installatiepagina: herkent iPhone of Android en toont de juiste stappen. */
export default async function PortalAppPage({ searchParams }: { searchParams: Promise<{ welkom?: string }> }) {
  await requirePortal();
  const { welkom } = await searchParams;
  const portalUrl = env.APP_URL.replace(/\/$/, "").replace(/^https?:\/\//, "");

  return (
    <div className="max-w-[560px]">
      <h1 className="text-xl font-bold text-[var(--color-ink)]">
        {welkom ? "Welkom bij je Shortclips omgeving" : "De Shortclips app"}
      </h1>
      <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">
        {welkom
          ? "Zet je omgeving als app op je telefoon. Dan open je hem met één tik en krijg je een seintje als er iets voor je klaarstaat."
          : "Je scripts, video's, planning en resultaten met één tik op je telefoon, plus een seintje als er iets voor je klaarstaat."}
      </p>
      <InstallGuide vapidPublicKey={vapidPublicKey()} portalUrl={portalUrl} />
      <p className="mt-5 text-xs text-[var(--color-ink-faint)]">
        Je hebt geen App Store of extra account nodig. Je logt in met hetzelfde e-mailadres en wachtwoord als hier.
      </p>
    </div>
  );
}
