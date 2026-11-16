import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarClock, Camera, CheckCircle2, ClipboardList, FileText, Film, Globe, Handshake, Info, Lock, Mail, MessageCircle, MessageSquareText, Phone, Radio, Scale, Video } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalProfile, type PortalContactPerson } from "@/server/portal";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { buildAfsprakenGroepen } from "@/lib/portal-afspraken";
import { TeamAvatar } from "@/components/ui";
import { portalBtn } from "@/components/portal/status-pill";
import { formatDateFull } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { OpnamedagContent, RolverdelingContent } from "./_content";

export const metadata: Metadata = { title: "Samenwerking & Afspraken" };
export const dynamic = "force-dynamic";

const FOCUS: Record<string, string> = { organisch: "Organische content", advertentie: "Advertenties", beide: "Organisch en advertenties", combinatie: "Organisch en advertenties" };

/** Ontbrekend gegeven in het donkerblauwe blok: eerlijk tonen in plaats van iets invullen. */
function MissingOnNavy() {
  return <span className="inline-flex items-center rounded-full bg-white/12 px-2.5 py-0.5 text-[12px] font-medium text-white/75">Wordt aangevuld door Shortclips</span>;
}

/** Ontbrekend gegeven op een lichte kaart. */
function Missing() {
  return <span className="inline-flex items-center rounded-full bg-[var(--st-grey-bg)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--st-grey)]">Wordt aangevuld door Shortclips</span>;
}

/** Eén gegeven in het donkerblauwe blok: klein label, grote witte waarde. */
function NavyField({ label, value, sub, wide = false }: { label: string; value: React.ReactNode | null; sub?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-wider text-white/60">{label}</dt>
      <dd className="mt-1 text-[17px] font-bold leading-snug text-white">
        {value ?? <MissingOnNavy />}
        {sub ? <div className="mt-0.5 text-[12.5px] font-normal text-white/70">{sub}</div> : null}
      </dd>
    </div>
  );
}

/** Contactpersoon of videograaf: foto, naam, rol en directe contactknoppen. */
function Person({ label, person, showButtons }: { label: string; person: PortalContactPerson; showButtons: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
      <div className="flex items-center gap-3.5">
        <TeamAvatar name={person.name} avatarUrl={person.avatarUrl} size={56} />
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-[var(--color-ink)]">{person.name}</div>
          <div className="text-[13px] text-[var(--color-ink-muted)]">{person.role}</div>
          {showButtons ? (
            <div className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-[var(--color-ink-muted)]">
              {person.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" /> {person.phone}</span> : null}
              {person.email ? <span className="inline-flex items-center gap-1.5 break-all"><Mail className="size-3.5 shrink-0" /> {person.email}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {showButtons && (person.phone || person.email) ? (
        <div className="flex flex-wrap gap-2">
          {person.phone ? <a href={`https://wa.me/${person.phone.replace(/[^\d]/g, "").replace(/^0/, "31")}`} target="_blank" rel="noreferrer" className={portalBtn.cta}><MessageCircle className="size-4" /> WhatsApp</a> : null}
          {person.email ? <a href={`mailto:${person.email}`} className={portalBtn.soft}><Mail className="size-4" /> E-mail</a> : null}
        </div>
      ) : null}
    </div>
  );
}

type Owner = "jullie" | "shortclips" | "samen" | "afspraak";
const OWNER: Record<Owner, { label: string; cls: string }> = {
  jullie: { label: "Jullie actie", cls: "bg-[var(--st-green-bg)] text-[var(--st-green)]" },
  shortclips: { label: "Shortclips", cls: "sw-chip-navy" },
  samen: { label: "Samen", cls: "bg-[var(--st-grey-bg)] text-[var(--st-grey)]" },
  afspraak: { label: "Afspraak", cls: "bg-[var(--st-grey-bg)] text-[var(--st-grey)]" },
};

/** Eén werkafspraak: rustige witte kaart, donkerblauwe kop, termijn duidelijk zichtbaar. */
function Agreement({ icon, title, owner, keyTerm, children }: { icon: React.ReactNode; title: string; owner: Owner; keyTerm?: string | null; children: React.ReactNode }) {
  const o = OWNER[owner];
  return (
    <div className="sw-card flex flex-col gap-2 rounded-[16px] border border-[var(--sc-line)] p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[15.5px] font-bold text-[var(--color-ink)]">
          <span className="text-[var(--color-ink-faint)]">{icon}</span>{title}
        </h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${o.cls}`}>{o.label}</span>
      </div>
      {keyTerm ? <div className="text-[17px] font-bold leading-tight tracking-tight text-[var(--color-ink)]">{keyTerm}</div> : null}
      <div className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)] [&_strong]:font-semibold [&_strong]:text-[var(--color-ink)]">{children}</div>
    </div>
  );
}

/** Belangrijke termijn: groot getal. Termijnen waar de klant aan zet is krijgen een subtiel groene achtergrond. */
function Term({ icon, owner, value, label, sub }: { icon: React.ReactNode; owner: "jullie" | "shortclips"; value: string; label: string; sub: string }) {
  const jullie = owner === "jullie";
  return (
    <div className={`flex flex-col gap-1 rounded-[14px] border p-4 ${jullie ? "border-[color-mix(in_srgb,var(--st-green)_22%,transparent)] bg-[var(--st-green-bg)]" : "border-[var(--sc-line)] bg-[var(--sc-fill)]"}`}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-ink-muted)]">{icon} {label}</div>
      <div className="text-[26px] font-bold leading-tight tracking-tight text-[var(--color-ink)]">{value}</div>
      <div className="text-[12px] text-[var(--color-ink-muted)]">{sub}</div>
      <div className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${jullie ? "text-[var(--st-green)]" : "text-[var(--color-ink-faint)]"}`}>{jullie ? "Jullie actie" : "Shortclips"}</div>
    </div>
  );
}

export default async function PortalSamenwerkingPage() {
  const viewer = await requirePortal();
  const [profile, contact, settings] = await Promise.all([getPortalProfile(viewer), getPortalContact(viewer), getPortalSettingsForClient(viewer.clientId ?? "")]);

  const coord = contact.coordinator;
  const videographer = contact.videographer;
  const platformLabels = profile.platforms.map((p) => PLATFORM[p]?.label ?? p);
  const startIso = profile.startedOn;
  const endIso = profile.contract?.endsOn && startIso && profile.contract.endsOn > startIso ? profile.contract.endsOn : null;
  const focus = profile.contentFocus ? FOCUS[profile.contentFocus] ?? profile.contentFocus : null;

  // Contractduur: uitsluitend uit het klantdossier (contract of vastgelegde looptijd).
  const looptijd = endIso
    ? `Tot en met ${formatDateFull(endIso)}`
    : profile.contractMonths
      ? `${profile.contractMonths} maanden`
      : null;
  const opzeg = profile.contract?.noticePeriodDays ? `${profile.contract.noticePeriodDays} dagen` : null;
  const duur = profile.monthsTogether != null && profile.monthsTogether > 0
    ? `${profile.monthsTogether} ${profile.monthsTogether === 1 ? "maand" : "maanden"} samen`
    : profile.daysTogether != null ? `${profile.daysTogether} ${profile.daysTogether === 1 ? "dag" : "dagen"} samen` : null;
  const wd = (n: number) => `${n} ${n === 1 ? "werkdag" : "werkdagen"}`;

  return (
    <div className="flex flex-col gap-10">
      {/* Kop */}
      <section className="flex flex-wrap items-center gap-5">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)]">
          {profile.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.company.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <Building2 className="size-7 text-[var(--color-ink)]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Samenwerking &amp; Afspraken</p>
          <h1 className="text-[26px] font-bold tracking-tight text-[var(--color-ink)]">{profile.company.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
            Alles wat we samen hebben afgesproken, op één plek.{duur ? ` ${duur.charAt(0).toUpperCase()}${duur.slice(1)}.` : ""}
          </p>
        </div>
      </section>

      {/* Gegevens over de samenwerking + contactpersoon en videograaf */}
      <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <div className="sw-navy rounded-[20px] p-6 text-white shadow-[var(--shadow-raised)] sm:p-8">
          <h2 className="flex items-center gap-2.5 text-[19px] font-bold text-white"><Handshake className="size-5" /> Gegevens over de samenwerking</h2>
          <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <NavyField wide label="Bedrijf" value={profile.company.legalName && profile.company.legalName !== profile.company.name ? `${profile.company.name} (${profile.company.legalName})` : profile.company.name} />
            <NavyField label="Actief pakket" value={profile.packageName} />
            <NavyField label="Video's per maand" value={profile.monthlyQuota > 0 ? `${profile.monthlyQuota} video's` : null} sub={profile.shootDaysPerMonth > 0 ? `${profile.shootDaysPerMonth} opnamedag${profile.shootDaysPerMonth === 1 ? "" : "en"} per maand` : null} />
            <NavyField label="Type video's" value={focus} />
            <NavyField label="Kanalen" value={platformLabels.length ? platformLabels.join(", ") : null} />
            <NavyField label="Startdatum" value={startIso ? formatDateFull(startIso) : null} />
            <NavyField label="Contractduur" value={looptijd} sub={!looptijd ? null : profile.contract?.startsOn ? `Contract gestart op ${formatDateFull(profile.contract.startsOn)}` : null} />
            <NavyField label="Opzegtermijn" value={opzeg} />
          </dl>
        </div>

        <div className="sc-glass flex flex-col gap-6 p-6 sm:p-7">
          <h2 className="text-[17px] font-bold text-[var(--color-ink)]">Jouw vaste team</h2>
          {coord ? <Person label="Jouw contactpersoon" person={coord} showButtons /> : (
            <div className="flex flex-col gap-2"><span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Jouw contactpersoon</span><Missing /></div>
          )}
          <div className="border-t border-[var(--sc-line)]" />
          {videographer ? <Person label="Jouw videograaf" person={videographer} showButtons={false} /> : (
            <div className="flex flex-col gap-2"><span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Jouw videograaf</span><Missing /></div>
          )}
          <p className="mt-auto flex items-start gap-1.5 border-t border-[var(--sc-line)] pt-3 text-[12px] text-[var(--color-ink-faint)]">
            <Video className="mt-0.5 size-3.5 shrink-0" /> Bereikbaar: {settings.responseTime}. Feedback op video&apos;s geef je via de <Link href="/portal/videos" className="font-semibold text-[var(--color-ink)] underline-offset-2 hover:underline">videopagina</Link>.
          </p>
        </div>
      </section>

      {/* Werkafspraken */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-[21px] font-bold tracking-tight text-[var(--color-ink)]"><ClipboardList className="size-5" /> Werkafspraken</h2>
          <p className="mt-1 max-w-[62ch] text-[13.5px] text-[var(--color-ink-muted)]">Deze afspraken zorgen ervoor dat alles op schema blijft. Afwijkende afspraken uit jullie offerte of overeenkomst gaan altijd voor.</p>
        </div>

        {/* Belangrijkste termijnen */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Term icon={<Film className="size-3.5" />} owner="shortclips" value={wd(settings.deliveryWorkdays)} label="Levering video's" sub="na de opnamedag" />
          <Term icon={<MessageSquareText className="size-3.5" />} owner="jullie" value={wd(settings.feedbackDaysVideos)} label="Feedback op video's" sub="na oplevering, één gebundelde ronde" />
          <Term icon={<FileText className="size-3.5" />} owner="jullie" value={wd(settings.feedbackDaysScripts)} label="Akkoord op scripts" sub="voor de opnamedag" />
          <Term icon={<CalendarClock className="size-3.5" />} owner="jullie" value={wd(settings.cancelNoticeDays)} label="Opname verzetten" sub="vooraf kosteloos mogelijk" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Agreement icon={<FileText className="size-4" />} title="Scripts" owner="jullie" keyTerm={`Binnen ${wd(settings.feedbackDaysScripts)} akkoord of feedback`}>
            Je ontvangt de scripts vóór de opname in dit portaal. Zo blijft de opnamedag op schema. <strong>Na akkoord zijn grote inhoudelijke wijzigingen niet inbegrepen.</strong>
          </Agreement>
          <Agreement icon={<MessageSquareText className="size-4" />} title="Feedback op video's" owner="jullie" keyTerm={`Binnen ${wd(settings.feedbackDaysVideos)} na oplevering`}>
            Het weekend telt niet mee, tenzij anders afgesproken. <strong>Per video is één gebundelde feedbackronde inbegrepen</strong>; een extra ronde kost {settings.extraFeedbackFee}.
          </Agreement>
          <Agreement icon={<Film className="size-4" />} title="Aanlevering video's" owner="shortclips" keyTerm={`${wd(settings.deliveryWorkdays)} na de opnamedag`}>
            Dit is onze standaard leveringstermijn, volgens de gemaakte afspraken.
          </Agreement>
          <Agreement icon={<Camera className="size-4" />} title="Opnames" owner="samen" keyTerm={`Verzetten tot ${wd(settings.cancelNoticeDays)} vooraf`}>
            We plannen de opnamedag samen in en bereiden hem voor met scripts en een checklist. {settings.shootDuration}
          </Agreement>
          <Agreement icon={<Radio className="size-4" />} title="Publicatie" owner={profile.weHandlePosting ? "shortclips" : "jullie"} keyTerm="Volgens de contentplanning">
            {profile.weHandlePosting
              ? "Shortclips plaatst de video's op de afgesproken kanalen, volgens de contentplanning in dit portaal."
              : "Jullie plaatsen de video's zelf. Wij leveren ze kant-en-klaar aan, en de contentplanning in dit portaal laat zien wanneer welke video klaarstaat."}
          </Agreement>
          <Agreement icon={<Handshake className="size-4" />} title="Pakket en samenwerking" owner="afspraak" keyTerm={profile.monthlyQuota > 0 ? `${profile.monthlyQuota} video's per maand` : null}>
            {profile.monthlyQuota > 0 ? null : <>Aantal video&apos;s volgens jullie offerte. </>}
            {focus ? <>{focus}. </> : null}
            {looptijd ? <>Looptijd: {looptijd.toLowerCase()}.</> : <>{settings.contractTerm}</>}
          </Agreement>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          <span className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-[var(--color-ink)]" /><span><strong className="font-semibold text-[var(--color-ink)]">Waarom deze termijnen belangrijk zijn:</strong> als scripts en feedback op tijd binnen zijn, kunnen wij de opnames en oplevering volgens planning houden.</span></span>
          <span className="flex items-center gap-2 text-[12px] text-[var(--color-ink-faint)]"><CheckCircle2 className="size-4 shrink-0 text-[var(--st-green)]" /> Werkdagen zijn maandag tot en met vrijdag.</span>
        </div>
      </section>

      {/* Wie doet wat */}
      <RolverdelingContent weHandlePosting={profile.weHandlePosting} />

      {/* Hoe een opnamedag verloopt: standaard volledig open */}
      <OpnamedagContent />

      {/* Voorwaarden */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[17px] font-bold text-[var(--color-ink)]"><Scale className="size-5" /> Belangrijke voorwaarden</h2>
        <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">De voorwaarden die bij jullie samenwerking horen.</p>
        <div className="flex flex-col gap-2.5">
          {buildAfsprakenGroepen(settings).map((g) => (
            <details key={g.title} className="sc-glass p-4 [&_summary]:cursor-pointer">
              <summary className="flex items-center justify-between gap-2 text-[14.5px] font-semibold">
                {g.title}
                <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">{g.items.length} afspraken</span>
              </summary>
              <dl className="mt-3 grid gap-2">
                {g.items.map((a) => (
                  <div key={a.k} className="grid gap-0.5 rounded-[12px] bg-[var(--sc-fill)] p-3">
                    <dt className="text-[13.5px] font-semibold">{a.k}</dt>
                    <dd className="text-[13px] text-[var(--color-ink-muted)]">{a.v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      </section>

      {/* Bedrijfsgegevens + contactpersonen van de klant */}
      {profile.company.website || profile.clientContacts.length > 0 ? (
        <section className="sc-glass p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-[var(--color-ink)]"><Building2 className="size-4" /> Jullie gegevens</h2>
          <div className="mt-3 flex flex-col gap-2 text-[13.5px]">
            {profile.company.website ? (
              <a href={profile.company.website.startsWith("http") ? profile.company.website : `https://${profile.company.website}`} target="_blank" rel="noreferrer" className={portalBtn.link}><Globe className="size-3.5" /> {profile.company.website.replace(/^https?:\/\//, "")}</a>
            ) : null}
            {profile.clientContacts.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{c.name}</span>
                {c.role ? <span className="text-[var(--color-ink-muted)]">{c.role}</span> : null}
                {c.isPrimary ? <span className="sw-chip-navy rounded-full px-2 py-0.5 text-[11px] font-semibold">Hoofdcontact</span> : null}
                {c.email ? <span className="inline-flex items-center gap-1 text-[var(--color-ink-muted)]"><Mail className="size-3.5" /> {c.email}</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)]">
        <Lock className="size-3.5" /> Deze afspraken zijn alleen-lezen. Klopt er iets niet of wil je iets wijzigen? Neem contact op met je contactpersoon; Team Shortclips past het aan.
      </p>
    </div>
  );
}
