import type { LucideIcon } from "lucide-react";
import { BadgeCheck, BookOpen, Check, CheckCircle2, Flag, MessageSquare, Sparkles, Target, Zap } from "lucide-react";

/**
 * Leeswijzer voor scripts (document "Zo lees je de scripts"): hoe een script is
 * opgebouwd, wat de klant inhoudelijk controleert, wat ShortClips bepaalt en
 * waarom de teksten klinken zoals ze klinken.
 *
 * Kleurafspraak op de Scriptspagina: blauw = informatie (opbouw van een script),
 * groen = wat de klant zelf doet (controleren en akkoord geven).
 */

const PARTS: { n: string; title: string; body: string; icon: LucideIcon; bg: string }[] = [
  { n: "01", title: "De opening", icon: Zap, bg: "#1b5fe0", body: "De eerste seconden bepalen of iemand blijft kijken. Die staan bewust scherp en klinken soms directer dan jullie gewend zijn. Dat is opzet." },
  { n: "02", title: "De kernboodschap", icon: Target, bg: "#164bc0", body: "Eén boodschap per video. Wil een script twee punten maken, dan splitsen wij het in twee video's." },
  { n: "03", title: "Het bewijs", icon: BadgeCheck, bg: "#10399c", body: "Een voorbeeld, cijfer of case die de boodschap geloofwaardig maakt. Hier let je bij het lezen het scherpst op." },
  { n: "04", title: "De afsluiting", icon: Flag, bg: "#0a2470", body: "Een oproep alleen als die past. Video's die op bereik zijn gericht werken vaak beter zonder." },
];

const CHECK = [
  "Kloppen de cijfers, termijnen, prijzen en normen?",
  "Staat er iets dat vakinhoudelijk niet klopt?",
  "Mogen deze case en dit voorbeeld naar buiten?",
  "Ligt een uitspraak gevoelig binnen de organisatie?",
];

const NIET_NODIG = ["De opening herschrijven of afzwakken", "Spreektaal formeler maken", "Volgorde of opbouw aanpassen", "Beeldkeuze, muziek of montage beoordelen"];

/** Volle groentint met witte tekst: leesbaar in licht en donker thema. */
const GREEN = "#17784c";

export function ScriptLeeswijzer({ feedbackDays }: { feedbackDays?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Informatie: opbouw van een script (blauw) */}
      <section className="sc-glass p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#1b5fe0] text-white">
            <BookOpen className="size-5" />
          </span>
          <div>
            <h2 className="text-[20px] font-bold tracking-tight">Hoe controleer ik mijn scripts?</h2>
            <p className="text-[13.5px] text-[var(--color-ink-muted)]">Elk script volgt dezelfde vier stappen. Zo lees je het het makkelijkst.</p>
          </div>
        </div>

        <ol className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {PARTS.map((p) => (
            <li key={p.n} className="relative overflow-hidden rounded-[16px] p-5 text-white shadow-[var(--shadow-raised)]" style={{ background: p.bg }}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-white">{p.n}</span>
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-white/15 text-[#dbe6ff]">
                  <p.icon className="size-5" />
                </span>
              </div>
              <h3 className="mt-3 text-[16px] font-bold text-white">{p.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/85">{p.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-start gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 text-[13px] text-[var(--color-ink-muted)]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--st-blue)]" />
          <p>
            <strong className="text-[var(--color-ink)]">Waarom de teksten klinken zoals ze klinken:</strong> short video werkt op ritme en spreektaal. Scripts die achteraf worden
            gladgestreken naar geschreven taal presteren aantoonbaar slechter. Twijfel je? Zet er een opmerking bij, dan bespreken we het.
          </p>
        </div>
      </section>

      {/* Actie: wat de klant controleert (groen) */}
      <section
        className="rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-card)] sm:p-7"
        style={{ background: `color-mix(in srgb, ${GREEN} 8%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${GREEN} 35%, var(--color-line))` }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] text-white" style={{ background: GREEN }}>
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <h2 className="text-[22px] font-bold tracking-tight">Dit controleer jij</h2>
            <p className="text-[13.5px] text-[var(--color-ink-muted)]">Vier vragen bij het doorlezen van elk script.</p>
          </div>
        </div>

        {/* Taakverdeling in één oogopslag */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] p-4 text-white" style={{ background: GREEN }}>
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-white/80">Jij beoordeelt</p>
            <p className="mt-1 text-[16px] font-bold">De inhoudelijke juistheid</p>
            <p className="mt-0.5 text-[13px] text-white/85">Feiten, cijfers, vakinhoud en wat naar buiten mag.</p>
          </div>
          <div className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Shortclips is verantwoordelijk voor</p>
            <p className="mt-1 text-[16px] font-bold">De creatieve uitwerking</p>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Opening, opbouw, toon, beeld en montage.</p>
          </div>
        </div>

        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {CHECK.map((c, i) => (
            <li key={i} className="flex items-start gap-3 rounded-[14px] border bg-[var(--color-surface)] p-4" style={{ borderColor: `color-mix(in srgb, ${GREEN} 30%, var(--color-line))` }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: GREEN }}>
                <Check className="size-4" strokeWidth={3} />
              </span>
              <span className="pt-0.5 text-[14px] font-semibold leading-snug text-[var(--color-ink)]">{c}</span>
            </li>
          ))}
        </ul>

        {/* Niet nodig */}
        <div className="mt-4 rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Niet nodig, dat doen wij</p>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{NIET_NODIG.join(" · ")}</p>
        </div>

        {/* Feedback en akkoord */}
        <div className="mt-4 flex items-start gap-3 text-[13.5px] text-[var(--color-ink-muted)]">
          <MessageSquare className="mt-0.5 size-4 shrink-0 text-[var(--st-green)]" />
          <p>
            <strong className="text-[var(--color-ink)]">Feedback geven?</strong> Open het script hierboven, tik op de PDF om een opmerking te plaatsen of keur het goed.
            Scripts worden vóór de opnamedag definitief akkoord gegeven{typeof feedbackDays === "number" ? `; reageer bij voorkeur binnen ${feedbackDays} werkdagen` : ""}.
          </p>
        </div>
      </section>
    </div>
  );
}
