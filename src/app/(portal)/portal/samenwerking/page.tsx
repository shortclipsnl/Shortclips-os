import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/server/auth/context";
import { getPortalCollaboration, getPortalContact, getPortalData } from "@/server/portal";
import { getPortalSettings, type PortalSettings } from "@/server/portal-settings";
import { CountUp } from "@/components/portal/count-up";
import { formatDate } from "@/lib/format";
import { clientStatusView } from "@/lib/portal-status";
import { PLATFORM } from "@/lib/statuses";
import { TeamContent, WerkwijzeContent } from "./_content";

export const metadata: Metadata = { title: "Samenwerking" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "afspraken", label: "Afspraken" },
  { id: "werkwijze", label: "Werkwijze" },
  { id: "team", label: "Team" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** De diensten die standaard in elk Shortclips-pakket zitten. */
const INBEGREPEN = ["Contentstrategie & scripts", "Opnamedag & regie", "Montage, ondertiteling & audio", "Captions & hashtags", "Planning & publicatie", "Analyse & rapportage"];

/** Afspraken — de settable termijnen/bedragen komen uit de instellingen (intern aanpasbaar). */
function buildAfspraken(s: PortalSettings): Array<{ k: string; v: string }> {
  return [
    { k: "Looptijd", v: "Minimaal 3 maanden, daarna maandelijks opzegbaar met één kalendermaand." },
    { k: "Facturatie", v: "De facturatie vindt plaats vóór de opname." },
    { k: "Duur opnamedag", v: "Een opnamedag duurt gemiddeld 4 tot 7 uur." },
    { k: "Feedbackrondes", v: `Per video is één gebundelde feedbackronde inbegrepen. Alle feedback lever je in één keer volledig aan. Extra aanvullingen na het verwerken gelden als een nieuwe ronde: ${s.extraFeedbackFee}.` },
    { k: "Feedbacktermijn", v: `Je hebt ${s.feedbackDaysScripts} werkdagen voor scripts en ${s.feedbackDaysVideos} werkdagen voor video's om te reageren. ${s.responseTime}.` },
    { k: "Scripts", v: "Scripts worden vooraf afgestemd en vóór de opnamedag definitief akkoord gegeven. Kleine aanpassingen in woordkeuze op locatie zijn mogelijk. Grote inhoudelijke wijzigingen na akkoord zijn niet inbegrepen." },
    { k: "Opnieuw opnemen", v: `Bij wijzigingen aan een eerder goedgekeurd script: ${s.reshootFee}.` },
    { k: "Annulering", v: `Kosteloos tot ${s.cancelNoticeDays} werkdagen voor de opnamedag. Bij annulering binnen ${s.cancelNoticeDays} werkdagen wordt ${s.cancelFee} in rekening gebracht. ${s.cancelLateNote}` },
    { k: "Reistijd", v: `Onze reiskosten bedragen ${s.travelCost}.` },
    { k: "Raw footage", v: "Blijft bij Shortclips. Op verzoek beschikbaar per opnamedag, binnen 90 dagen." },
    { k: "Responstijd", v: s.responseTime + "." },
  ];
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-white/10 py-3 first:border-t-0">
      <span className="text-[13px] text-[var(--color-ink-muted)]">{k}</span>
      <span className="text-right text-[14px] font-semibold">{v}</span>
    </div>
  );
}

function AfsprakenContent({ settings }: { settings: PortalSettings }) {
  const AFSPRAKEN = buildAfspraken(settings);
  return (
    <section className="sc-glass p-6 sm:p-7">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">De afspraken</span>
      <h2 className="mt-1 text-[22px] font-bold tracking-tight">Zo leggen we het vast</h2>
      <p className="mt-2 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">
        Deze afspraken gelden voor elk niveau en zijn onderdeel van de overeenkomst.
      </p>
      <dl className="mt-5 grid gap-2.5">
        {AFSPRAKEN.map((a) => (
          <div key={a.k} className="grid gap-1 rounded-[13px] border border-[#2e90fa]/20 bg-[rgba(46,144,250,0.05)] p-4 sm:grid-cols-[200px_1fr] sm:gap-5">
            <dt className="flex items-center gap-2 text-[14px] font-semibold text-[#5bc0ff]">
              <span className="size-1.5 shrink-0 rounded-full bg-[#2e90fa]" />
              {a.k}
            </dt>
            <dd className="text-[13.5px] text-[var(--color-ink-muted)]">{a.v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-[13px] font-semibold text-[#4bc4ff]">
        Wijzigingen op deze afspraken leggen we schriftelijk vast bij de offerte.
      </p>
    </section>
  );
}

export default async function PortalSamenwerkingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await requirePortal();
  const { tab: tabParam } = await searchParams;
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "afspraken";

  const [data, collab, contact, settings] = await Promise.all([
    getPortalData(viewer),
    getPortalCollaboration(viewer),
    getPortalContact(viewer),
    getPortalSettings(),
  ]);
  const perWeek = collab.monthlyQuota > 0 ? Math.round((collab.monthlyQuota / 4.33) * 10) / 10 : 0;
  const platformLabels = collab.platforms.map((p) => PLATFORM[p]?.label ?? p);

  // Zelfde telling als het dashboard, zodat de aantallen overal gelijk zijn.
  const counts = { montage: 0, ingepland: 0 };
  for (const v of data.inProgress) {
    const k = clientStatusView(v.status).key;
    if (k === "montage") counts.montage++;
    else if (k === "ingepland") counts.ingepland++;
  }
  const online = data.published.length;
  const quota = collab.monthlyQuota;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Samenwerking</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Wat we hebben afgesproken, hoe we werken en wie je team is.
        </p>
      </div>

      {/* Altijd zichtbaar: huidige samenwerking + deze maand */}
      <div className="grid gap-[18px] lg:grid-cols-2">
        <section className="sc-glass p-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Huidige samenwerking</span>
          <div className="mt-4">
            {collab.packageName ? <Row k="Pakket" v={collab.packageName} /> : null}
            <Row k="Shorts per maand" v={quota > 0 ? `${quota} shorts` : "In overleg"} />
            {perWeek > 0 ? <Row k="Gemiddeld per week" v={`± ${perWeek} video's online`} /> : null}
            {collab.shootDaysPerMonth > 0 ? <Row k="Opnamedagen per maand" v={`${collab.shootDaysPerMonth}`} /> : null}
            <Row k="Opnames gepland" v={collab.upcomingShoots > 0 ? `${collab.upcomingShoots} opname${collab.upcomingShoots === 1 ? "" : "s"}` : "Nog niet ingepland"} />
            {platformLabels.length > 0 ? (
              <Row k="Platformen" v={<span className="inline-flex flex-wrap justify-end gap-1.5">{platformLabels.map((p) => <span key={p} className="rounded-full bg-white/10 px-2 py-0.5 text-[12px]">{p}</span>)}</span>} />
            ) : null}
            <Row k="Startdatum" v={collab.contract?.startsOn ? formatDate(collab.contract.startsOn) : collab.startedOn ? formatDate(collab.startedOn) : "—"} />
            {collab.contract?.endsOn ? <Row k="Einddatum overeenkomst" v={formatDate(collab.contract.endsOn)} /> : null}
            <Row k="Opzegtermijn" v={collab.contract ? `${Math.round(collab.contract.noticePeriodDays / 30)} kalendermaand` : "1 kalendermaand"} />
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Inbegrepen in je pakket</span>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {INBEGREPEN.map((d) => <span key={d} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-[var(--color-ink-muted)]">{d}</span>)}
            </div>
          </div>
        </section>
        <section className="sc-glass p-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Je video&apos;s</span>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-white/10 bg-white/5">
            {[
              { label: "In montage (nu)", value: counts.montage },
              { label: "Wacht op jou (nu)", value: data.awaitingApproval.length },
              { label: "Ingepland (nu)", value: counts.ingepland },
              { label: "Online (totaal)", value: online },
            ].map((s) => (
              <div key={s.label} className="bg-[rgba(10,12,38,0.6)] p-3">
                <CountUp value={s.value} className="block text-[20px] font-bold tabular-nums leading-none" />
                <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Tabs: Afspraken · Werkwijze · Team */}
      <nav className="flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 sm:w-fit">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/portal/samenwerking?tab=${t.id}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                active ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === "afspraken" ? <AfsprakenContent settings={settings} /> : null}
      {tab === "werkwijze" ? <WerkwijzeContent /> : null}
      {tab === "team" ? <TeamContent coordinator={contact.coordinator} videographer={contact.videographer} /> : null}
    </div>
  );
}
