import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";

export const metadata: Metadata = { title: "Vermogen" };
export const dynamic = "force-dynamic";

/**
 * Vermogensdashboard binnen de dashboard-schil (sidebar + topbar blijven staan).
 * Het dashboard zelf is een op zichzelf staand document; dat tonen we hier in een
 * iframe zodat alles op één plek blijft in plaats van in een los tabblad.
 */
export default async function VermogenPage() {
  await requireOwner();
  return (
    <div className="h-[calc(100vh-6.5rem)]">
      <iframe
        src="/dashboard/vermogen/embed"
        title="Vermogensdashboard"
        className="size-full rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]"
      />
    </div>
  );
}
