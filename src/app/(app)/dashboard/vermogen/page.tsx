import type { Metadata } from "next";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { FinanceUpload } from "@/components/finance/finance-upload";

export const metadata: Metadata = { title: "Vermogen" };
export const dynamic = "force-dynamic";

/**
 * Vermogensdashboard binnen de dashboard-schil (sidebar + topbar blijven staan).
 * Het dashboard zelf is een op zichzelf staand document; dat tonen we hier in een
 * iframe zodat alles op één plek blijft in plaats van in een los tabblad.
 */
export default async function VermogenPage() {
  await requireFinanceOwner();
  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col gap-2">
      <div className="flex justify-end"><FinanceUpload /></div>
      <iframe
        src="/dashboard/vermogen/embed"
        title="Vermogensdashboard"
        className="w-full flex-1 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]"
      />
    </div>
  );
}
