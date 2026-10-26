import type { Metadata } from "next";
import { Building2, CalendarClock, ClipboardList, Clock, Film, Globe, Mail, Phone, Scale, UserRound, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalProfile } from "@/server/portal";
import { getPortalSettings } from "@/server/portal-settings";
import { buildAfsprakenGroepen } from "@/lib/portal-afspraken";
import { Avatar, buttonClass } from "@/components/ui";
import { formatDate, formatDateFull } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { OpnamedagContent, RolverdelingContent, TeamContent } from "./_content";

export const metadata: Metadata = { title: "Samenwerking" };
export const dynamic = "force-dynamic";

/** De diensten die standaard in elk Shortclips-pakket zitten. */
const INBEGREPEN = ["Contentstrategie & scripts", "Opnamedag & regie", "Montage, ondertiteling & audio", "Captions & hashtags", "Planning & publicatie", "Analyse & rapportage"];

function StatBlock({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="sc-glass p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        <span className="text-[var(--sc-accent)]">{icon}</span> {label}
      </div>
      <div className="mt-2 text-[22px] font-bold leading-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">{sub}</div> : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[var(--sc-line)] py-3 first:border-t-0">
      <span className="text-[13px] text-[var(--color-ink-muted)]">{k}</span>
      <span className="text-right text-[14px] font-semibold">{v}</span>
    </div>
  );
}

export default async function PortalSamenwerkingPage() {
  const viewer = await requirePortal();
  const [profile, contact, settings] = await Promise.all([getPortalProfile(viewer), getPortalContact(viewer), getPortalSettings()]);

  const platformLabels = profile.platforms.map((p) => PLATFORM[p]?.label ?? p);
  const perWeek = profile.monthlyQuota > 0 ? Math.round((profile.monthlyQuota / 4.33) * 10) / 10 : 0;
  const duurTekst = profile.monthsTogether != null
    ? `${profile.monthsTogether} ${profile.monthsTogether === 1 ? "maand" : "maanden"}${profile.daysTogether != null ? ` · ${profile.daysTogether} dagen` : ""}`
    : null;
  const afsprakenGroepen = buildAfsprakenGroepen(settings);
  const coord = contact.coordinator;
  const startIso = profile.contract?.startsOn ?? profile.startedOn ?? null;
  // Alleen een einddatum tonen als die er echt is én ná de start valt (geen rollend contract).
  const endIso = profile.contract?.endsOn && startIso && profile.contract.endsOn > startIso ? profile.contract.endsOn : null;

  return (
    <div className="flex flex-col gap-7">
      {/* 1 — Hero: logo, bedrijfsnaam, samenwerkingsduur */}
      <section className="sc-glass flex flex-wrap items-center gap-5 p-6">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-[var(--sc-line)] bg-[var(--sc-fill)]">
          {profile.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.company.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <Building2 className="size-7 text-[var(--sc-accent)]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold tracking-tight">{profile.company.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-[var(--color-ink-muted)]">
            <span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-[var(--sc-accent)]" /> {duurTekst ? `Al ${duurTekst} samen` : "Samenwerking met Shortclips"}</span>
            {profile.startedOn ? <span>· sinds {formatDate(profile.startedOn)}</span> : null}
          </p>
        </div>
      </section>

      {/* 2 — Vier informatieblokken */}
      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatBlock icon={<Film className="size-3.5" />} label="Shorts per maand" value={profile.monthlyQuota > 0 ? `${profile.monthlyQuota}` : "—"} sub={perWeek > 0 ? `± ${perWeek} per week online` : "in overleg"} />
        <StatBlock icon={<CalendarClock className="size-3.5" />} label="Samenwerking sinds" value={profile.startedOn ? formatDate(profile.startedOn) : "—"} sub={duurTekst ?? undefined} />
        <StatBlock icon={<UserRound className="size-3.5" />} label="Vaste contactpersoon" value={coord ? coord.name.split(" ")[0] : "Shortclips"} sub={coord?.role ?? "Je team"} />
        <StatBlock icon={<Film className="size-3.5" />} label="Geproduceerde shorts" value={`${profile.stats.shortsProduced}`} sub={profile.stats.opnamesDone > 0 ? `${profile.stats.opnamesDone} opnames gedaan` : "totaal online"} />
      </div>

      {/* 3 — Jouw ShortClips team */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Users className="size-4 text-[var(--sc-accent)]" /> Jouw ShortClips-team</h2>
        <TeamContent coordinator={contact.coordinator} videographer={contact.videographer} />
      </section>

      {/* A — Jouw contentpakket */}
      <section className="sc-glass p-6">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Jouw contentpakket</span>
        <div className="mt-3 grid gap-x-10 sm:grid-cols-2">
          <div>
            {profile.packageName ? <Row k="Pakket" v={profile.packageName} /> : null}
            <Row k="Shorts per maand" v={profile.monthlyQuota > 0 ? `${profile.monthlyQuota}` : "In overleg"} />
            {profile.shootDaysPerMonth > 0 ? <Row k="Opnamedagen per maand" v={`${profile.shootDaysPerMonth}`} /> : null}
            <Row k="Opnames gepland" v={profile.upcomingShoots > 0 ? `${profile.upcomingShoots}` : "Nog niet ingepland"} />
          </div>
          <div>
            {platformLabels.length > 0 ? (
              <Row k="Platformen" v={<span className="inline-flex flex-wrap justify-end gap-1.5">{platformLabels.map((p) => <span key={p} className="rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 text-[12px]">{p}</span>)}</span>} />
            ) : null}
            <Row k="Publicatie" v="Door Shortclips verzorgd" />
            <Row k="Startdatum" v={startIso ? formatDateFull(startIso) : "—"} />
            {endIso ? <Row k="Einddatum" v={formatDateFull(endIso)} /> : <Row k="Looptijd" v="Doorlopend, maandelijks opzegbaar" />}
          </div>
        </div>
        <div className="mt-4 border-t border-[var(--sc-line)] pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Inbegrepen</span>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {INBEGREPEN.map((d) => <span key={d} className="rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] px-2.5 py-1 text-[12px] text-[var(--color-ink-muted)]">{d}</span>)}
          </div>
        </div>
      </section>

      {/* B — Wie doet wat (rolverdeling + verantwoordelijkheden) */}
      <RolverdelingContent />

      {/* C — Belangrijke afspraken (uitklapbaar per categorie, centrale bron) */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Scale className="size-4 text-[var(--sc-accent)]" /> Belangrijke afspraken</h2>
        <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">De voorwaarden die bij jullie samenwerking horen. Afwijkende afspraken uit jullie offerte of overeenkomst gaan altijd voor.</p>
        <div className="flex flex-col gap-2.5">
          {afsprakenGroepen.map((g) => (
            <details key={g.title} className="sc-glass p-4 [&_summary]:cursor-pointer" open>
              <summary className="flex items-center justify-between gap-2 text-[14px] font-semibold">
                {g.title}
                <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">{g.items.length}</span>
              </summary>
              <dl className="mt-3 grid gap-2">
                {g.items.map((a) => (
                  <div key={a.k} className="grid gap-0.5 rounded-[12px] border border-[#2e90fa]/15 bg-[rgba(46,144,250,0.05)] p-3">
                    <dt className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--sc-accent)]"><span className="size-1.5 shrink-0 rounded-full bg-[#2e90fa]" /> {a.k}</dt>
                    <dd className="pl-3.5 text-[13px] text-[var(--color-ink-muted)]">{a.v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-[var(--color-ink-faint)]">Wijzigingen op deze afspraken leggen we schriftelijk vast bij de offerte.</p>
      </section>

      {/* 5 — Bedrijfsgegevens + contact */}
      <div className="grid gap-[18px] lg:grid-cols-2">
        <section className="sc-glass p-6">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]"><Building2 className="size-4 text-[var(--sc-accent)]" /> Bedrijfsgegevens</span>
          <div className="mt-3">
            <Row k="Bedrijfsnaam" v={profile.company.name} />
            {profile.company.legalName && profile.company.legalName !== profile.company.name ? <Row k="Juridische naam" v={profile.company.legalName} /> : null}
            {profile.company.sector ? <Row k="Branche" v={profile.company.sector} /> : null}
            {profile.company.website ? (
              <Row k="Website" v={<a href={profile.company.website.startsWith("http") ? profile.company.website : `https://${profile.company.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--sc-accent)] hover:underline"><Globe className="size-3.5" /> {profile.company.website.replace(/^https?:\/\//, "")}</a>} />
            ) : null}
          </div>
          {profile.clientContacts.length > 0 ? (
            <div className="mt-4 border-t border-[var(--sc-line)] pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Contactpersonen bij {profile.company.name}</span>
              <ul className="mt-2.5 flex flex-col gap-2">
                {profile.clientContacts.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="font-semibold">{c.name}</span>
                    {c.role ? <span className="text-[var(--color-ink-muted)]">· {c.role}</span> : null}
                    {c.isPrimary ? <span className="rounded-full bg-[rgba(25,168,255,0.14)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sc-accent)]">hoofdcontact</span> : null}
                    {c.email ? <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-[var(--color-ink-muted)] hover:text-[var(--sc-accent)]"><Mail className="size-3.5" /> {c.email}</a> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* Snel contact met de vaste contactpersoon */}
        {coord ? (
          <section className="sc-glass flex flex-col justify-center p-6">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Direct contact</span>
            <div className="mt-3 flex items-center gap-3.5">
              <Avatar name={coord.name} size={52} src={coord.avatarUrl} />
              <div>
                <div className="text-[16px] font-semibold">{coord.name}</div>
                <div className="text-[13px] text-[var(--color-ink-muted)]">{coord.role}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {coord.email ? <a href={`mailto:${coord.email}`} className={buttonClass({ variant: "primary", size: "sm" })}><Mail className="size-4" /> E-mail</a> : null}
              {coord.phone ? <a href={`tel:${coord.phone}`} className={buttonClass({ variant: "secondary", size: "sm" })}><Phone className="size-4" /> Bellen</a> : null}
            </div>
          </section>
        ) : null}
      </div>

      {/* Opnamedag — secundair, onderaan (staat ook bij Planning) */}
      <details className="sc-glass p-5 [&_summary]:cursor-pointer">
        <summary className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="size-4 text-[var(--sc-accent)]" /> Hoe een opnamedag verloopt</summary>
        <div className="mt-4"><OpnamedagContent /></div>
      </details>
    </div>
  );
}
