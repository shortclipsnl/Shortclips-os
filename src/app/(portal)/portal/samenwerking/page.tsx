import type { Metadata } from "next";
import { Building2, Camera, ClipboardList, Clock, FileText, Film, Globe, Handshake, Lock, Mail, MessageCircle, MessageSquareText, Phone, Radio, Scale, Users } from "lucide-react";
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

function Agreement({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="sc-glass flex gap-3.5 p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--st-blue-bg)] text-[var(--st-blue)]">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <div className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">{children}</div>
      </div>
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
  const feedbackUren = settings.feedbackDaysVideos * 24;
  const scriptUren = settings.feedbackDaysScripts * 24;

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
        <div className="sc-glass p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Handshake className="size-5 text-[var(--sc-accent)]" /> Gegevens over de samenwerking</h2>
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
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[17px] font-semibold"><ClipboardList className="size-5 text-[var(--sc-accent)]" /> Werkafspraken</h2>
        <p className="mb-4 text-[13px] text-[var(--color-ink-muted)]">Zo werken we samen. Afwijkende afspraken uit jullie offerte of overeenkomst gaan altijd voor.</p>
        <div className="grid gap-3.5 md:grid-cols-2">
          <Agreement icon={<Film className="size-5" />} title="Aanlevering video's">
            Onze standaard leveringstermijn is <strong className="text-[var(--color-ink)]">{settings.deliveryWorkdays} werkdagen</strong> na de opnamedag, volgens de gemaakte afspraken.
          </Agreement>
          <Agreement icon={<MessageSquareText className="size-5" />} title="Feedback">
            Wij hanteren een feedbacktermijn van <strong className="text-[var(--color-ink)]">{feedbackUren} uur</strong>, tenzij anders afgesproken. Per video is één gebundelde feedbackronde inbegrepen; een extra ronde kost {settings.extraFeedbackFee}.
          </Agreement>
          <Agreement icon={<Camera className="size-5" />} title="Opnames">
            We plannen de opnamedag samen in en bereiden hem voor met scripts en een checklist. {settings.shootDuration} Kosteloos verzetten kan tot {settings.cancelNoticeDays} werkdagen vooraf.
          </Agreement>
          <Agreement icon={<FileText className="size-5" />} title="Scripts">
            Je ontvangt de scripts vóór de opname in dit portaal. Graag binnen <strong className="text-[var(--color-ink)]">{scriptUren} uur</strong> akkoord of feedback, zodat de opnamedag op schema blijft. Na akkoord zijn grote inhoudelijke wijzigingen niet inbegrepen.
          </Agreement>
          <Agreement icon={<Radio className="size-5" />} title="Publicatie">
            {profile.weHandlePosting
              ? "Shortclips plaatst de video's op de afgesproken kanalen, volgens de contentplanning in dit portaal."
              : "Jullie plaatsen de video's zelf. Wij leveren ze kant-en-klaar aan, en de contentplanning in dit portaal laat zien wanneer welke video klaarstaat."}
          </Agreement>
          <Agreement icon={<Handshake className="size-5" />} title="Pakket en samenwerking">
            {profile.monthlyQuota > 0 ? <>{profile.monthlyQuota} video&apos;s per maand</> : <>Aantal video&apos;s volgens jullie offerte</>}
            {focus ? <>, {focus.toLowerCase()}</> : null}
            {looptijd ? <>, looptijd: {looptijd.toLowerCase()}</> : <>. {settings.contractTerm}</>}
          </Agreement>
        </div>
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
