import type { Metadata } from "next";
import { AlertCircle, Building2, CalendarClock, Camera, CheckCircle2, ClipboardList, Clock, FileText, Film, Globe, Handshake, Lock, Mail, MessageCircle, MessageSquareText, Phone, Radio, Scale, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalProfile } from "@/server/portal";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { buildAfsprakenGroepen } from "@/lib/portal-afspraken";
import { TeamAvatar } from "@/components/ui";
import { portalBtn } from "@/components/portal/status-pill";
import { formatDateFull } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { OpnamedagContent, RolverdelingContent, TeamContent } from "./_content";

export const metadata: Metadata = { title: "Samenwerking & Afspraken" };
export const dynamic = "force-dynamic";

const FOCUS: Record<string, string> = { organisch: "Organische content", advertentie: "Advertenties", beide: "Organisch en advertenties", combinatie: "Organisch en advertenties" };

/** Ontbrekend gegeven: eerlijk tonen in plaats van iets invullen. */
function Missing() {
  return <span className="inline-flex items-center rounded-full bg-[var(--st-grey-bg)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--st-grey)]">Wordt aangevuld door Shortclips</span>;
}

function Field({ label, value, sub }: { label: string; value: React.ReactNode | null; sub?: string | null }) {
  return (
    <div className="flex flex-col gap-1 border-t border-[var(--sc-line)] py-3.5 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-[14.5px] font-semibold sm:text-right">
        {value ?? <Missing />}
        {sub ? <div className="mt-0.5 text-[12px] font-normal text-[var(--color-ink-muted)]">{sub}</div> : null}
      </dd>
    </div>
  );
}

type Tone = "blue" | "orange" | "green" | "navy";
const TONE: Record<Tone, { fg: string; bg: string; owner: string }> = {
  blue: { fg: "var(--st-blue)", bg: "var(--st-blue-bg)", owner: "Shortclips regelt dit" },
  orange: { fg: "var(--st-orange)", bg: "var(--st-orange-bg)", owner: "Jullie actie" },
  green: { fg: "var(--st-green)", bg: "var(--st-green-bg)", owner: "Samen" },
  navy: { fg: "var(--sc-accent)", bg: "var(--sc-fill-strong)", owner: "Afspraak" },
};

/** Eén werkafspraak: gekleurde rand en icoon per verantwoordelijke, met de belangrijkste termijn als label. */
function Agreement({ icon, title, tone, keyTerm, children }: { icon: React.ReactNode; title: string; tone: Tone; keyTerm?: string | null; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <div className="sw-card relative flex gap-3.5 overflow-hidden rounded-[16px] border p-5 pl-6" style={{ ["--tone" as string]: t.fg, ["--tone-bg" as string]: t.bg }}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: t.fg }} />
      <span className="grid size-11 shrink-0 place-items-center rounded-[12px]" style={{ background: t.bg, color: t.fg }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ background: t.bg, color: t.fg }}>{t.owner}</span>
        </div>
        {keyTerm ? <div className="mt-1.5 text-[18px] font-bold leading-tight tracking-tight" style={{ color: t.fg }}>{keyTerm}</div> : null}
        <div className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)] [&_strong]:font-semibold [&_strong]:text-[var(--color-ink)]">{children}</div>
      </div>
    </div>
  );
}

/** Grote termijn in de strook bovenaan de werkafspraken. */
function Term({ icon, tone, value, label, sub }: { icon: React.ReactNode; tone: Tone; value: string; label: string; sub: string }) {
  const t = TONE[tone];
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border p-4" style={{ background: t.bg, borderColor: `color-mix(in srgb, ${t.fg} 22%, transparent)` }}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: t.fg }}>{icon} {label}</div>
      <div className="text-[24px] font-bold leading-tight tracking-tight text-[var(--color-ink)]">{value}</div>
      <div className="text-[12px] text-[var(--color-ink-muted)]">{sub}</div>
    </div>
  );
}

export default async function PortalSamenwerkingPage() {
  const viewer = await requirePortal();
  const [profile, contact, settings] = await Promise.all([getPortalProfile(viewer), getPortalContact(viewer), getPortalSettingsForClient(viewer.clientId ?? "")]);

  const coord = contact.coordinator;
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
    <div className="flex flex-col gap-8">
      {/* Kop */}
      <section className="flex flex-wrap items-center gap-5">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)]">
          {profile.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.company.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <Building2 className="size-7 text-[var(--sc-accent)]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Samenwerking &amp; Afspraken</p>
          <h1 className="text-[26px] font-bold tracking-tight">{profile.company.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
            Alles wat we samen hebben afgesproken, op één plek.{duur ? ` ${duur.charAt(0).toUpperCase()}${duur.slice(1)}.` : ""}
          </p>
        </div>
      </section>

      {/* Gegevens over de samenwerking */}
      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[18px] border border-[var(--sc-accent)]/35 p-5 shadow-[var(--shadow-card)] sm:p-6" style={{ background: "color-mix(in srgb, var(--sc-accent) 9%, transparent)" }}>
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-[var(--sc-accent)]"><Handshake className="size-5" /> Gegevens over de samenwerking</h2>
          <dl className="mt-3">
            <Field label="Bedrijf" value={profile.company.legalName && profile.company.legalName !== profile.company.name ? `${profile.company.name} (${profile.company.legalName})` : profile.company.name} />
            <Field label="Actief pakket" value={profile.packageName} />
            <Field label="Video's per maand" value={profile.monthlyQuota > 0 ? `${profile.monthlyQuota} video's` : null} sub={profile.shootDaysPerMonth > 0 ? `${profile.shootDaysPerMonth} opnamedag${profile.shootDaysPerMonth === 1 ? "" : "en"} per maand` : null} />
            <Field label="Type video's" value={focus} />
            <Field label="Kanalen" value={platformLabels.length ? platformLabels.join(", ") : null} />
            <Field label="Startdatum" value={startIso ? formatDateFull(startIso) : null} />
            <Field label="Contractduur" value={looptijd} sub={!looptijd ? null : profile.contract?.startsOn ? `Contract gestart op ${formatDateFull(profile.contract.startsOn)}` : null} />
            <Field label="Opzegtermijn" value={opzeg} />
          </dl>
        </div>

        {/* Contactpersoon Shortclips */}
        <div className="sc-glass flex flex-col p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold">Jouw contactpersoon</h2>
          {coord ? (
            <>
              <div className="mt-4 flex items-center gap-3.5">
                <TeamAvatar name={coord.name} avatarUrl={coord.avatarUrl} size={64} />
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold">{coord.name}</div>
                  <div className="text-[13px] text-[var(--color-ink-muted)]">{coord.role}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-1 text-[13px] text-[var(--color-ink-muted)]">
                {coord.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" /> {coord.phone}</span> : null}
                {coord.email ? <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" /> {coord.email}</span> : null}
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                {coord.phone ? <a href={`https://wa.me/${coord.phone.replace(/[^\d]/g, "").replace(/^0/, "31")}`} target="_blank" rel="noreferrer" className={portalBtn.cta}><MessageCircle className="size-4" /> WhatsApp</a> : null}
                {coord.email ? <a href={`mailto:${coord.email}`} className={portalBtn.soft}><Mail className="size-4" /> E-mail</a> : null}
              </div>
            </>
          ) : (
            <div className="mt-3"><Missing /></div>
          )}
          <p className="mt-4 border-t border-[var(--sc-line)] pt-3 text-[12px] text-[var(--color-ink-faint)]">Bereikbaar: {settings.responseTime}</p>
        </div>
      </section>

      {/* Werkafspraken */}
      <section className="sw-afspraken rounded-[20px] border border-[var(--sc-line)] p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-tight"><ClipboardList className="size-5 text-[var(--sc-accent)]" /> Werkafspraken</h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] text-[var(--color-ink-muted)]">Deze afspraken zorgen ervoor dat alles op schema blijft. Afwijkende afspraken uit jullie offerte of overeenkomst gaan altijd voor.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-orange-bg)] px-2.5 py-1 text-[var(--st-orange)]"><span className="size-2 rounded-full bg-[var(--st-orange)]" /> Jullie actie</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-blue-bg)] px-2.5 py-1 text-[var(--st-blue)]"><span className="size-2 rounded-full bg-[var(--st-blue)]" /> Shortclips regelt dit</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-green-bg)] px-2.5 py-1 text-[var(--st-green)]"><span className="size-2 rounded-full bg-[var(--st-green)]" /> Samen</span>
          </div>
        </div>

        {/* Belangrijkste termijnen */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Term icon={<Film className="size-3.5" />} tone="blue" value={wd(settings.deliveryWorkdays)} label="Levering video's" sub="na de opnamedag" />
          <Term icon={<MessageSquareText className="size-3.5" />} tone="orange" value={wd(settings.feedbackDaysVideos)} label="Feedback op video's" sub="na oplevering, één gebundelde ronde" />
          <Term icon={<FileText className="size-3.5" />} tone="orange" value={wd(settings.feedbackDaysScripts)} label="Akkoord op scripts" sub="voor de opnamedag" />
          <Term icon={<CalendarClock className="size-3.5" />} tone="green" value={wd(settings.cancelNoticeDays)} label="Opname verzetten" sub="vooraf kosteloos mogelijk" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Agreement icon={<FileText className="size-5" />} title="Scripts" tone="orange" keyTerm={`Binnen ${wd(settings.feedbackDaysScripts)} akkoord of feedback`}>
            Je ontvangt de scripts vóór de opname in dit portaal. Zo blijft de opnamedag op schema. <strong>Na akkoord zijn grote inhoudelijke wijzigingen niet inbegrepen.</strong>
          </Agreement>
          <Agreement icon={<MessageSquareText className="size-5" />} title="Feedback op video's" tone="orange" keyTerm={`Binnen ${wd(settings.feedbackDaysVideos)} na oplevering`}>
            Het weekend telt niet mee, tenzij anders afgesproken. <strong>Per video is één gebundelde feedbackronde inbegrepen</strong>; een extra ronde kost {settings.extraFeedbackFee}.
          </Agreement>
          <Agreement icon={<Film className="size-5" />} title="Aanlevering video's" tone="blue" keyTerm={`${wd(settings.deliveryWorkdays)} na de opnamedag`}>
            Dit is onze standaard leveringstermijn, volgens de gemaakte afspraken.
          </Agreement>
          <Agreement icon={<Camera className="size-5" />} title="Opnames" tone="green" keyTerm={`Verzetten tot ${wd(settings.cancelNoticeDays)} vooraf`}>
            We plannen de opnamedag samen in en bereiden hem voor met scripts en een checklist. {settings.shootDuration}
          </Agreement>
          <Agreement icon={<Radio className="size-5" />} title="Publicatie" tone={profile.weHandlePosting ? "blue" : "orange"} keyTerm="Volgens de contentplanning">
            {profile.weHandlePosting
              ? "Shortclips plaatst de video's op de afgesproken kanalen, volgens de contentplanning in dit portaal."
              : "Jullie plaatsen de video's zelf. Wij leveren ze kant-en-klaar aan, en de contentplanning in dit portaal laat zien wanneer welke video klaarstaat."}
          </Agreement>
          <Agreement icon={<Handshake className="size-5" />} title="Pakket en samenwerking" tone="navy" keyTerm={profile.monthlyQuota > 0 ? `${profile.monthlyQuota} video's per maand` : null}>
            {profile.monthlyQuota > 0 ? null : <>Aantal video&apos;s volgens jullie offerte. </>}
            {focus ? <>{focus}. </> : null}
            {looptijd ? <>Looptijd: {looptijd.toLowerCase()}.</> : <>{settings.contractTerm}</>}
          </Agreement>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-[color-mix(in_srgb,var(--st-orange)_25%,transparent)] bg-[var(--st-orange-bg)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)]">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--st-orange)]" />
          <span><strong className="font-semibold">Waarom deze termijnen belangrijk zijn:</strong> als scripts en feedback op tijd binnen zijn, kunnen wij de opnames en oplevering volgens planning houden.</span>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)]"><CheckCircle2 className="size-3.5 text-[var(--st-green)]" /> Werkdagen zijn maandag tot en met vrijdag.</p>
      </section>

      {/* Wie doet wat */}
      <RolverdelingContent />

      {/* Voorwaarden */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[17px] font-semibold"><Scale className="size-5 text-[var(--sc-accent)]" /> Belangrijke voorwaarden</h2>
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

      {/* Team */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold"><Users className="size-5 text-[var(--sc-accent)]" /> Jouw Shortclips-team</h2>
        <TeamContent coordinator={contact.coordinator} videographer={contact.videographer} />
      </section>

      {/* Bedrijfsgegevens + contactpersonen van de klant */}
      {profile.company.website || profile.clientContacts.length > 0 ? (
        <section className="sc-glass p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Building2 className="size-4 text-[var(--sc-accent)]" /> Jullie gegevens</h2>
          <div className="mt-3 flex flex-col gap-2 text-[13.5px]">
            {profile.company.website ? (
              <a href={profile.company.website.startsWith("http") ? profile.company.website : `https://${profile.company.website}`} target="_blank" rel="noreferrer" className={portalBtn.link}><Globe className="size-3.5" /> {profile.company.website.replace(/^https?:\/\//, "")}</a>
            ) : null}
            {profile.clientContacts.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{c.name}</span>
                {c.role ? <span className="text-[var(--color-ink-muted)]">{c.role}</span> : null}
                {c.isPrimary ? <span className="rounded-full bg-[var(--st-blue-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--st-blue)]">Hoofdcontact</span> : null}
                {c.email ? <span className="inline-flex items-center gap-1 text-[var(--color-ink-muted)]"><Mail className="size-3.5" /> {c.email}</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="sc-glass p-5 [&_summary]:cursor-pointer">
        <summary className="flex items-center gap-2 text-[15px] font-semibold"><Clock className="size-4 text-[var(--sc-accent)]" /> Hoe een opnamedag verloopt</summary>
        <div className="mt-4"><OpnamedagContent /></div>
      </details>

      <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)]">
        <Lock className="size-3.5" /> Deze afspraken zijn alleen-lezen. Klopt er iets niet of wil je iets wijzigen? Neem contact op met je contactpersoon; Team Shortclips past het aan.
      </p>
    </div>
  );
}
