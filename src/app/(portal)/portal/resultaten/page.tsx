import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Sparkles } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalResults } from "@/server/portal";
import { Card } from "@/components/ui";
import { CountUp } from "@/components/portal/count-up";
import { compact } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { days: 30, label: "30 dagen" },
  { days: 90, label: "3 maanden" },
];

function Delta({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold ${
        up ? "text-[#2fd27a]" : "text-[#ffb020]"
      }`}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%
    </span>
  );
}

function Metric({ label, value, prefix = "", pct }: { label: string; value: number; prefix?: string; pct?: number | null }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</p>
      <CountUp value={value} prefix={prefix} className="mt-1 block text-2xl font-semibold tabular-nums text-[var(--color-ink)]" />
      {pct !== undefined ? <Delta pct={pct} /> : null}
    </Card>
  );
}

export default async function PortalResultatenPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requirePortal();
  const { periode } = await searchParams;
  const days = periode === "90" ? 90 : 30;
  const r = await getPortalResults(viewer, days);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resultaten</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Hoe je content presteert — gecombineerd over je kanalen.
          </p>
        </div>
        <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
          {PERIODS.map((p) => {
            const active = p.days === days;
            return (
              <Link
                key={p.days}
                href={`/portal/resultaten?periode=${p.days}`}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      {r.hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Weergaven" value={r.metrics.views} pct={r.deltas.views} />
            <Metric label="Bereik" value={r.metrics.reach} pct={r.deltas.reach} />
            <Metric label="Interacties" value={r.metrics.engagements} pct={r.deltas.engagements} />
            <Metric label="Nieuwe volgers" value={r.metrics.followerGrowth} prefix={r.metrics.followerGrowth >= 0 ? "+" : ""} />
          </div>

          {r.insight ? (
            <Card className="border-[#2e90fa]/25 bg-[rgba(46,144,250,0.06)]">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]">
                  <Sparkles className="size-[18px]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Wat valt op</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">{r.insight}</p>
                </div>
              </div>
            </Card>
          ) : null}

          {r.byPlatform.length >= 2 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">Per platform</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.byPlatform.map((p) => (
                  <Card key={p.platform}>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-white/40"
                        style={{ background: PLATFORM[p.platform]?.color ?? "#888" }}
                      />
                      <span className="text-sm font-semibold text-[var(--color-ink)]">
                        {PLATFORM[p.platform]?.label ?? p.platform}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Weergaven</div>
                        <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-ink)]">{compact(p.views)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Bereik</div>
                        <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-ink)]">{compact(p.reach)}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-xs text-[var(--color-ink-faint)]">
            Vergeleken met de vorige {days} dagen. Cijfers komen automatisch uit je gekoppelde kanalen.
          </p>
        </>
      ) : (
        <Card className="flex flex-col items-start gap-3 border-dashed p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-brand-600)]">
            <BarChart3 className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">Je resultaten worden gekoppeld</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">
              Zodra je kanalen verbonden zijn, verschijnen hier automatisch je weergaven, bereik,
              interacties en volgersgroei — per periode en met wat erin opvalt. Je hoeft nu niets te doen.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
