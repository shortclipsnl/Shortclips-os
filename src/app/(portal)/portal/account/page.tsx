import type { Metadata } from "next";
import { requirePortal } from "@/server/auth/context";
import { Avatar, Card } from "@/components/ui";
import { ChangePasswordCard } from "@/app/(app)/account/change-password";

export const metadata: Metadata = { title: "Mijn account" };
export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const viewer = await requirePortal();

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

        <ChangePasswordCard />
      </div>
    </div>
  );
}
