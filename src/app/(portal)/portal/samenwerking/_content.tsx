import { Check, Clock, ShieldCheck } from "lucide-react";

/* ---------------------------------------------------------------- *
 * Werkwijze (opnamedag + rolverdeling) binnen Samenwerking.
 * ---------------------------------------------------------------- */

const SHOOT_STEPS = [
  { time: "08:55 – 09:00", title: "Aankomst op locatie", body: "Apparatuur opbouwen en kennismaken met de betrokken collega's." },
  { time: "09:00 – 09:30", title: "Gezamenlijke voorbereiding", body: "Scripts doornemen, uitleg geven, vragen beantwoorden en de juiste plekken kiezen." },
  { time: "09:30 – 12:30", title: "Opnames deel 1", body: "Wij regisseren en begeleiden de presentator volledig. Voorlezen is niet nodig, wij houden de structuur vast." },
  { time: "12:30 – 13:00", title: "Lunchpauze", body: "Kort onderbreken, apparatuur blijft staan." },
  { time: "13:00 – 15:00", title: "Opnames deel 2", body: "Resterende video's plus ondersteunende beelden voor de montage." },
  { time: "± 15:00", title: "Afronding", body: "Controle of alle video's zijn opgenomen en korte terugkoppeling over het vervolg." },
];

/** Wat de klant regelt (rolverdeling "Jullie" + "Wat wij van jullie nodig hebben"). */
function jullieTaken(weHandlePosting: boolean): string[] {
  return [
    "Akkoord op de contentstrategie op hoofdlijnen",
    "Vakkennis, input en voorbeelden uit de praktijk",
    "Scripts controleren op inhoud, feiten, cijfers en termijnen",
    "Bevestigen wie er in beeld komt",
    "Locatie en een beschikbare presentator op de opnamedag",
    "Eén aanspreekpunt dat knopen kan doorhakken",
    ...(weHandlePosting ? [] : ["De video's zelf publiceren, volgens de posthandleiding"]),
    "Meelezen bij de evaluatie",
  ];
}

/** Wat Shortclips volledig uit handen neemt (rolverdeling "Shortclips"). */
function shortclipsTaken(weHandlePosting: boolean): string[] {
  return [
    "Contentstrategie en pijlers opstellen en bewaken",
    "Onderwerpen kiezen en prioriteren",
    "Formats en invalshoeken bedenken",
    "Scripts schrijven",
    "Advies over wie er in beeld komt",
    "Regie en begeleiding op de opnamedag",
    "Editing, ondertiteling en audio",
    "Captions, hashtags en planning",
    weHandlePosting ? "Publiceren op de afgesproken kanalen" : "Kant-en-klare video's met posthandleiding",
    "Analyse en rapportage",
  ];
}

/** De opnamedag-tijdlijn (document "Zo ziet de dag eruit"). Gedeeld door
 *  Samenwerking (standaard open) en Planning (voorbereiding per opname). */
export function OpnamedagContent() {
  return (
    <section className="sc-glass p-6 sm:p-7">
      <h2 className="flex items-center gap-2 text-[21px] font-bold tracking-tight text-[var(--color-ink)]"><Clock className="size-5" /> Hoe een opnamedag verloopt</h2>
      <p className="mt-2 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">
        Een gemiddelde opnamedag levert circa acht video&apos;s op en is rond 15:00 uur klaar. Bij meer video&apos;s of complexere opnames kan dat schuiven. De daadwerkelijke tijden en duur kunnen per opname verschillen.
      </p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SHOOT_STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3.5 rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4">
            <span className="sw-step grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold tabular-nums text-[var(--color-ink-muted)]">{step.time}</div>
              <div className="mt-0.5 text-[15px] font-bold text-[var(--color-ink)]">{step.title}</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-[color-mix(in_srgb,var(--st-green)_22%,transparent)] bg-[var(--st-green-bg)] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-ink)]"><Clock className="size-4 text-[var(--st-green)]" /> Jullie tijdsbesteding</div>
          <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Alleen de presentator is de hele dag nodig. Collega&apos;s die kort in beeld komen plannen we op een vast moment in.</p>
        </div>
        <div className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-ink)]"><ShieldCheck className="size-4" /> Regie</div>
          <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Wij bepalen volgorde, kadrering, tempo en herhalingen. Er is vooraf geen voorbereiding nodig.</p>
        </div>
      </div>
    </section>
  );
}

/** Wie doet wat: links wat de klant regelt (groen), rechts wat Shortclips verzorgt (donkerblauw). */
export function RolverdelingContent({ weHandlePosting = true }: { weHandlePosting?: boolean }) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-[21px] font-bold tracking-tight text-[var(--color-ink)]">Wie doet wat</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">Jullie richten je op de inhoud, wij op de productie.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="sw-you rounded-[18px] border p-6">
          <h3 className="text-[17px] font-bold text-[var(--color-ink)]">Dit regelen jullie</h3>
          <ul className="mt-4 flex flex-col gap-2.5">
            {jullieTaken(weHandlePosting).map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[14px] text-[var(--color-ink)]">
                <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[var(--st-green)] text-white"><Check className="size-3.5" strokeWidth={3} /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="sw-us rounded-[18px] border p-6">
          <h3 className="text-[17px] font-bold text-[var(--color-ink)]">Dit regelt Shortclips</h3>
          <ul className="mt-4 flex flex-col gap-2.5">
            {shortclipsTaken(weHandlePosting).map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[14px] text-[var(--color-ink)]">
                <span className="sw-step mt-px grid size-5 shrink-0 place-items-center rounded-full"><Check className="size-3.5" strokeWidth={3} /></span>
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-[var(--sc-line)] pt-3 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            <strong className="font-semibold text-[var(--color-ink)]">Volledig uit handen:</strong> formats, openingen, opbouw, toon, volgorde, beeldkeuze, montage, ondertiteling, muziek, captions, hashtags, plaatsingsmomenten en optimalisatie.
          </p>
        </div>
      </div>
    </section>
  );
}
