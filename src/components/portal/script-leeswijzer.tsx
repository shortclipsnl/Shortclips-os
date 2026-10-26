import { BookOpen, Check, HelpCircle } from "lucide-react";

/**
 * Leeswijzer voor scripts (document "Zo lees je de scripts"): hoe een script is
 * opgebouwd, wat de klant inhoudelijk controleert, wat ShortClips bepaalt en
 * waarom de teksten klinken zoals ze klinken. Uitklapbaar blok op de Scriptpagina.
 */

const PARTS = [
  { n: "01", title: "De opening", body: "De eerste seconden bepalen of iemand blijft kijken. Die staan bewust scherp en klinken soms directer dan jullie gewend zijn. Dat is opzet." },
  { n: "02", title: "De kernboodschap", body: "Eén boodschap per video. Wil een script twee punten maken, dan splitsen wij het in twee video's." },
  { n: "03", title: "Het bewijs", body: "Een voorbeeld, cijfer of case die de boodschap geloofwaardig maakt. Hier let je bij het lezen het scherpst op." },
  { n: "04", title: "De afsluiting", body: "Een oproep alleen als die past. Video's die op bereik zijn gericht werken vaak beter zonder." },
];

const CHECK = [
  "Kloppen de cijfers, termijnen, prijzen en normen?",
  "Staat er iets dat vakinhoudelijk niet klopt?",
  "Mogen deze case en dit voorbeeld naar buiten?",
  "Ligt een uitspraak gevoelig binnen de organisatie?",
];

const NIET_NODIG = ["De opening herschrijven of afzwakken", "Spreektaal formeler maken", "Volgorde of opbouw aanpassen", "Beeldkeuze, muziek of montage beoordelen"];

export function ScriptLeeswijzer({ feedbackDays }: { feedbackDays?: number }) {
  return (
    <details className="sc-glass p-5 sm:p-6 [&_summary]:cursor-pointer" open>
      <summary className="flex items-center gap-2 text-base font-semibold">
        <BookOpen className="size-4 text-[var(--sc-accent)]" /> Hoe controleer ik mijn scripts?
      </summary>

      <p className="mt-3 text-[13.5px] text-[var(--color-ink-muted)]">
        Jullie bewaken de <strong className="text-[var(--color-ink)]">inhoud</strong>, wij de <strong className="text-[var(--color-ink)]">creatieve uitwerking</strong>. Zo leest een script het makkelijkst.
      </p>

      {/* Opbouw van een script */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PARTS.map((p) => (
          <div key={p.n} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-[var(--sc-accent)]">{p.n}</span>
              <span className="text-[14px] font-semibold">{p.title}</span>
            </div>
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">{p.body}</p>
          </div>
        ))}
      </div>

      {/* Dit controleer jij */}
      <div className="mt-4 rounded-[14px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.06)] p-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#2fd27a]"><HelpCircle className="size-4" /> Dit controleer jij</div>
        <h3 className="mt-1 text-[15px] font-bold">Vier vragen bij het doorlezen</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CHECK.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--color-ink-muted)]">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[#2fd27a]/20 text-[11px] font-bold text-[#2fd27a]">{i + 1}</span> {c}
            </li>
          ))}
        </ul>
      </div>

      {/* Niet nodig */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3">
        <span className="rounded-full bg-[var(--sc-fill-strong)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Niet nodig</span>
        <span className="text-[12.5px] text-[var(--color-ink-muted)]">{NIET_NODIG.join(" · ")}</span>
      </div>

      {/* Feedback, akkoord en waarom */}
      <div className="mt-4 border-t border-[var(--sc-line)] pt-4 text-[13px] text-[var(--color-ink-muted)]">
        <p>
          <strong className="text-[var(--color-ink)]">Feedback geven?</strong> Open het script hieronder, tik op de PDF om een opmerking te plaatsen of keur het goed.
          Scripts worden vóór de opnamedag definitief akkoord gegeven{typeof feedbackDays === "number" ? `; reageer bij voorkeur binnen ${feedbackDays} werkdagen` : ""}.
        </p>
        <p className="mt-2">
          <strong className="text-[var(--color-ink)]">Waarom de teksten klinken zoals ze klinken:</strong> short video werkt op ritme en spreektaal. Scripts die achteraf worden
          gladgestreken naar geschreven taal presteren aantoonbaar slechter. Twijfel je? Zet er een opmerking bij, dan bespreken we het.
        </p>
      </div>
    </details>
  );
}
