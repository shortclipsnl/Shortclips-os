import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, ClientLogo, PageHeader, Stat, Table } from "@/components/ui";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { getContractsDashboard } from "@/server/contracts";
import {
  DEFAULT_REMINDER_DAYS, DISPLAY_LABEL, REACTIVATION_LABEL, RENEWAL_LABEL, periodMonths, periodValue, remainingLabel, sortPeriods,
  type ContractRow,
} from "@/lib/contracts";
import { ContractAttentionBlock } from "./attention-block";
import { ContractActions, EndNotesForm, type ContractFormInitial } from "./contract-forms";
import { STATUS_TONE, eur, longDate, monthsLabel, shortDate } from "./format";

export const metadata: Metadata = { title: "Contracten & Verlengingen" };
export const dynamic = "force-dynamic";

/**
 * Contracten & Verlengingen. Uitsluitend voor de eigenaar: teamleden, editors
 * en klanten krijgen "pagina niet gevonden" (requireFinanceOwner).
 */
export default async function ContractenPage({ searchParams }: { searchParams: Promise<{ tab?: string; klant?: string }> }) {
  await requireFinanceOwner();
  const sp = await searchParams;
  const d = await getContractsDashboard();
  const tab = sp.tab === "niet-actief" ? "niet-actief" : "actief";
  const selected = sp.klant ? [...d.active, ...d.inactive].find((r) => r.client.slug === sp.klant) ?? null : null;
  const t = d.totals;
  const rows = tab === "actief" ? d.active : d.inactive;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab: tab === "actief" ? undefined : tab, klant: sp.klant, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/contracten?${s}` : "/contracten";
  };

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <PageHeader
        title="Contracten & Verlengingen"
        description="Wat elke klant oplevert, hoe lang de samenwerking nog loopt en welke verlengingen je op tijd moet bespreken. Alleen zichtbaar voor jou."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Actieve klanten" value={t.activeClients} hint={<>{d.active.filter((r) => r.client.status === "paused").length ? `Waarvan ${d.active.filter((r) => r.client.status === "paused").length} gepauzeerd. ` : ""}{t.toVerify ? `${t.toVerify} met gegevens te controleren (paarse stip)` : "Alle gegevens gecontroleerd"}</>} />
        <Stat label="Maandelijkse contractomzet" value={eur(t.monthlyRevenue)} hint="Lopende maandbedragen, excl. btw" />
        <Stat label="Lopende contractwaarde" value={eur(t.remainingValue)}
          hint={<>Nog te verwachten tot de einddatums{t.remainingUnknown ? `, excl. ${t.remainingUnknown} zonder einddatum` : ""}. Lopende periodes: {eur(t.originalValue)} totaal, {eur(t.elapsedValue)} verstreken.</>} />
        <Stat label="Binnenkort aflopend" value={t.expiringSoon} tone={t.expiringSoon ? "warn" : "neutral"} hint="Binnen 60 dagen, nog geen verlenging" />
      </div>

      <ContractAttentionBlock items={d.attention} toVerify={0} />

      {selected ? <ClientDetail row={selected} closeHref={qs({ klant: undefined })} today={d.today} /> : null}

      <section className="sc-card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[var(--color-line)] px-3 pt-2">
          {[["actief", `Actieve klanten (${d.active.length})`], ["niet-actief", `Niet actieve klanten (${d.inactive.length})`]].map(([k, l]) => (
            <Link key={k} href={k === "actief" ? "/contracten" : "/contracten?tab=niet-actief"}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-[var(--color-indigo-ink)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
              {l}
            </Link>
          ))}
        </div>
        {tab === "actief" ? <ActiveTable rows={rows} hrefFor={(slug) => qs({ klant: slug })} selected={sp.klant} /> : <InactiveTable rows={rows} hrefFor={(slug) => qs({ klant: slug })} selected={sp.klant} />}
      </section>
    </div>
  );
}

function ClientCell({ r, href }: { r: ContractRow; href: string }) {
  return (
    <Link href={href} scroll={false} className="flex items-center gap-2.5 font-medium text-[var(--color-ink)] hover:underline">
      <ClientLogo name={r.client.name} logoUrl={r.client.logoUrl} color={r.client.color} size={24} />
      <span className="truncate">{r.client.name}</span>
      {r.issues.length ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-violet)]" title={`Te controleren: ${r.issues.join(", ").toLowerCase()}`} aria-label="Gegevens te controleren" /> : null}
    </Link>
  );
}

function StatusCell({ r }: { r: ContractRow }) {
  const p = r.renewed ? r.latest : r.shown;
  const sub = r.status === "stopt" && r.endsOn ? `per ${shortDate(r.endsOn)}`
    : r.status === "verlengd" && r.latest?.endsOn ? `tot ${shortDate(r.latest.endsOn)}`
    : p?.renewalStatus === "in_bespreking" ? "In bespreking"
    : p?.clientConfirmed ? "Klant bevestigd" : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={STATUS_TONE[r.status]}>{DISPLAY_LABEL[r.status]}</Badge>
      {sub ? <span className="text-2xs text-[var(--color-ink-muted)]">{sub}</span> : null}
    </div>
  );
}

function ActiveTable({ rows, hrefFor, selected }: { rows: ContractRow[]; hrefFor: (slug: string) => string; selected?: string }) {
  if (!rows.length) return <p className="p-5 text-sm text-[var(--color-ink-muted)]">Geen actieve klanten.</p>;
  return (
    <Table head={<>
      <th className="sc-th">Klant</th>
      <th className="sc-th text-right">Afname</th>
      <th className="sc-th text-right">Per maand</th>
      <th className="sc-th">Looptijd</th>
      <th className="sc-th">Start</th>
      <th className="sc-th">Einde</th>
      <th className="sc-th">Resterend</th>
      <th className="sc-th text-right">Contractwaarde</th>
      <th className="sc-th">Status</th>
    </>}>
      {rows.map((r) => {
        const urgent = r.daysLeft != null && r.daysLeft <= 14 && !["verlengd", "stopt"].includes(r.status);
        return (
          <tr key={r.client.id} className={selected === r.client.slug ? "bg-[var(--color-surface-sunken)]" : undefined}>
            <td className="sc-td max-w-[200px]"><ClientCell r={r} href={hrefFor(r.client.slug)} /></td>
            <td className="sc-td text-right tabular-nums">{r.videosPerMonth != null ? `${r.videosPerMonth} shorts` : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td text-right tabular-nums">
              {r.monthly > 0 ? eur(r.monthly) : <Muted>Onbekend</Muted>}
              {r.client.status === "paused" ? <div className="text-2xs text-[var(--color-ink-faint)]">telt niet mee</div> : null}
            </td>
            <td className="sc-td">{r.months != null ? monthsLabel(r.months) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td whitespace-nowrap">{r.shown?.startsOn ? shortDate(r.shown.startsOn) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td whitespace-nowrap">{r.endsOn ? shortDate(r.endsOn) : <Muted>Onbekend</Muted>}</td>
            <td className={`sc-td whitespace-nowrap ${urgent ? "font-semibold text-[var(--color-bad)]" : ""}`}>{r.endsOn ? remainingLabel(r.daysLeft) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td text-right tabular-nums">{r.value.total != null ? eur(r.value.total) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td min-w-[120px]"><StatusCell r={r} /></td>
          </tr>
        );
      })}
    </Table>
  );
}

function InactiveTable({ rows, hrefFor, selected }: { rows: ContractRow[]; hrefFor: (slug: string) => string; selected?: string }) {
  if (!rows.length) return <p className="p-5 text-sm text-[var(--color-ink-muted)]">Geen niet actieve klanten.</p>;
  return (
    <Table head={<>
      <th className="sc-th">Klant</th>
      <th className="sc-th text-right">Laatste maandbedrag</th>
      <th className="sc-th text-right">Historische waarde</th>
      <th className="sc-th">Laatste einddatum</th>
      <th className="sc-th">Reden</th>
      <th className="sc-th">Heractivatie</th>
    </>}>
      {rows.map((r) => {
        const last = r.latest;
        const end = last?.endsOn ?? r.client.endedOn;
        return (
          <tr key={r.client.id} className={selected === r.client.slug ? "bg-[var(--color-surface-sunken)]" : undefined}>
            <td className="sc-td max-w-[200px]"><ClientCell r={r} href={hrefFor(r.client.slug)} /></td>
            <td className="sc-td text-right tabular-nums">{r.monthly > 0 ? eur(r.monthly) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td text-right tabular-nums">{r.historicTotal > 0 ? <>{eur(r.historicTotal)}{!r.historicComplete ? <span className="text-[var(--color-ink-faint)]">+</span> : null}</> : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td whitespace-nowrap">{end ? shortDate(end) : <Muted>Onbekend</Muted>}</td>
            <td className="sc-td max-w-[280px] truncate" title={last?.endReason ?? undefined}>{last?.endReason ?? <Muted>Niet vastgelegd</Muted>}</td>
            <td className="sc-td">{last?.reactivation ? <Badge tone={last.reactivation === "kansrijk" ? "good" : last.reactivation === "misschien" ? "warn" : "neutral"}>{REACTIVATION_LABEL[last.reactivation]}</Badge> : <Muted>Onbekend</Muted>}</td>
          </tr>
        );
      })}
    </Table>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-[var(--color-ink-faint)]">{children}</span>;

function Field({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--color-ink)]">{value}</p>
      {sub ? <p className="text-xs text-[var(--color-ink-muted)]">{sub}</p> : null}
    </div>
  );
}

/** Compact klantdetail: actuele gegevens, historie en acties. */
function ClientDetail({ row: r, closeHref, today }: { row: ContractRow; closeHref: string; today: string }) {
  const focus = r.renewed ? r.latest : r.shown;
  const history = sortPeriods(r.client.periods).slice().reverse();
  const edit: ContractFormInitial = {
    contractId: focus?.id ?? null,
    startsOn: focus?.startsOn ?? "",
    endsOn: focus?.endsOn ?? "",
    durationMonths: focus?.durationMonths != null ? String(focus.durationMonths) : "",
    monthlyValue: String(focus?.monthlyValue ?? (r.client.monthlyRevenue || "")),
    videosPerMonth: focus?.videosPerMonth != null ? String(focus.videosPerMonth) : r.client.monthlyVideoQuota ? String(r.client.monthlyVideoQuota) : "",
    autoRenew: focus?.autoRenew ?? false,
    noticePeriodDays: String(focus?.noticePeriodDays ?? 30),
    clientConfirmed: focus?.clientConfirmed ?? false,
    reminderDays: focus?.reminderDays?.join(", ") ?? "",
    notes: focus?.notes ?? "",
  };
  const reminders = focus?.reminderDays?.length ? focus.reminderDays : [...DEFAULT_REMINDER_DAYS];

  return (
    <section id="detail" className="sc-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClientLogo name={r.client.name} logoUrl={r.client.logoUrl} color={r.client.color} size={36} />
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{r.client.name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[r.status]}>{DISPLAY_LABEL[r.status]}</Badge>
              {focus ? <span className="text-xs text-[var(--color-ink-muted)]">Verlengstatus: {RENEWAL_LABEL[focus.renewalStatus]}{focus.clientConfirmed && focus.renewalStatus !== "verlengd" ? " · klant heeft bevestigd" : ""}</span> : null}
              {r.issues.length ? <span className="text-xs text-[#5636c4]">Te controleren: {r.issues.join(", ").toLowerCase()}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href={`/clients/${r.client.slug}`} className="text-[var(--color-ink-muted)] hover:underline">Klantpagina</Link>
          <Link href={closeHref} scroll={false} className="text-[var(--color-ink-muted)] hover:underline">Sluiten ✕</Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label="Maandbedrag" value={r.monthly > 0 ? eur(r.monthly) : "Onbekend"} sub={r.monthlySource === "klantgegevens" ? "Uit klantgegevens, niet uit een contract" : "excl. btw"} />
            <Field label="Afname" value={r.videosPerMonth != null ? `${r.videosPerMonth} per maand` : "Onbekend"} />
            <Field label="Contractduur" value={monthsLabel(r.months)} />
            <Field label="Startdatum" value={longDate(r.shown?.startsOn)} />
            <Field label="Eerstvolgende einddatum" value={longDate(r.endsOn)} sub={r.endsOn ? remainingLabel(r.daysLeft) : undefined} />
            <Field label="Opzegtermijn" value={focus ? (focus.verified ? `${focus.noticePeriodDays} dagen` : "Niet gecontroleerd") : "Onbekend"}
              sub={focus && !focus.verified ? `Opgeslagen: ${focus.noticePeriodDays} dagen (standaardwaarde), telt pas mee na controle` : r.decisionDate && focus?.noticePeriodDays ? `Beslismoment ${longDate(r.decisionDate)}` : undefined} />
            <Field label="Automatisch verlengen" value={focus ? (focus.autoRenew ? "Ja" : "Nee") : "Onbekend"} />
            <Field label="Herinneringen" value={`${reminders.join(", ")} dagen`} sub={focus?.reminderDays?.length ? "Afwijkend ingesteld" : "Standaard"} />
            <Field label="Huidige periode" value={r.value.total != null ? eur(r.value.total) : "Onbekend"} sub={r.value.remaining != null ? (r.value.elapsed != null ? `${eur(r.value.elapsed)} verstreken · ${eur(r.value.remaining)} resterend` : `${eur(r.value.remaining)} resterend tot de einddatum`) : undefined} />
            <Field label="Historische waarde" value={r.historicTotal > 0 ? eur(r.historicTotal) : "Onbekend"} sub={r.historicTotal > 0 && !r.historicComplete ? "Exclusief periodes zonder bekende looptijd" : undefined} />
          </div>
          {focus?.notes ? (
            <div>
              <p className="text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">Interne notities</p>
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-ink)]">{focus.notes}</p>
            </div>
          ) : null}
          {!r.active && focus ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
              <EndNotesForm contractId={focus.id} endReason={focus.endReason} reactivation={focus.reactivation} />
            </div>
          ) : (
            <ContractActions
              clientId={r.client.id}
              contract={focus ? { id: focus.id, endsOn: focus.endsOn, monthlyValue: focus.monthlyValue, videosPerMonth: focus.videosPerMonth ?? r.videosPerMonth, autoRenew: focus.autoRenew, noticePeriodDays: focus.noticePeriodDays } : null}
              edit={edit}
              isEnded={focus?.renewalStatus === "beeindigd"}
              isDiscussing={focus?.renewalStatus === "in_bespreking"}
              confirmed={!!focus?.clientConfirmed}
              verified={!!focus?.verified}
              renewed={r.renewed}
            />
          )}
        </div>

        <div>
          <p className="mb-2 text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">Contracthistorie</p>
          {history.length ? (
            <ol className="space-y-2">
              {history.map((p) => {
                const v = periodValue(p, today);
                const isCurrent = p.id === r.current?.id;
                const isNext = r.renewed && p.id === r.latest?.id;
                return (
                  <li key={p.id} className={`rounded-[var(--radius-md)] border p-3 text-sm ${isCurrent ? "border-[var(--color-ink-muted)]" : "border-[var(--color-line)]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-[var(--color-ink)]">{shortDate(p.startsOn)} t/m {shortDate(p.endsOn)}</span>
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {isCurrent ? "Lopend" : isNext ? "Verlenging, gaat in op " + shortDate(p.startsOn) : p.endsOn && p.endsOn < today ? "Afgelopen" : ""}
                        {p.renewalStatus === "beeindigd" ? " · beëindigd" : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[var(--color-ink-muted)]">
                      {eur(p.monthlyValue)} per maand · {p.videosPerMonth != null ? `${p.videosPerMonth} shorts` : "afname onbekend"} · {monthsLabel(periodMonths(p))} · waarde {eur(v.total)}
                    </p>
                    {p.endReason ? <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">Reden: {p.endReason}</p> : null}
                    {!p.verified ? <p className="mt-0.5 text-xs text-[#5636c4]">Nog niet gecontroleerd</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-sm text-[var(--color-ink-muted)]">Nog geen contractperiodes vastgelegd.</p>}
        </div>
      </div>
    </section>
  );
}
