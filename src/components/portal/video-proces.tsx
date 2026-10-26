import { AlertCircle, MessageSquareText, Workflow } from "lucide-react";

/**
 * Procesoverzicht "Van beeld naar publicatie" (document) — algemene uitleg van
 * wat er gebeurt na de opnamedag. Aanvulling op de bestaande videopagina (geen
 * tweede videobeheersysteem). Bedragen komen uit de centrale afsprakenbron.
 */

const STEPS = [
  { n: "01", title: "Selectie en voorbereiding", body: "Beelden worden ingeladen, geselecteerd en klaargezet voor montage." },
  { n: "02", title: "Editing", body: "Montage, color grading, audio, ondertiteling en optimalisatie per platform. Gemiddelde oplevertijd: 14 werkdagen." },
  { n: "03", title: "Contentplanning en afstemming", body: "Besteden jullie het plaatsen aan ons uit, dan leveren wij ook contentplanning, captions en hashtags. Publiceren jullie zelf, dan krijgen jullie een posthandleiding." },
  { n: "04", title: "Feedbackronde", body: "FEEDBACK", badge: "1 ronde inbegrepen" as string | undefined },
  { n: "05", title: "Definitieve oplevering", body: "Na verwerking van de feedback ontvangen jullie de definitieve video's, klaar voor publicatie." },
  { n: "06", title: "Publicatieperiode", body: "Content gaat live volgens planning. Consistent publiceren weegt zwaarder dan één losse piek." },
  { n: "07", title: "Analyse en vervolg", body: "Wij meten de prestaties, rapporteren maandelijks en scherpen de strategie aan voor de volgende ronde." },
];

export function VideoProces({ extraFeedbackFee }: { extraFeedbackFee: string }) {
  return (
    <details className="sc-glass p-5 sm:p-6 [&_summary]:cursor-pointer">
      <summary className="flex items-center gap-2 text-base font-semibold">
        <Workflow className="size-4 text-[var(--sc-accent)]" /> Van beeld naar publicatie
      </summary>
      <p className="mt-3 text-[13.5px] text-[var(--color-ink-muted)]">Na de opnamedag nemen wij het volledig over. Jullie horen pas weer iets bij de oplevering.</p>

      <ol className="mt-5 flex flex-col gap-0">
        {STEPS.map((step, i) => (
          <li key={step.n} className="relative flex gap-4 pb-6 last:pb-0">
            {i < STEPS.length - 1 ? <span className="absolute left-[15px] top-8 h-full w-px bg-[var(--sc-fill-strong)]" aria-hidden /> : null}
            <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border border-[#2e90fa]/40 bg-[rgba(25,168,255,0.12)] text-[12px] font-bold text-[var(--sc-accent)]">{step.n}</span>
            <div className="pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold">{step.title}</span>
                {step.badge ? <span className="rounded-full bg-[#2fd27a]/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#2fd27a]">{step.badge}</span> : null}
              </div>
              {step.body === "FEEDBACK" ? (
                <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
                  Per video is één gebundelde feedbackronde inbegrepen. Lever je feedback in één keer volledig aan. Extra aanvullingen nadat de feedbackronde is verwerkt, gelden als een nieuwe feedbackronde en kosten <strong className="text-[var(--color-ink)]">{extraFeedbackFee}</strong>.
                </p>
              ) : (
                <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">{step.body}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-[#ff6a00]/30 bg-[rgba(255,106,0,0.06)] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#ff6a00]"><AlertCircle className="size-4" /> Spoed nodig?</div>
          <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Spoedlevering is mogelijk tegen een extra vergoeding en alleen wanneer de planning het toelaat. Meld het bij voorkeur vóór de opnamedag.</p>
        </div>
        <div className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold"><MessageSquareText className="size-4 text-[var(--sc-accent)]" /> Wat telt als feedback</div>
          <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Feitelijke correcties, een verkeerde naam of functie, en beeld dat niet naar buiten mag. Smaakvoorkeuren op montage nemen we mee naar de volgende ronde.</p>
        </div>
      </div>
    </details>
  );
}
