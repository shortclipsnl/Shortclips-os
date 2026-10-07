import { Check, Clock, Globe, Mail, MapPin, MessageCircle, MessageSquareText, Phone, ShieldCheck, Users, Video } from "lucide-react";
import type { PortalContactPerson } from "@/server/portal";
import { Avatar, buttonClass, Card } from "@/components/ui";

/* ---------------------------------------------------------------- *
 * Werkwijze (opnamedag + rolverdeling) — tab binnen Samenwerking.
 * ---------------------------------------------------------------- */

const SHOOT_STEPS = [
  { time: "08:55 – 09:00", title: "Aankomst op locatie", body: "Apparatuur opbouwen en kennismaken met de betrokken collega's." },
  { time: "09:00 – 09:30", title: "Gezamenlijke voorbereiding", body: "Scripts doornemen, uitleg geven, vragen beantwoorden en de juiste plekken kiezen." },
  { time: "09:30 – 12:30", title: "Opnames deel 1", body: "Wij regisseren en begeleiden de presentator volledig. Voorlezen is niet nodig, wij houden de structuur vast." },
  { time: "12:30 – 13:00", title: "Lunchpauze", body: "Kort onderbreken, apparatuur blijft staan." },
  { time: "13:00 – 15:00", title: "Opnames deel 2", body: "Resterende video's plus ondersteunende beelden voor de montage." },
  { time: "± 15:00", title: "Afronding", body: "Controle of alle video's zijn opgenomen en korte terugkoppeling over het vervolg." },
];

const ROLES = [
  { part: "Contentstrategie en pijlers", sc: "Wij stellen op en bewaken", you: "Akkoord op hoofdlijnen" },
  { part: "Onderwerpen bepalen", sc: "Wij kiezen en prioriteren", you: "Input vanuit jullie vakkennis" },
  { part: "Vakinhoud en voorbeelden", sc: "Wij stellen de vragen", you: "Jullie leveren de kennis" },
  { part: "Formats en invalshoeken", sc: "Volledig van ons", you: "—" },
  { part: "Scripts schrijven", sc: "Volledig van ons", you: "Controle op de inhoud" },
  { part: "Presentator aanwijzen", sc: "Wij adviseren", you: "Jullie bevestigen wie in beeld komt" },
  { part: "Opnamedag en regie", sc: "Wij regisseren en begeleiden", you: "Aanwezigheid en locatie" },
  { part: "Editing, ondertiteling, audio", sc: "Volledig van ons", you: "—" },
  { part: "Captions, hashtags, planning", sc: "Volledig van ons", you: "—" },
  { part: "Publicatie", sc: "Wij plaatsen of leveren posthandleiding", you: "Alleen bij zelf publiceren" },
  { part: "Analyse en rapportage", sc: "Volledig van ons", you: "Meelezen bij de evaluatie" },
];

const NEED_FROM_YOU = [
  "Vakkennis en voorbeelden uit de praktijk",
  "Een controle op feiten, cijfers en termijnen",
  "Een aanspreekpunt dat knopen kan doorhakken",
  "Beschikbaarheid van de presentator op de opnamedag",
];

export function WerkwijzeContent() {
  return (
    <div className="flex flex-col gap-7">
      <section className="sc-glass p-6 sm:p-7">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">De opnamedag</span>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">Zo ziet de dag eruit</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">
          Een gemiddelde opnamedag levert circa acht video&apos;s op en is rond 15:00 uur klaar. Bij meer video&apos;s of complexere opnames kan dat schuiven.
        </p>
        <ol className="mt-6 flex flex-col gap-0">
          {SHOOT_STEPS.map((step, i) => (
            <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
              {i < SHOOT_STEPS.length - 1 ? (
                <span className="absolute left-[15px] top-8 h-full w-px bg-white/10" aria-hidden />
              ) : null}
              <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border border-[#2e90fa]/40 bg-[rgba(25,168,255,0.12)] text-[12px] font-bold text-[#4bc4ff]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="pt-0.5">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[#4bc4ff]">{step.time}</div>
                <div className="mt-0.5 text-[15px] font-semibold">{step.title}</div>
                <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
          <div className="rounded-[14px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.06)] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold"><Clock className="size-4 text-[#2fd27a]" /> Jullie tijdsbesteding</div>
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Alleen de presentator is de hele dag nodig. Collega&apos;s die kort in beeld komen plannen we op een vast moment in.</p>
          </div>
          <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold"><ShieldCheck className="size-4 text-[#4bc4ff]" /> Regie</div>
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">Wij bepalen volgorde, kadrering, tempo en herhalingen. Er is vooraf geen voorbereiding nodig.</p>
          </div>
        </div>
      </section>

      <section className="sc-glass p-6 sm:p-7">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">Rolverdeling</span>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">Wie doet wat</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">Een duidelijke taakverdeling zodat jullie je op de inhoud kunnen richten en wij op de productie.</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                <th className="pb-3 pr-4 font-semibold">Onderdeel</th>
                <th className="pb-3 pr-4 font-semibold">Shortclips</th>
                <th className="pb-3 font-semibold">Jullie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {ROLES.map((r) => (
                <tr key={r.part} className="align-top">
                  <td className="py-3 pr-4 text-[13.5px] font-semibold">{r.part}</td>
                  <td className="py-3 pr-4 text-[13.5px] text-[#9fdcff]">{r.sc}</td>
                  <td className="py-3 text-[13.5px] text-[var(--color-ink-muted)]">{r.you}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
          <div className="rounded-[14px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.06)] p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold"><Users className="size-4 text-[#2fd27a]" /> Wat wij van jullie nodig hebben</div>
            <ul className="mt-3 flex flex-col gap-2">
              {NEED_FROM_YOU.map((n) => (
                <li key={n} className="flex gap-2 text-[13px] text-[var(--color-ink-muted)]"><Check className="mt-0.5 size-4 shrink-0 text-[#2fd27a]" /> {n}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-5">
            <div className="text-[14px] font-semibold">Wat je volledig kunt loslaten</div>
            <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Formats, openingen, opbouw, toon, volgorde, beeldkeuze, montage, ondertiteling, muziek, captions, hashtags, plaatsingsmomenten en optimalisatie. Wij maken die keuzes en bewaken de kwaliteit.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[16px] border border-white/10 bg-white/[0.03] px-5 py-4 text-[12.5px] text-[var(--color-ink-muted)]">
        <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-[#4bc4ff]" /> Edisonstraat 1B, 8606 JH Sneek</span>
        <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5 text-[#4bc4ff]" /> 06-25083371</span>
        <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5 text-[#4bc4ff]" /> info@shortclips.nl</span>
        <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5 text-[#4bc4ff]" /> shortclips.nl</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Team (contactpersonen) — tab binnen Samenwerking.
 * ---------------------------------------------------------------- */

/** +31 6 12 34 56 78 → 31612345678 voor een wa.me-link. */
function waNumber(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0/, "31");
}

function ContactCard({ person, focus, showWhatsApp = false }: { person: PortalContactPerson; focus?: string; showWhatsApp?: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <Avatar name={person.name} size={52} />
        <div className="min-w-0">
          <p className="text-base font-semibold text-[var(--color-ink)]">{person.name}</p>
          <p className="text-sm text-[var(--color-ink-muted)]">{person.role}</p>
        </div>
      </div>
      {focus ? (
        <p className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]">{focus}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {person.email ? (
          <a href={`mailto:${person.email}`} className={buttonClass({ variant: "primary", size: "sm" })}><Mail className="size-4" /> E-mail</a>
        ) : null}
        {person.phone ? (
          <a href={`tel:${person.phone}`} className={buttonClass({ variant: "secondary", size: "sm" })}><Phone className="size-4" /> Bellen</a>
        ) : null}
        {person.phone && showWhatsApp ? (
          <a href={`https://wa.me/${waNumber(person.phone)}`} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}><MessageCircle className="size-4" /> WhatsApp</a>
        ) : null}
      </div>
    </Card>
  );
}

export function TeamContent({
  coordinator,
  videographer,
}: {
  coordinator: PortalContactPerson | null;
  videographer: PortalContactPerson | null;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {coordinator ? (
          <ContactCard person={coordinator} focus="Voor planning, scripts, feedback, resultaten en alles rond de samenwerking." />
        ) : (
          <ContactCard person={{ name: "Shortclips", role: "Je team", email: "info@shortclips.nl", phone: null }} focus="Voor planning, scripts, feedback, resultaten en alles rond de samenwerking." />
        )}
        {videographer ? (
          <ContactCard person={videographer} focus="Voor vragen rondom een aankomende opnamedag en de opnames zelf." showWhatsApp />
        ) : null}
      </div>

      {/* Feedback-kanaal: video's altijd via de videopagina (Frame), niet via WhatsApp */}
      <div className="flex items-start gap-3 rounded-[14px] border border-[#2e90fa]/25 bg-[rgba(46,144,250,0.06)] p-4">
        <MessageSquareText className="mt-0.5 size-5 shrink-0 text-[#4bc4ff]" />
        <p className="text-[13.5px] text-[var(--color-ink-muted)]">
          <span className="font-semibold text-[var(--color-ink)]">Feedback op video&apos;s?</span> Geef die altijd via de{" "}
          <a href="/portal/videos" className="font-semibold text-[#4bc4ff]">videopagina</a> (in Frame, met tijdcode). Zo blijft alles bij de juiste video en in één gebundelde ronde.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-[14px] border border-white/10 bg-white/[0.03] p-4 text-[13px] text-[var(--color-ink-muted)]">
        <Video className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)]" />
        Vragen over je video&apos;s, planning of samenwerking? Je vaste contactpersoon helpt je graag.
      </div>
    </div>
  );
}
