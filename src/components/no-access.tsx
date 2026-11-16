import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Rustige melding als iemand een beheerpagina opent die niet voor hem of haar
 * is (bijvoorbeeld via een oude link). Zonder technische details en zonder de
 * algemene foutpagina "Er ging iets mis".
 */
export function NoAccess({ what = "Dit onderdeel" }: { what?: string }) {
  return (
    <div className="mx-auto max-w-[560px] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
      <Lock className="mx-auto size-6 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
      <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">{what} is alleen voor de beheerder.</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Je hoeft hier niets te doen. Technische zaken worden centraal door Jarno opgevolgd.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold text-[var(--color-brand-600)] hover:underline">
        Terug naar Vandaag
      </Link>
    </div>
  );
}
