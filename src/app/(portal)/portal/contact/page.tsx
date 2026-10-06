import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact } from "@/server/portal";
import { Avatar, buttonClass, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function PortalContactPage() {
  const viewer = await requirePortal();
  const contact = await getPortalContact(viewer);
  const name = contact?.coordinatorName ?? "Je ShortClips-team";
  const email = contact?.coordinatorEmail ?? "info@shortclips.nl";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contact</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Je vaste aanspreekpunt bij ShortClips.
        </p>
      </div>

      <Card className="max-w-md">
        <div className="flex items-center gap-4">
          <Avatar name={name} size={56} />
          <div className="min-w-0">
            <p className="text-base font-semibold text-[var(--color-ink)]">{name}</p>
            <p className="text-sm text-[var(--color-ink-muted)]">Jouw contactpersoon</p>
          </div>
        </div>
        <div className="mt-5">
          <a href={`mailto:${email}`} className={buttonClass({ variant: "primary" })}>
            <Mail className="size-4" /> Stuur een bericht
          </a>
        </div>
        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
          Vragen over je video&apos;s, planning of samenwerking? Je contactpersoon helpt je graag.
        </p>
      </Card>
    </div>
  );
}
