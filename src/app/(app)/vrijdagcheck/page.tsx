import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getVrijdagcheck } from "@/server/vrijdagcheck";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Vrijdagcheck" };
export const dynamic = "force-dynamic";

export default async function VrijdagcheckPage() {
  await requireInternal();
  const { weekLabel, checks, okCount } = await getVrijdagcheck();
  const allGood = okCount === checks.length;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Vrijdagcheck"
        description={`Staat volgende week (${weekLabel}) rond? Vijf vinkjes — scripts, opnames, publicaties, vervanging en deadlines — dan begint maandag zonder verrassingen.`}
      />

      {/* Score in één oogopslag. */}
      <div className={`mb-5 flex items-center gap-3 rounded-[var(--radius-lg)] px-5 py-4 ${allGood ? "bg-[var(--color-good-soft)]" : "bg-[var(--color-warn-soft)]"}`}>
        {allGood ? (
          <CheckCircle2 className="size-7 shrink-0 text-[var(--color-good)]" strokeWidth={2} />
        ) : (
          <AlertTriangle className="size-7 shrink-0 text-[var(--color-warn)]" strokeWidth={2} />
        )}
        <div>
          <p className="text-base font-bold tracking-tight">{okCount}/{checks.length} op orde</p>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {allGood ? "Alles staat klaar voor volgende week. 🎉" : "Een paar punten vragen nog aandacht vóór maandag."}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {checks.map((c) => (
          <div
            key={c.key}
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            style={{ borderLeft: `4px solid ${c.ok ? "var(--color-good)" : "var(--color-warn)"}` }}
          >
            <div className="flex items-center gap-3 px-5 py-3.5">
              {c.ok ? (
                <CheckCircle2 className="size-5 shrink-0 text-[var(--color-good)]" />
              ) : (
                <AlertTriangle className="size-5 shrink-0 text-[var(--color-warn)]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">{c.label}</p>
                <p className="text-xs text-[var(--color-ink-muted)]">{c.summary}</p>
              </div>
              <Link
                href={c.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-2xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                Bekijken <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {!c.ok && c.items.length > 0 ? (
              <ul className="border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)]/40 px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
                {c.items.slice(0, 8).map((it, i) => (
                  <li key={i} className="flex gap-2 py-0.5">
                    <span className="text-[var(--color-warn)]">•</span>
                    <span>{it}</span>
                  </li>
                ))}
                {c.items.length > 8 ? <li className="py-0.5 pl-4 text-[var(--color-ink-faint)]">… en {c.items.length - 8} meer</li> : null}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
