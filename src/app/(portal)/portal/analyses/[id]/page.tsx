import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalReportDetail } from "@/server/reports/service";
import type { Gerealiseerd, Vooruitblik } from "@/server/reports/realized";

export const metadata: Metadata = { title: "Maandanalyse" };
export const dynamic = "force-dynamic";

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn" };
const platLabel = (p: string) => PLATFORM[p] ?? p;
const nf = (n: number) => new Intl.NumberFormat("nl-NL").format(n);
const fmtDag = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
const fmtPub = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Donkerblauwe statistiektegel in de huisstijl. */
function Tile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)] px-4 py-3.5">
      <div className="text-2xl font-bold tabular-nums text-[var(--sc-ink,#fff)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--sc-ink-muted,#9aa3b2)]">{label}</div>
    </div>
  );
}

function Chip({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${accent ? "bg-[var(--sc-accent,#2E90FA)]/15 text-[var(--sc-accent,#2E90FA)]" : "border border-[var(--sc-line,#243044)] text-[var(--sc-ink-muted,#c3cad6)]"}`}>
      {children}
    </span>
  );
}

export default async function PortalAnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePortal();
  const report = await getPortalReportDetail(viewer, id);
  if (!report) notFound();

  const g = (report.totals as { gerealiseerd?: Gerealiseerd }).gerealiseerd;
  const vb = (report.totals as { vooruitblik?: Vooruitblik }).vooruitblik;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6">
      <Link href="/portal/analyses" className="inline-flex items-center gap-1.5 text-sm text-[var(--sc-ink-muted,#9aa3b2)] hover:text-[var(--sc-ink,#fff)]">
        <ArrowLeft className="size-4" /> Alle analyses
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold capitalize text-[var(--sc-ink,#fff)]">{report.periodLabel}</h1>
          {report.approvedAt ? <p className="text-xs text-[var(--sc-ink-muted,#9aa3b2)]">Gepubliceerd op {fmtPub(report.approvedAt)}</p> : null}
        </div>
        <a
          href={`/api/portal/maandrapport/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--sc-accent,#2E90FA)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <FileDown className="size-4" /> Download PDF
        </a>
      </div>

      {/* Samenvatting (persoonlijke klanttekst). */}
      {report.klanttekst.trim() ? (
        <div className="mt-5 rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)] p-5 text-sm leading-relaxed whitespace-pre-line text-[var(--sc-ink-muted,#c3cad6)]">
          {report.klanttekst.trim()}
        </div>
      ) : null}

      {/* Sectie 1 — Dit hebben we gerealiseerd. */}
      {g ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--sc-ink,#fff)]">Dit hebben we gerealiseerd</h2>
          <p className="mt-1 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">Van opname tot publicatie — concreet wat we deze maand voor jullie hebben gedaan.</p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile value={g.opnamedagen.aantal} label={g.opnamedagen.aantal === 1 ? "Opnamedag" : "Opnamedagen"} />
            <Tile value={nf(g.geproduceerd)} label="Video's geproduceerd" />
            <Tile value={nf(g.opgeleverd)} label="Video's opgeleverd" />
            <Tile value={nf(g.gepubliceerd)} label="Video's gepubliceerd" />
            <Tile value={g.kanalen.length} label={g.kanalen.length === 1 ? "Kanaal" : "Kanalen"} />
            <Tile value={g.formats.length} label={g.formats.length === 1 ? "Format ingezet" : "Formats ingezet"} />
          </div>

          {g.opnamedagen.datums.length ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-ink-muted,#9aa3b2)]">Opnamedagen</h3>
              <div className="mt-2 flex flex-wrap gap-2">{g.opnamedagen.datums.map((d) => <Chip key={d}>{fmtDag(d)}</Chip>)}</div>
            </div>
          ) : null}

          {g.kanalen.length || g.formats.length ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-ink-muted,#9aa3b2)]">Kanalen &amp; formats</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {g.kanalen.map((k) => <Chip key={k}>{platLabel(k)}</Chip>)}
                {g.formats.map((f) => <Chip key={f.naam} accent>{f.naam} · {f.aantal}</Chip>)}
              </div>
            </div>
          ) : null}

          {g.publicaties.length ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-ink-muted,#9aa3b2)]">Wat we publiceerden</h3>
              <ul className="mt-2 divide-y divide-[var(--sc-line,#243044)] overflow-hidden rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)]">
                {g.publicaties.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className="font-medium tabular-nums text-[var(--sc-ink,#fff)]">
                      {[p.datum ? fmtDag(p.datum) : "", p.tijd ? `${p.tijd} uur` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--sc-ink-muted,#c3cad6)]">{p.titel}</span>
                    {p.platforms.length ? <span className="text-xs text-[var(--sc-ink-muted,#9aa3b2)]">{p.platforms.map(platLabel).join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!g.pipelineBijgehouden && g.gepubliceerd > 0 ? (
            <p className="mt-4 text-xs text-[var(--sc-ink-muted,#9aa3b2)]">
              De interne productiestatus is deze maand niet volledig bijgehouden, dus &ldquo;geproduceerd&rdquo; en &ldquo;opgeleverd&rdquo; staan op 0. De publicatiecijfers kloppen wel.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Sectie 5 — Dit staat er volgende maand gepland. */}
      {vb && (vb.volgendeOpnamedag || vb.publicaties.length || vb.klantacties.length) ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--sc-ink,#fff)]">Dit staat er volgende maand gepland</h2>
          <p className="mt-1 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">Zo werken we alvast vooruit voor jullie.</p>

          {vb.volgendeOpnamedag ? (
            <div className="mt-4 rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-accent,#2E90FA)]">Volgende opnamedag</p>
              <p className="mt-1 font-semibold text-[var(--sc-ink,#fff)]">{fmtDag(vb.volgendeOpnamedag.datum)} — {vb.volgendeOpnamedag.titel}</p>
              <p className="mt-0.5 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">Script: {vb.volgendeOpnamedag.scriptStatusLabel}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--sc-ink-muted,#9aa3b2)]">De volgende opnamedag is nog niet ingepland — die stemmen we binnenkort met jullie af.</p>
          )}

          {vb.publicaties.length ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-ink-muted,#9aa3b2)]">Geplande publicaties</h3>
              <ul className="mt-2 divide-y divide-[var(--sc-line,#243044)] overflow-hidden rounded-2xl border border-[var(--sc-line,#243044)] bg-[var(--sc-glass,#111827)]">
                {vb.publicaties.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className="font-medium tabular-nums text-[var(--sc-ink,#fff)]">
                      {[p.datum ? fmtDag(p.datum) : "", p.tijd ? `${p.tijd} uur` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--sc-ink-muted,#c3cad6)]">{p.titel}</span>
                    {p.platforms.length ? <span className="text-xs text-[var(--sc-ink-muted,#9aa3b2)]">{p.platforms.map(platLabel).join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {vb.klantacties.length ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-ink-muted,#9aa3b2)]">Wat we nog van jullie nodig hebben</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--sc-ink-muted,#c3cad6)]">
                {vb.klantacties.map((a, i) => (
                  <li key={i}>• <span className="font-medium text-[var(--sc-ink,#fff)]">{a.titel}</span> — {a.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
