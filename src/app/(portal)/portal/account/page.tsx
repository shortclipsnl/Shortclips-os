import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { Avatar, Card } from "@/components/ui";
import { ChangePasswordCard } from "@/app/(app)/account/change-password";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import { CardHeader } from "@/components/ui";
import { getNotificationPreferences } from "@/server/client-app";
import { vapidPublicKey } from "@/server/push";
import { PushToggle } from "@/components/portal-app/push-toggle";
import { NotificationPreferences } from "@/components/portal-app/notification-preferences";
import { PasskeyManager } from "@/components/portal-app/passkey";
import { listMyPasskeys } from "@/server/auth/passkeys";

export const metadata: Metadata = { title: "Mijn account" };
export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const viewer = await requirePortal();
  const [prefs, keys] = await Promise.all([getNotificationPreferences(viewer.id), listMyPasskeys()]);

  return (
    <div className="max-w-[560px]">
      <h1 className="mb-4 text-xl font-bold text-[var(--color-ink)]">Mijn account</h1>
      <div className="space-y-5">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={viewer.fullName} size={52} />
            <div>
              <p className="text-lg font-semibold text-[var(--color-ink)]">{viewer.fullName}</p>
              <p className="text-sm text-[var(--color-ink-muted)]">{viewer.email}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div id="meldingen" className="scroll-mt-20" />
          <CardHeader title="Meldingen op dit apparaat" subtitle="Een seintje op je telefoon zodra er iets voor je klaarstaat." />
          <div className="mt-4">
            <PushToggle vapidPublicKey={vapidPublicKey()} />
          </div>
          <Link href="/portal/app" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <Smartphone className="size-4" /> De app op je telefoon zetten
          </Link>
        </Card>

        <Card>
          <div id="inloggen" className="scroll-mt-20" />
          <CardHeader
            title="Snel inloggen"
            subtitle="Log in met Face ID, Touch ID of je vingerafdruk in plaats van je wachtwoord. Je gezicht of vingerafdruk blijft op je telefoon; Shortclips ziet die nooit."
          />
          <div className="mt-4">
            <PasskeyManager initial={keys} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Waarover wil je een melding?" />
          <div className="mt-4">
            <NotificationPreferences initial={prefs} />
          </div>
        </Card>

        <ChangePasswordCard />
      </div>
    </div>
  );
}
