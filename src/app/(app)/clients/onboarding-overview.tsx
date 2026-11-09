import Link from "next/link";
import type { OnboardingListRow } from "@/server/onboarding";
import { formatDate } from "@/lib/format";

const TONE: Record<OnboardingListRow["status"], string> = {
  "Actie nodig": "border-[var(--color-bad)] text-[var(--color-bad)]",
  Bezig: "border-[var(--color-warn)] text-[var(--color-warn)]",
  Afgerond: "border-[var(--color-good)] text-[var(--color-good)]",
};

/** Compact overzicht van lopende onboardings bovenaan Klanten. Verborgen als er niets loopt. */
export function OnboardingOverview({ rows }: { rows: OnboardingListRow[] }) {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => r.status !== "Afgerond").length;
  return (
    <section className="sc-card mb-5 overflow-hidden" aria-label="Onboarding nieuwe klanten">
      <div className="flex items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold">In onboarding</h2>
        <span className="text-xs text-[var(--color-ink-muted)]">{open} lopend · afgeronde blijven 14 dagen zichtbaar</span>
      </div>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-muted)]">
              <th className="px-5 py-2 font-medium">Klant</th>
              <th className="px-3 py-2 font-medium">Verantwoordelijke</th>
              <th className="px-3 py-2 font-medium">Startdatum</th>
              <th className="w-56 px-3 py-2 font-medium">Voortgang</th>
              <th className="px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clientId} className="border-t border-[var(--color-line)]">
                <td className="px-5 py-2.5">
                  <Link href={`/clients/${r.slug}?tab=onboarding`} className="font-medium hover:underline">{r.name}</Link>
                  {r.next && r.status !== "Afgerond" ? <p className="max-w-[360px] truncate text-xs text-[var(--color-ink-muted)]">{r.next}</p> : null}
                </td>
                <td className="px-3 py-2.5 text-[var(--color-ink-muted)]">{r.pm ?? "–"}</td>
                <td className="px-3 py-2.5 text-[var(--color-ink-muted)]">{r.startOn ? formatDate(r.startOn) : "–"}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <div className="h-full rounded-full bg-[var(--color-brand-500)]" style={{ width: `${Math.round((r.done / r.total) * 100)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-[var(--color-ink-muted)]">{r.done}/{r.total}</span>
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
