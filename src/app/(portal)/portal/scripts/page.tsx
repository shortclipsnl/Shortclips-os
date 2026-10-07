import type { Metadata } from "next";
import { CalendarClock, Clock, FileText, MapPin, MessageSquareText, UserRound, Video } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalData } from "@/server/portal";
import { Badge, Card } from "@/components/ui";
import { formatDateFull, relativeDays } from "@/lib/format";
import { ScriptDecision } from "../actions-ui";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

/** Leeswijzer "Zo lees je de scripts" — compacte versie van het PDF. */
const SCRIPT_PARTS = [
  { n: "01", title: "De opening", body: "De eerste seconden bepalen of iemand blijft kijken. Ze zijn bewust scherp en soms directer dan je gewend bent — dat is opzet." },
  { n: "02", title: "De kernboodschap", body: "Eén boodschap per video. Twee punten? Dan splitsen wij het in twee video's." },
  { n: "03", title: "Het bewijs", body: "Een voorbeeld, cijfer of case die de boodschap geloofwaardig maakt. Hier let je het scherpst op." },
  { n: "04", title: "De afsluiting", body: "Een oproep alleen als die past. Video's gericht op bereik werken vaak beter zonder." },
];

const CHECK_QUESTIONS = [
  "Kloppen de cijfers, termijnen, prijzen en normen?",
  "Staat er iets dat vakinhoudelijk niet klopt?",
  "Mogen deze case en dit voorbeeld naar buiten?",
  "Ligt een uitspraak gevoelig binnen de organisatie?",
];

const COMMS = [
  { k: "Responstijd", v: "Binnen één werkdag (ma–vr, 09:00–17:00)." },
  { k: "Script-akkoord", v: "Vóór de opnamedag definitief akkoord." },
  { k: "Feedback", v: "Eén gebundelde ronde per script." },
  { k: "Beoordelingstermijn", v: "3 werkdagen na oplevering." },
];

export default async function PortalScriptsPage() {
  const viewer = await requirePortal();
  const [data, contact] = await Promise.all([getPortalData(viewer), getPortalContact(viewer)]);
  const scripts = data.scriptsToReview;
  const shoot = data.upcomingShoot;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Scripts</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Bekijk je scripts, geef feedback en keur ze goed — altijd vóór de opnamedag.
        </p>
      </div>

      {/* Komende opnamedag — waar deze scripts voor zijn */}
      {shoot ? (
        <section className="sc-glass p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Komende opnamedag</span>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2.5">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-[#4bc4ff]" />
              {formatDateFull(shoot.scheduledOn)}
              <span className="font-normal text-[var(--color-ink-muted)]">· {relativeDays(shoot.scheduledOn)}{shoot.startTime ? ` · vanaf ${shoot.startTime.slice(0, 5)}` : ""}</span>
            </span>
            {shoot.locationName ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
                <MapPin className="size-4 text-[#4bc4ff]" /> {shoot.locationName}
              </span>
            ) : null}
            {contact.videographer ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
                <Video className="size-4 text-[#4bc4ff]" /> {contact.videographer.name.split(" ")[0]} · videograaf
              </span>
            ) : null}
            {contact.coordinator ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
                <UserRound className="size-4 text-[#4bc4ff]" /> {contact.coordinator.name.split(" ")[0]} · contactpersoon
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Scripts die op je wachten */}
      <section>
        <h2 className="mb-3.5 text-base font-semibold">Scripts die op je wachten</h2>
        {scripts.length === 0 ? (
          <div className="sc-glass grid place-items-center gap-2 p-10 text-center">
            <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
            <p className="text-sm font-medium">Geen scripts die op je wachten</p>
            <p className="max-w-md text-[13px] text-[var(--color-ink-muted)]">
              Zodra er een script klaarstaat voor jouw akkoord, verschijnt het hier. We stemmen scripts
              altijd vóór de opnamedag met je af. Je hoeft nu niets te doen.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {scripts.map((s) => (
              <Card key={s.id} padded={false}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 text-sm font-semibold text-[var(--color-ink)]">{s.title}</h3>
                    <Badge tone="warn">Wacht op jouw akkoord</Badge>
                  </div>
                  {s.hook ? (
                    <div className="mt-3 space-y-2 text-sm text-[var(--color-ink)]">
                      <p><span className="font-medium">Hook:</span> {s.hook}</p>
                      {s.body ? <p className="whitespace-pre-wrap text-[var(--color-ink-muted)]">{s.body}</p> : null}
                      {s.cta ? <p><span className="font-medium">CTA:</span> {s.cta}</p> : null}
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <ScriptDecision scriptId={s.id} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Leeswijzer: Zo lees je de scripts */}
      <section className="sc-glass p-6 sm:p-7">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">Leeswijzer</span>
        <h2 className="mt-1 text-[20px] font-bold tracking-tight">Zo lees je de scripts</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--color-ink)]/85">
          Elk script heeft vier vaste delen. Weet je hoe ze werken, dan lees je sneller en gerichter mee.
        </p>

        {/* De vier delen — groot, genummerd, makkelijk te scannen */}
        <ol className="mt-5 flex flex-col divide-y divide-white/10">
          {SCRIPT_PARTS.map((p) => (
            <li key={p.n} className="flex items-start gap-4 py-4 first:pt-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(46,144,250,0.15)] text-[15px] font-bold text-[#5bc0ff]">
                {Number(p.n)}
              </span>
              <div>
                <div className="text-[16px] font-semibold">{p.title}</div>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink)]/75">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Wat jij controleert — de enige actie die van jou wordt gevraagd */}
        <div className="mt-6 rounded-[16px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.07)] p-5 sm:p-6">
          <div className="text-[16px] font-bold">Waar jíj op let bij het lezen</div>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink)]/70">Loop deze vier vragen na — meer hoef je niet te doen.</p>
          <ul className="mt-4 flex flex-col gap-3">
            {CHECK_QUESTIONS.map((q, i) => (
              <li key={q} className="flex items-center gap-3 text-[15px] leading-snug">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#2fd27a] text-[13px] font-bold text-[#06231a]">{i + 1}</span>
                {q}
              </li>
            ))}
          </ul>
        </div>

        {/* Wat je NIET hoeft te doen + waarom — rustig, ondersteunend */}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-[14px] font-semibold text-[var(--color-ink)]">Dit hoef je níét te doen</div>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px] text-[var(--color-ink)]/70">
              {["De opening herschrijven of afzwakken", "Spreektaal formeler maken", "Volgorde of opbouw aanpassen", "Beeldkeuze, muziek of montage beoordelen"].map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[14px] bg-white/[0.03] p-4">
            <div className="text-[14px] font-semibold text-[var(--color-ink)]">Waarom het klinkt zoals het klinkt</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink)]/70">
              Short video werkt op ritme en spreektaal. Teksten die naar geschreven taal worden gladgestreken,
              presteren aantoonbaar slechter. Wij bewaken die kant, jullie de inhoud. Twijfel je? Zet er een
              opmerking bij, dan bespreken we het.
            </p>
          </div>
        </div>
      </section>

      {/* Hoe we communiceren */}
      <section className="sc-glass p-6">
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-[#4bc4ff]" />
          <h2 className="text-base font-semibold">Hoe we communiceren</h2>
        </div>
        <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {COMMS.map((c) => (
            <div key={c.k} className="flex items-start gap-2 border-t border-white/10 py-2.5 sm:border-t-0 sm:py-2">
              <Clock className="mt-0.5 size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
              <div>
                <dt className="text-[13.5px] font-semibold">{c.k}</dt>
                <dd className="text-[12.5px] text-[var(--color-ink-muted)]">{c.v}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
