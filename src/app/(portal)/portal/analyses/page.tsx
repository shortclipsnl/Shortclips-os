import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalMonthlyReports } from "@/server/reports/service";

export const metadata: Metadata = { title: "Maandanalyses" };
export const dynamic = "force-dynamic";

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export default async function PortalAnalysesPage() {
  const viewer = await requirePortal();
  const reports = await getPortalMonthlyReports(viewer);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6">
      <h1 className="text-xl font-semibold text-[var(--sc-ink,#fff)]">Maandelijkse analyses</h1>
      <p className="mt-1 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">
        Elke maand bekijken we jullie resultaten en delen we onze belangrijkste inzichten en aanpak voor de volgende maand.
      </p>

      {reports.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)] p-6 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">
          Er staat nog geen maandanalyse klaar. Zodra de eerste klaar is, verschijnt die hier.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/portal/analyses/${r.id}`}
              className="block rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)] p-5 transition hover:border-[var(--sc-accent,#2E90FA)]/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-base font-semibold capitalize text-[var(--sc-ink,#fff)]">{r.periodLabel}</p>
                  {r.publishedAt ? <p className="text-xs text-[var(--sc-ink-muted,#9aa3b2)]">Gepubliceerd op {fmt(r.publishedAt)}</p> : null}
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sc-accent,#2E90FA)]">
                  Bekijk analyse <ArrowRight className="size-4" />
                </span>
              </div>
              {r.samenvatting ? <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-[var(--sc-ink-muted,#c3cad6)]">{r.samenvatting}</p> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
