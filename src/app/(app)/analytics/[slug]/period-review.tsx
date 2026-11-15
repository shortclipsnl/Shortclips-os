import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BrainCircuit, FileBarChart, Lock } from "lucide-react";
import { Card, CardHeader, Table } from "@/components/ui";
import { compact, num } from "@/lib/format";
import { capitalize } from "@/lib/portal-periods";
import type { PortalResults } from "@/server/portal";
import type { PeriodReview } from "@/server/period-review";

const STATUS: Record<string, string> = {
  gegevens_verzamelen: "In de wachtrij", analyse_bezig: "Analyse bezig", klaar_voor_controle: "Wacht op controle",
  aanpassing_nodig: "Aanpassing nodig", goedgekeurd: "Goedgekeurd", gepubliceerd: "Gepubliceerd", mislukt: "Mislukt",
};
const KIND: Record<string, { t: string; c: string }> = {
  behouden: { t: "Behouden", c: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  verbeteren: { t: "Verbeteren", c: "bg-[var(--color-warn-soft)] text-[#8a5a00]" },
  testen: { t: "Testen", c: "bg-[var(--color-info-soft)] text-[var(--color-info)]" },
};

function Diff({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[var(--color-ink-faint)]">–</span>;
  if (pct === 0) return <span className="text-[var(--color-ink-faint)]">gelijk</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%
    </span>
  );
}

function Rows({ items, empty }: { items: Array<{ title: string; detail: string }>; empty: string }) {
  if (items.length === 0) return <p className="px-5 pb-4 text-sm text-[var(--color-ink-faint)]">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {items.map((it, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 px-5 py-2">
          <span className="min-w-0 truncate text-sm font-medium">{it.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">{it.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Interne aanvulling bij de gekozen maand of het gekozen kwartaal. Dezelfde
 * cijfers als de klant ziet, plus wat alleen het team nodig heeft: de
 * vergelijking, trends, wat structureel werkt en wat niet, en concrete
 * verbeterpunten voor scripts en opnames. Komt uit het Contentgeheugen.
 */
export function InternPeriodReview({ r, review }: { r: PortalResults; review: PeriodReview }) {
  const it = review.intern;
  if (!it) return null;
  const label = capitalize(review.label);
  const prev = review.prevLabel ? capitalize(review.prevLabel) : "Vorige periode";
  const next = review.mode === "kwartaal" ? "het volgende kwartaal" : review.mode === "maand" ? "de volgende maand" : "de volgende periode";
  const cmp: Array<[string, number, number, number | null]> = [
    ["Weergaven", r.prev.views, r.metrics.views, r.deltas.views],
    ["Bereik", r.prev.reach, r.metrics.reach, r.deltas.reach],
    ["Interacties", r.prev.engagements, r.metrics.engagements, r.deltas.engagements],
    ["Nieuwe volgers", r.prev.followerGrowth, r.metrics.followerGrowth, r.deltas.followerGrowth],
    ["Gepubliceerde video's", r.prev.publishedVideos, r.metrics.publishedVideos, r.deltas.publishedVideos],
  ];

  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight"><Lock className="size-3.5" /> Intern: {review.mode === "kwartaal" ? "kwartaalanalyse" : "periodeanalyse"} {label}</span>
        <span className="text-xs text-white/70">Niet zichtbaar voor de klant</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <CardHeader title={`${label} tegenover ${review.complete || review.mode === "vrij" ? prev : `dezelfde dagen in ${prev}`}`} className="p-5 pb-2" />
          <Table head={<><th className="sc-th">Statistiek</th><th className="sc-th text-right">{prev}</th><th className="sc-th text-right">{label}</th><th className="sc-th text-right">Verschil</th></>}>
            {cmp.map(([l, p, c, d]) => (
              <tr key={l}>
                <td className="sc-td font-medium">{l}</td>
                <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{num(p)}</td>
                <td className="sc-td text-right font-semibold tabular-nums">{num(c)}</td>
                <td className="sc-td text-right"><Diff pct={d} /></td>
              </tr>
            ))}
          </Table>
          {review.months.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-line)] p-4">
              {review.months.map((m) => (
                <div key={m.key} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2">
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{capitalize(m.label).replace(/ \d{4}$/, "")}</div>
                  <div className="text-base font-bold tabular-nums">{m.measured ? compact(m.views) : "–"}</div>
                  <div className="text-2xs text-[var(--color-ink-muted)]">{m.videos} video&apos;s</div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="px-5 pb-4 pt-1 text-xs text-[var(--color-ink-faint)]">Een percentage staat er alleen als er over de vergelijkingsperiode genoeg meetdagen zijn.</p>
        </Card>

        <Card padded={false}>
          <CardHeader title={`Advies voor ${next}`} subtitle="Uit het Contentgeheugen van deze klant" className="p-5 pb-2" />
          {it.recs.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-[var(--color-ink-faint)]">Nog te weinig video&apos;s met resultaten voor een onderbouwd advies.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {it.recs.map((a, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${KIND[a.kind]?.c ?? ""}`}>{KIND[a.kind]?.t ?? a.kind}</span>
                    <span className="text-sm font-semibold">{a.title}</span>
                    <span className="ml-auto text-2xs text-[var(--color-ink-faint)]">{a.status}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">{a.text}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-faint)]">Betrouwbaarheid: {it.reliability}</p>
        </Card>

        <Card padded={false}>
          <CardHeader title="Werkt structureel" subtitle="Formats, openingen, afsluitingen en lengtes boven normaal" className="p-5 pb-2" />
          <Rows items={it.strong} empty="Nog geen onderdeel dat aantoonbaar beter presteert." />
        </Card>

        <Card padded={false}>
          <CardHeader title="Presteert minder" subtitle="Aandachtspunten voor scripts en opnames" className="p-5 pb-2" />
          <Rows items={it.weak} empty="Geen onderdeel dat aantoonbaar onder normaal presteert." />
          {it.flops.length > 0 ? (
            <>
              <div className="border-t border-[var(--color-line)] px-5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Zwakste video&apos;s van {label}</div>
              <Rows items={it.flops} empty="" />
            </>
          ) : null}
        </Card>
      </div>

      {it.trends.length > 0 || review.highlights.length > 0 ? (
        <Card className="mt-5">
          <h3 className="text-sm font-semibold">Trends</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {[...review.highlights, ...it.trends].map((t, i) => (
              <li key={i} className="flex gap-2"><span className="text-[var(--color-brand-500)]">•</span><span>{t}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {review.memoryHref ? (
          <Link href={review.memoryHref} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-semibold hover:border-[var(--color-brand-500)]">
            <BrainCircuit className="size-3.5" /> Contentgeheugen van deze klant <ArrowRight className="size-3" />
          </Link>
        ) : null}
        {it.reports.map((rep) => (
          <Link key={rep.id} href={`/analytics/maandrapportages/${rep.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-semibold hover:border-[var(--color-brand-500)]">
            <FileBarChart className="size-3.5" /> Maandrapportage {rep.label}
            <span className="font-normal text-[var(--color-ink-faint)]">· {STATUS[rep.status] ?? rep.status}</span>
          </Link>
        ))}
        <span className="text-[var(--color-ink-faint)]">Deze inzichten voeden ook de Script Engine via het Contentgeheugen.</span>
      </div>
    </div>
  );
}
