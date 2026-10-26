import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";
import { getPortalSettings } from "@/server/portal-settings";
import { Card, PageHeader } from "@/components/ui";
import { PortalSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Klantportaal-instellingen" };
export const dynamic = "force-dynamic";

export default async function PortaalSettingsPage() {
  await requireOwner();
  const settings = await getPortalSettings();
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Klantportaal — termijnen & voorwaarden"
        description="De feedbacktermijnen, annuleringsvoorwaarden en bedragen die klanten in hun portaal zien. Pas ze hier aan — ze worden nergens hardcoded en zijn direct zichtbaar bij de klant."
      />
      <Card>
        <PortalSettingsForm initial={settings} />
      </Card>
    </div>
  );
}
