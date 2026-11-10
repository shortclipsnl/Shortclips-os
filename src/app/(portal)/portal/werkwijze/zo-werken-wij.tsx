"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Clock, Repeat } from "lucide-react";

export type Pakket = "organisch" | "zelf-publiceren" | "advertentie";
type View = "alles" | "wij" | "jij";
type Who = "shortclips" | "samen" | "klant";

type Step = { title: string; line: string; who: Who };

const PHASES = [
  "Fase 1 · Strategie & voorbereiding",
  "Fase 2 · Productie & kwaliteitscontrole",
  "Fase 3 · Publicatie & resultaten",
  "Fase 4 · Optimalisatie & doorgroeien",
];
/** Aantal stappen per fase (samen 12). */
const PHASE_SIZES = [4, 4, 2, 2];
/** Eigen kleur per fase, zodat de cyclus in één oogopslag te volgen is. */
const PHASE_COLOR = ["var(--sc-accent)", "var(--st-green)", "var(--st-orange)", "var(--st-blue)"];

function steps(pakket: Pakket): Step[] {
  const stap9: Step =
    pakket === "advertentie"
      ? { title: "Aanlevering voor campagnes", line: "Video's campagneklaar in de juiste formaten, met meerdere hooks per video.", who: "shortclips" }
      : pakket === "zelf-publiceren"
        ? { title: "Contentkalender & aanlevering", line: "Kalender een maand vooruit en captions per kanaal. Jij plaatst de video's zelf.", who: "samen" }
        : { title: "Contentkalender & publicatie", line: "Kalender een maand vooruit, captions per kanaal, hashtags en inplannen op alle afgesproken kanalen.", who: "shortclips" };

  return [
    { title: "Strategie & doelstellingen", line: "Doelen, doelgroep, contentpijlers, tone of voice en kanaalkeuze.", who: "shortclips" },
    { title: "Contentonderzoek", line: "Trends, formats en kansrijke onderwerpen in jouw branche.", who: "shortclips" },
    { title: "Onderwerpen, hooks & scripts", line: "Wij kiezen de onderwerpen en schrijven hooks en volledige scripts.", who: "shortclips" },
    { title: "Scriptmeeting & voorbereiding", line: "Samen de scripts doornemen. Wij plannen en bereiden de opnamedag voor.", who: "samen" },
    { title: "Opnamedag op locatie", line: "Filmen, licht, geluid en volledige regie. Jij bent het gezicht.", who: "samen" },
    { title: "Montage & afwerking", line: "Beeldselectie, montage in merkstijl, kleurcorrectie, sound en ondertiteling.", who: "shortclips" },
    { title: "Kwaliteitscontrole", line: "Elke video wordt intern gecontroleerd en waar nodig verbeterd.", who: "shortclips" },
    { title: "Jouw beoordeling", line: "Eén gebundelde feedbackronde in het klantportaal. Wij verwerken alles.", who: "klant" },
    stap9,
    { title: "Statistieken & maandrapport", line: "Wij verzamelen de cijfers en maken een maandrapport met kerncijfers.", who: "shortclips" },
    { title: "Evaluatie & aanbeveling", line: "Wat werkt en wat beter kan, met één concrete aanbeveling. Elk kwartaal een uitgebreide analyse.", who: "shortclips" },
    { title: "De volgende cyclus", line: "De inzichten vormen de basis voor nieuwe onderwerpen, formats en scripts.", who: "shortclips" },
  ];
}

function jijItems(pakket: Pakket) {
  const items = [
    { title: "Scriptmeeting", line: "Samen de scripts doornemen, zodat iedereen weet wat hij zegt en hoe de opnamedag eruitziet.", time: "15 tot 30 minuten" },
    { title: "Aanwezig op de opnamedag", line: "De mensen voor de camera zijn het gezicht van het merk. Wij regisseren.", time: "gemiddeld 4 tot 7 uur" },
    { title: "Video's beoordelen", line: "Eén gebundelde set opmerkingen via het klantportaal.", time: "ongeveer 20 minuten" },
  ];
  if (pakket === "zelf-publiceren") {
    items.push({ title: "Video's plaatsen", line: "Je plaatst de video's zelf, volgens onze kalender en met onze captions.", time: "per video" });
  }
  return items;
}

function wijItems(pakket: Pakket) {
  return [
    "Strategie en contentpijlers", "Formats testen en afschrijven", "Onderwerpen vastleggen",
    "Concepten uitwerken", "Hooks en scripts", "Opnamedag voorbereiden",
    "Regie en begeleiding", "Filmen, licht en geluid", "Beeldselectie en briefing",
    "Montage en ondertiteling", "Kwaliteitscontrole", "Captions per kanaal",
    "Contentkalender opstellen", pakket === "zelf-publiceren" ? "Planningsadvies" : "Inplannen en publiceren", "Statistieken verzamelen",
    "Maandrapport en aanbeveling", "Kwartaalanalyse", "De cyclus opnieuw starten",
  ];
}

const NUMBER_WORDS = ["nul", "één", "twee", "drie", "vier", "vijf"];

/** Groen vinkje; glanst in de weergave "Wat Shortclips doet". */
function GreenCheck({ glow, delay, size = 20 }: { glow: boolean; delay: number; size?: number }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-[var(--st-green)] text-white ${glow ? "zww-glow" : ""}`}
      style={{ width: size, height: size, animationDelay: `${delay}s` }}
    >
      <Check className="size-3" strokeWidth={3.2} />
    </span>
  );
}

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "alles", label: "Alles" },
  { id: "wij", label: "Wat Shortclips doet" },
  { id: "jij", label: "Wat jij doet" },
];

export function ZoWerkenWij({ pakket }: { pakket: Pakket }) {
  const [view, setView] = useState<View>("alles");
  const all = steps(pakket);
  const jij = jijItems(pakket);
  const wij = wijItems(pakket);
  const wijCount = all.filter((s) => s.who === "shortclips").length;
  const jijCount = all.length - wijCount;

  const dimJij = view === "wij";
  const dimWij = view === "jij";
  const glow = view === "wij";
  const fade = "transition-opacity duration-300";

  const grouped = PHASES.map((label, p) => {
    const start = PHASE_SIZES.slice(0, p).reduce((a, b) => a + b, 0);
    const part = all.slice(start, start + PHASE_SIZES[p]).map((s, i) => ({ ...s, n: start + i + 1 }));
    return { label, steps: part };
  });

  return (
    <div className="flex flex-col gap-10">
      {/* Kop */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Zo werken wij</span>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">Veel meer dan alleen video&apos;s maken.</h1>
        <p className="max-w-2xl text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
          Elke maand werken wij aan jouw zichtbaarheid en resultaten. Van het bedenken van sterke content tot het analyseren en verbeteren van de prestaties. Ontdek wat er achter de schermen gebeurt.
        </p>
      </section>

      {/* Weergaveschakelaar */}
      <div
        role="group"
        aria-label="Weergave"
        className="sticky top-3 z-20 -mb-4 inline-flex flex-wrap justify-center gap-1 self-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-raised)]"
      >
        {VIEWS.map((v) => {
          const active = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={active}
              onClick={() => setView(v.id)}
              className={`min-h-10 rounded-full px-4 text-[13.5px] font-semibold transition-colors ${
                active ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "text-[var(--color-ink)] hover:bg-[var(--sc-fill-strong)]"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* De verdeling */}
      <section className="flex flex-col gap-4">
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">De verdeling</span>
          <h2 className="mt-1 text-[22px] font-bold tracking-tight">
            Jij doet {NUMBER_WORDS[jij.length] ?? jij.length} dingen. Wij doen de rest.
          </h2>
        </div>

        <div className={`sc-glass border-2 !border-[var(--sc-accent)] p-5 sm:p-6 ${fade} ${dimJij ? "opacity-30" : ""}`}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Wat jij doet</span>
          <p className="mt-1 text-[17px] font-bold">Dit is alles wat we van jou vragen</p>
          <ul className="mt-3">
            {jij.map((item, i) => (
              <li key={item.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--sc-line)] py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--sc-accent)] text-[14px] font-bold text-white">{i + 1}</span>
                <div className="min-w-0 flex-[1_1_240px]">
                  <h3 className="text-[15px] font-semibold">{item.title}</h3>
                  <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">{item.line}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-fill-strong)] px-3 py-1.5 text-[12.5px] font-semibold">
                  <Clock className="size-3.5" /> {item.time}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`sc-glass p-5 sm:p-6 ${fade} ${dimWij ? "opacity-30" : ""}`}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--st-green)]">Wat wij doen</span>
          <p className="mt-1 text-[17px] font-bold">Dit hoef jij allemaal niet te doen</p>
          <ul className="mt-4 columns-1 gap-7 sm:columns-2 lg:columns-3">
            {wij.map((w, i) => (
              <li key={w} className="flex break-inside-avoid items-center gap-2.5 py-1.5 text-[13.5px]">
                <GreenCheck glow={glow} delay={i * 0.12} />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13.5px] font-semibold text-[var(--color-ink-muted)]">Wij leveren niet alleen video&apos;s, wij houden je kanaal draaiend.</p>
      </section>

      {/* De cyclus */}
      <section className="flex flex-col gap-4">
        <div>
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">De werkwijze</span>
          <h2 className="mt-1 text-[22px] font-bold tracking-tight">De cyclus die elke maand terugkomt</h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium">
            <span className="inline-flex items-center gap-2"><GreenCheck glow={false} delay={0} /> {wijCount} stappen regelt Shortclips volledig</span>
            <span className="inline-flex items-center gap-2"><span aria-hidden className="size-5 rounded-md border-2 border-[var(--sc-accent)] bg-[var(--st-blue-bg)]" /> {jijCount} stappen waarbij jij nodig bent</span>
          </div>
        </div>

        <div className="flex flex-col">
          {grouped.map((phase, pi) => {
            const col = PHASE_COLOR[pi] ?? "var(--sc-accent)";
            return (
            <div key={phase.label}>
              <p className="mb-2 mt-5 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: col }}>
                <span className="size-2 rounded-full" style={{ background: col }} aria-hidden /> {phase.label}
              </p>
              <ol className="flex flex-col gap-1.5">
                {phase.steps.map((s) => {
                  const ours = s.who === "shortclips";
                  const dim = (view === "jij" && ours) || (view === "wij" && !ours);
                  return (
                    <li
                      key={s.n}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] px-4 py-3.5 sm:px-5 ${fade} ${dim ? "opacity-30" : ""} ${ours ? "bg-[var(--sc-fill)]" : view === "jij" ? "shadow-[var(--shadow-raised)]" : ""}`}
                      style={ours ? { borderLeft: `3px solid ${col}` } : { border: `2px solid ${col}`, background: "color-mix(in srgb, " + col + " 10%, transparent)" }}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums text-white" style={{ background: col }}>{String(s.n).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-[1_1_240px]">
                        <h3 className="text-[15px] font-semibold leading-snug">{s.title}</h3>
                        <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">{s.line}</p>
                      </div>
                      {ours ? (
                        <span className="ml-11 inline-flex items-center gap-2 text-[12.5px] font-semibold text-[var(--st-green)] sm:ml-0">
                          <GreenCheck glow={glow} delay={s.n * 0.18} size={22} /> Shortclips regelt dit
                        </span>
                      ) : (
                        <span className="ml-11 rounded-full bg-[var(--sc-cta)] px-3 py-1.5 text-[12.5px] font-bold text-[var(--sc-cta-ink)] sm:ml-0">
                          {s.who === "klant" ? "Jouw actie" : "Samen met jou"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
            );
          })}
          <div className="mt-4 flex items-center gap-4 rounded-[14px] border-2 border-dashed border-[var(--sc-line)] px-4 py-3.5 sm:px-5">
            <Repeat className="size-5 shrink-0 text-[var(--sc-accent)]" />
            <p className="text-[13.5px]">
              <strong className="font-semibold">En dan begint de volgende maand,</strong>{" "}
              <span className="text-[var(--color-ink-muted)]">met de inzichten van deze maand als startpunt.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Afsluiting */}
      <section className="sc-glass flex flex-col gap-3 p-6 sm:p-8">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Elke maand opnieuw</span>
        <h2 className="text-[24px] font-bold tracking-tight">Jouw content staat nooit stil.</h2>
        <p className="max-w-xl text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
          Terwijl jij je richt op jouw bedrijf, werken wij aan nieuwe ideeën, sterke video&apos;s en het verbeteren van jouw zichtbaarheid. Iedere maand opnieuw.
        </p>
        <Link
          href="/portal/resultaten"
          className="mt-2 inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-[var(--sc-cta)] px-5 text-[14px] font-semibold text-[var(--sc-cta-ink)] transition-colors hover:bg-[var(--sc-cta-hover)]"
        >
          Bekijk jouw resultaten <ArrowRight className="size-4" />
        </Link>
      </section>
    </div>
  );
}
