import Link from "next/link";
import { ArrowRight, BrainCircuit, Briefcase, CircleDashed, Compass, FileBarChart, Gauge, Lightbulb, Target } from "lucide-react";
import { capitalize } from "@/lib/portal-periods";
import { compact, num } from "@/lib/format";
import type { PeriodReview } from "@/server/period-review";
import { CopySummary } from "./copy-summary";

/** Label dat laat zien of iets gemeten is of een afgeleide conclusie. */
function BasisTag({ kind }: { kind: "gemeten" | "afgeleid" | "niet" }) {
  const map = {
    gemeten: { t: "Gemeten", c: "bg-[var(--st-green-bg)] text-[var(--st-green)]" },
    afgeleid: { t: "Afgeleid", c: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]" },
    niet: { t: "Nog niet gemeten", c: "bg-[var(--st-grey-bg)] text-[var(--st-grey)]" },
  } as const;
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${map[kind].c}`}>{map[kind].t}</span>;
}

function Head({ icon, kicker, title, sub }: { icon: React.ReactNode; kicker: string; title: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-[var(--st-blue-bg)] text-[var(--sc-accent)]">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{kicker}</span>
      </div>
      <h2 className="mt-1.5 text-[20px] font-bold tracking-tight">{title}</h2>
      {sub ? <p className="mt-1 max-w-2xl text-[13px] text-[var(--color-ink-muted)]">{sub}</p> : null}
    </div>
  );
}

/** Managementsamenvatting: drie vragen, in gewone taal, om door te sturen. */
export function ManagementSummary({ review, copyText }: { review: PeriodReview; copyText: string }) {
  if (!review.summary) return null;
  const blocks = [
    { q: `Wat heeft Shortclips ${review.mode === "kwartaal" ? "dit kwartaal" : "in deze periode"} bereikt?`, a: review.summary.bereikt },
    { q: "Welke waarde heeft dit voor het bedrijf opgeleverd?", a: review.summary.waarde },
    { q: `Wat gaan we ${review.mode === "kwartaal" ? "volgend kwartaal" : "hierna"} verbeteren?`, a: review.summary.verbeteren },
  ];
  return (
    <section className="overflow-hidden rounded-[20px] bg-[#00003b] p-5 text-white sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
            <Briefcase className="size-3.5" /> Managementsamenvatting
          </div>
          <h2 className="mt-1 text-[22px] font-bold leading-tight tracking-tight">{capitalize(review.label)} in één minuut</h2>
        </div>
        <CopySummary text={copyText} />
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {blocks.map((b, i) => (
          <div key={i} className="rounded-[14px] bg-white/[0.07] p-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white text-[12px] font-bold text-[#00003b]">{i + 1}</span>
              <div className="text-[13.5px] font-semibold leading-snug">{b.q}</div>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/80">{b.a}</p>
          </div>
        ))}
      </div>
      {!review.complete && review.mode !== "vrij" ? (
        <p className="mt-3 text-[12px] text-white/55">Deze periode loopt nog. De cijfers en de samenvatting worden dagelijks bijgewerkt.</p>
      ) : null}
    </section>
  );
}

/** De maanden van het kwartaal naast elkaar: het kwartaal is meer dan één totaal. */
export function QuarterMonths({ review }: { review: PeriodReview }) {
  if (review.months.length === 0) return null;
  const max = Math.max(1, ...review.months.map((m) => m.views));
  return (
    <section className="sc-glass p-5 sm:p-6">
      <Head icon={<Gauge className="size-4" />} kicker="Verloop binnen het kwartaal" title="Per maand" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {review.months.map((m) => (
          <div key={m.key} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{capitalize(m.label)}</div>
            {m.measured ? (
              <>
                <div className="mt-1.5 text-[24px] font-bold tabular-nums leading-none">{compact(m.views)}</div>
                <div className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">weergaven</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]">
                  <div className="h-full rounded-full bg-[var(--sc-cta)]" style={{ width: `${Math.max(4, (m.views / max) * 100)}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-ink-muted)]">
                  <span><b className="text-[var(--color-ink)]">{m.videos}</b> video&apos;s</span>
                  <span><b className="text-[var(--color-ink)]">{m.followers > 0 ? "+" : ""}{num(m.followers)}</b> volgers</span>
                </div>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Nog geen cijfers voor deze maand.</p>
            )}
          </div>
        ))}
      </div>
      {review.monthsPartial ? (
        <p className="mt-3 text-[12px] text-[var(--color-ink-faint)]">Weergaven van kanalen zonder dagcijfers (zoals Facebook) tellen wel mee in het kwartaaltotaal, maar zijn niet per maand uit te splitsen.</p>
      ) : null}
    </section>
  );
}

/** Wat werkt voor dit bedrijf: rechtstreeks uit het Contentgeheugen. */
export function WhatWorks({ review }: { review: PeriodReview }) {
  return (
    <section className="sc-glass p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Head
          icon={<Target className="size-4" />}
          kicker="Wat werkt voor dit bedrijf"
          title="Dit levert structureel de beste resultaten op"
          sub="Afgeleid uit alle video's met resultaten tot nu toe, niet alleen uit deze periode."
        />
        {review.memoryHref ? (
          <Link href={review.memoryHref} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--sc-accent)]">
            <BrainCircuit className="size-4" /> Bekijk het Contentgeheugen <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {review.works.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {review.works.map((w) => (
            <div key={w.label} className="flex flex-col gap-2 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{w.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${w.status === "bewezen" ? "bg-[var(--st-green-bg)] text-[var(--st-green)]" : "bg-[var(--st-orange-bg)] text-[var(--st-orange)]"}`}>
                  {w.status === "bewezen" ? "Bewezen" : "Veelbelovend"}
                </span>
              </div>
              <div className="text-[16px] font-bold leading-snug">{w.value}</div>
              {w.quote ? <div className="text-[13px] italic text-[var(--color-ink-muted)]">“{w.quote}”</div> : null}
              <div className="mt-auto text-[12px] text-[var(--color-ink-muted)]">{w.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-dashed border-[var(--sc-line)] p-4 text-[13.5px] text-[var(--color-ink-muted)]">
          <CircleDashed className="mt-0.5 size-4 shrink-0" /> {review.worksNote ?? "Nog geen conclusies beschikbaar."}
        </div>
      )}
      {review.highlights.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {review.highlights.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-[var(--color-ink-muted)]">
              <BasisTag kind="gemeten" /> <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Bedrijfsimpact: wat is gemeten, wat leiden we af en wat meten we nog niet. */
export function BusinessImpact({ review }: { review: PeriodReview }) {
  const { gemeten, afgeleid, nietGemeten } = review.impact;
  return (
    <section className="sc-glass p-5 sm:p-6">
      <Head
        icon={<Compass className="size-4" />}
        kicker="Bedrijfsimpact"
        title="Wat de content voor het bedrijf heeft gedaan"
        sub="We houden gemeten resultaten en afgeleide inzichten bewust uit elkaar."
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><BasisTag kind="gemeten" /> Rechtstreeks uit de kanalen</div>
          {gemeten.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5">
              {gemeten.map((g) => (
                <div key={g.label} className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3.5">
                  <div className="text-[20px] font-bold tabular-nums leading-none">{g.value}</div>
                  <div className="mt-1 text-[12.5px] font-semibold">{g.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-ink-muted)]">{g.note}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13.5px] text-[var(--color-ink-muted)]">Voor deze periode zijn nog geen gemeten resultaten beschikbaar.</p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {afgeleid.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><BasisTag kind="afgeleid" /> Wat we hieruit opmaken</div>
              <ul className="flex flex-col gap-2">
                {afgeleid.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px] text-[var(--color-ink-muted)]">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><BasisTag kind="niet" /> Hier doen we geen uitspraak over</div>
            <p className="text-[13.5px] text-[var(--color-ink-muted)]">
              {nietGemeten.map((n) => n.label).join(", ")}. Deze gegevens komen niet uit de social kanalen. Zodra de websitestatistieken of een aanvraagregistratie gekoppeld zijn, verschijnen ze hier.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const ADVICE = {
  behouden: { t: "Behouden", c: "bg-[var(--st-green-bg)] text-[var(--st-green)]" },
  verbeteren: { t: "Verbeteren", c: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]" },
  testen: { t: "Anders aanpakken", c: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]" },
} as const;

/** Advies voor de volgende periode: behouden, verbeteren of anders aanpakken. */
export function NextAdvice({ review }: { review: PeriodReview }) {
  if (review.advice.length === 0) return null;
  return (
    <section className="sc-glass p-5 sm:p-6">
      <Head icon={<Lightbulb className="size-4" />} kicker="Advies" title={review.mode === "kwartaal" ? "Voor het volgende kwartaal" : "Voor de volgende periode"} />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {review.advice.map((a, i) => (
          <div key={i} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ADVICE[a.kind].c}`}>{ADVICE[a.kind].t}</span>
            <div className="mt-2 text-[15px] font-bold leading-snug">{a.title}</div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{a.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Verwijzing naar de bestaande, door het team gecontroleerde maandanalyses. */
export function AnalysisLinks({ items, hrefFor, title }: { items: Array<{ id: string; label: string }>; hrefFor: (id: string) => string; title: string }) {
  if (items.length === 0) return null;
  return (
    <section className="sc-glass flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
      <span className="flex items-center gap-2 text-[13.5px] font-semibold">
        <FileBarChart className="size-4 text-[var(--sc-accent)]" /> {title}
      </span>
      {items.map((it) => (
        <Link key={it.id} href={hrefFor(it.id)} className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:border-[var(--sc-accent)]">
          {it.label} <ArrowRight className="size-3.5" />
        </Link>
      ))}
    </section>
  );
}

const btnPrimary = "inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--sc-cta)] px-3.5 py-2 text-[13px] font-semibold text-[var(--sc-cta-ink)] hover:bg-[var(--sc-cta-hover)]";
const btnSecondary = "inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-2 text-[13px] font-semibold hover:border-[var(--sc-accent)]";

/**
 * Directieversie van de maand: hetzelfde maandoverzicht, geschreven voor de
 * directie van de klant, als volledig rapport en als overzicht op één pagina.
 * Verschijnt alleen als de maand is afgerond en de maandrapportage door
 * Shortclips is gecontroleerd en gepubliceerd.
 */
export function DirectieDownloads({ pdfHref, query, periodKey }: { pdfHref: string; query: string; periodKey: string }) {
  const volledig = `${pdfHref}?${query}&versie=directie`;
  return (
    <section className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div className="min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Voor je directie</span>
        <h2 className="mt-1 text-base font-semibold">Directieversie van deze maand</h2>
        <p className="mt-1 max-w-xl text-[13.5px] text-[var(--color-ink-muted)]">
          Legt in gewone taal uit wat Shortclips doet, wat er is uitgevoerd, wat het opleverde en wat we aanpassen. Geschikt om door te sturen of te bespreken in een directieoverleg.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={volledig} target="_blank" rel="noopener" className={btnPrimary}>Bekijk directieversie</a>
        <a href={volledig} download={`Shortclips_Maandrapportage_directie_${periodKey}.pdf`} className={btnSecondary}>Download (PDF)</a>
        <a href={`${pdfHref}?${query}&versie=overzicht`} download={`Shortclips_Directieoverzicht_${periodKey}.pdf`} className={btnSecondary}>Directieoverzicht (1 pagina)</a>
      </div>
    </section>
  );
}

/**
 * Kwartaalrapportage bij het gekozen kwartaal: de strategische rapportage die
 * Shortclips heeft gecontroleerd, goedgekeurd en gepubliceerd. De cijfers op deze
 * pagina zijn het overzicht; dit is het rapport, met een directieoverzicht van
 * één pagina. Zonder gepubliceerde rapportage staat dat er eerlijk bij.
 */
export function KwartaalRapportLink({ rapport, label }: { rapport: { id: string; periodKey: string; nieuw: boolean } | null; label: string }) {
  if (!rapport) {
    return (
      <section className="flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--sc-line)] bg-[var(--sc-fill)] px-5 py-4">
        <p className="text-[13.5px] text-[var(--color-ink-muted)]">
          Voor {label} is nog geen kwartaalrapportage gepubliceerd. Een kwartaalrapportage verschijnt hier nadat ons team haar heeft gecontroleerd en goedgekeurd. De cijfers van dit kwartaal zie je hierboven en hieronder.
        </p>
      </section>
    );
  }
  const pdf = `/api/portal/kwartaalrapport/${rapport.id}/pdf`;
  return (
    <section className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div className="min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">{rapport.nieuw ? "Nieuw · " : ""}Kwartaalrapportage</span>
        <h2 className="mt-1 text-base font-semibold">Kwartaalrapportage {label}</h2>
        <p className="mt-1 max-w-xl text-[13.5px] text-[var(--color-ink-muted)]">
          Wat de content dit kwartaal heeft opgeleverd, wat we hebben geleerd en het plan voor het volgende kwartaal. Het directieoverzicht vat dit samen op één pagina.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/portal/resultaten/kwartaal?rapport=${rapport.id}`} className={btnPrimary}>Bekijk kwartaalrapportage</Link>
        <a href={pdf} download={`Shortclips_Kwartaalrapportage_${rapport.periodKey}.pdf`} className={btnSecondary}>Download (PDF)</a>
        <a href={`${pdf}?versie=directie`} download={`Shortclips_Directieoverzicht_${rapport.periodKey}.pdf`} className={btnSecondary}>Directieoverzicht (1 pagina)</a>
      </div>
    </section>
  );
}
