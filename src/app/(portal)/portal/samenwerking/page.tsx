import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarCheck, UserRound } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalCollaboration, getPortalContact, getPortalData } from "@/server/portal";
import { CountUp } from "@/components/portal/count-up";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Samenwerking" };
export const dynamic = "force-dynamic";

const READY_STATUSES = new Set(["approved", "ready_to_publish", "scheduled"]);

const AFSPRAKEN = [
  { k: "Looptijd", v: "Minimaal 3 maanden, daarna maandelijks opzegbaar met één kalendermaand." },
  { k: "Facturatie", v: "De facturatie vindt plaats vóór de opname." },
  { k: "Duur opnamedag", v: "Een opnamedag duurt gemiddeld 4 tot 7 uur." },
  { k: "Feedbackrondes", v: "Per video is één gebundelde feedbackronde inbegrepen. Alle feedback wordt in één keer volledig aangeleverd. Extra aanvullingen nadat de feedbackronde is verwerkt, gelden als een nieuwe feedbackronde en kosten € 75 per ronde." },
  { k: "Scripts", v: "Scripts worden vooraf afgestemd en vóór de opnamedag definitief akkoord gegeven. Kleine aanpassingen in woordkeuze op locatie zijn mogelijk. Grote inhoudelijke wijzigingen na akkoord zijn niet inbegrepen." },
  { k: "Opnieuw opnemen", v: "Bij wijzigingen aan een eerder goedgekeurd script wordt € 95 per opnieuw opgenomen video berekend. Bij een fout vanuit ShortClips is dit kosteloos." },
  { k: "Extra content op locatie", v: "Extra video's kunnen tijdens een opnamedag worden opgenomen wanneer de planning dit toelaat. Dit geldt uitsluitend voor short video content en wordt aanvullend gefactureerd volgens het geldende tarief." },
  { k: "Beoordelingstermijn", v: "3 werkdagen na oplevering. Geen reactie binnen 5 werkdagen geldt als akkoord." },
  { k: "Annulering", v: "Kosteloos tot 7 werkdagen voorafgaand aan de opnamedag. Bij annulering binnen 7 werkdagen wordt € 395 excl. btw in rekening gebracht. Bij annulering binnen 24 uur voor de opnamedag wordt 100% van de opnamedag in rekening gebracht." },
  { k: "Reistijd", v: "Onze reiskosten bedragen € 0,35 per km." },
  { k: "Raw footage", v: "Blijft bij ShortClips. Op verzoek beschikbaar voor € 450 per opnamedag, binnen 90 dagen." },
  { k: "Responstijd", v: "Binnen één werkdag, maandag tot en met vrijdag van 09:00 tot 17:00." },
];

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-white/10 py-3 first:border-t-0">
      <span className="text-[13px] text-[var(--color-ink-muted)]">{k}</span>
      <span className="text-right text-[14px] font-semibold">{v}</span>
    </div>
  );
}

export default async function PortalSamenwerkingPage() {
  const viewer = await requirePortal();
  const [data, collab, contact] = await Promise.all([
    getPortalData(viewer),
    getPortalCollaboration(viewer),
    getPortalContact(viewer),
  ]);

  const now = new Date();
  const klaar = data.inProgress.filter((v) => READY_STATUSES.has(v.status)).length;
  const inProductie = data.inProgress.length - klaar;
  const gepubliceerd = data.published.filter(
    (v) => v.publishedAt && new Date(v.publishedAt).getMonth() === now.getMonth() && new Date(v.publishedAt).getFullYear() === now.getFullYear(),
  ).length;
  const quota = collab.monthlyQuota;
  const pct = quota > 0 ? Math.min(100, Math.round((gepubliceerd / quota) * 100)) : 0;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Samenwerking</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Wat we hebben afgesproken, hoeveel content je krijgt en waar we deze maand staan.
        </p>
      </div>

      <div className="grid gap-[18px] lg:grid-cols-2">
        {/* Huidige samenwerking */}
        <section className="sc-glass p-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Huidige samenwerking</span>
          <div className="mt-4">
            <Row k="Afgesproken per maand" v={quota > 0 ? `${quota} shorts` : "In overleg"} />
            <Row k="Startdatum" v={collab.contract?.startsOn ? formatDate(collab.contract.startsOn) : collab.startedOn ? formatDate(collab.startedOn) : "—"} />
            <Row k="Opzegtermijn" v={collab.contract ? `${Math.round(collab.contract.noticePeriodDays / 30)} kalendermaand` : "1 kalendermaand"} />
            <Row k="Publicatie" v="Inbegrepen" />
          </div>
        </section>

        {/* Deze maand */}
        <section className="sc-glass p-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Deze maand</span>
          {quota > 0 ? (
            <div className="mt-4">
              <div className="flex items-end justify-between">
                <span className="text-[28px] font-bold leading-none tabular-nums">
                  <CountUp value={gepubliceerd} /><span className="text-[var(--color-ink-faint)]">/{quota}</span>
                </span>
                <span className="text-[13px] text-[var(--color-ink-muted)]">gepubliceerd</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#19a8ff] to-[#1b5fe0]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-white/10 bg-white/5">
            {[
              { label: "in productie", value: inProductie },
              { label: "wacht op jou", value: data.awaitingApproval.length },
              { label: "klaar", value: klaar },
            ].map((s) => (
              <div key={s.label} className="bg-[rgba(10,12,38,0.6)] p-3">
                <CountUp value={s.value} className="block text-[20px] font-bold tabular-nums leading-none" />
                <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Afspraken — "Zo leggen we het vast" */}
      <section id="afspraken" className="sc-glass scroll-mt-24 p-6 sm:p-7">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">De afspraken</span>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">Zo leggen we het vast</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">
          Deze afspraken gelden voor elk niveau en zijn onderdeel van de overeenkomst.
        </p>
        <dl className="mt-5 grid gap-2.5">
          {AFSPRAKEN.map((a) => (
            <div
              key={a.k}
              className="grid gap-1 rounded-[13px] border border-[#2e90fa]/20 bg-[rgba(46,144,250,0.05)] p-4 sm:grid-cols-[200px_1fr] sm:gap-5"
            >
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

      {/* Snelkoppelingen */}
      <div className="grid gap-[18px] sm:grid-cols-2">
        <Link href="/portal/werkwijze" className="group flex items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[rgba(25,168,255,0.1)] text-[#4bc4ff]"><BookOpen className="size-5" strokeWidth={1.8} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Werkwijze</span>
            <span className="block text-[13px] text-[var(--color-ink-muted)]">De opnamedag, afspraken en rolverdeling.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link href="/portal/agenda" className="group flex items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[rgba(25,168,255,0.1)] text-[#4bc4ff]"><CalendarCheck className="size-5" strokeWidth={1.8} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Agenda &amp; planning</span>
            <span className="block text-[13px] text-[var(--color-ink-muted)]">Je opnamedagen en afspraken.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Je contactpersoon */}
      {contact.coordinator ? (
        <Link href="/portal/contact" className="group flex items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1b6fe8] to-[#22a7ff] font-semibold text-white">
            {contact.coordinator.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{contact.coordinator.name}</span>
            <span className="block text-[13px] text-[var(--color-ink-muted)]">Je vaste contactpersoon — planning, scripts, feedback en resultaten.</span>
          </span>
          <UserRound className="size-5 shrink-0 text-[var(--color-ink-faint)]" />
        </Link>
      ) : null}
    </div>
  );
}
