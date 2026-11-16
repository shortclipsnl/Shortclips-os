"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, Check, Loader2, X } from "lucide-react";
import { Card, ClientLogo } from "@/components/ui";
import { confirmShootOutcome } from "@/server/actions/productions";
import type { AvailabilityDay, VgDay } from "@/lib/shoot-availability";

/* ------------------------------------------------------------------ *
 * Hulpjes
 * ------------------------------------------------------------------ */

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Link naar een nieuwe afspraak in Google Agenda (account Team Shortclips),
 *  in hetzelfde titelformaat als de bestaande opnames zodat de sync hem
 *  automatisch aan de klant koppelt. Google Agenda blijft zo de enige bron. */
export function googleShootLink(dateIso: string, clientName?: string, startHHMM = "09:00", endHHMM = "15:00"): string {
  const d = dateIso.slice(0, 10).replace(/-/g, "");
  const t = (hhmm: string) => hhmm.replace(":", "") + "00";
  const text = clientName ? `${startHHMM.replace(/^0/, "")} - Opnamesessie ${clientName}` : `${startHHMM.replace(/^0/, "")} - Opnamesessie [klant]`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text,
    dates: `${d}T${t(startHHMM)}/${d}T${t(endHHMM)}`,
    ctz: "Europe/Amsterdam",
    details: "Ingepland vanuit de Opnameplanning in Shortclips Hub. Zet deze afspraak in de agenda Team Shortclips.",
    authuser: "teamshortclips@gmail.com",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export const dayHref = (iso: string) => `/productions?dag=${iso.slice(0, 10)}#agenda`;

/* ------------------------------------------------------------------ *
 * Kleuren: groen beschikbaar, blauw gepland, grijs niet beschikbaar,
 * oranje aandachtspunt.
 * ------------------------------------------------------------------ */

function VgPill({ v, unconfirmed }: { v: VgDay; unconfirmed: boolean }) {
  if (v.state === "beschikbaar") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${unconfirmed ? "border border-dashed border-[var(--color-warn)] text-[#8a5300]" : "bg-[var(--color-good-soft)] text-[var(--color-good)]"}`}
        title={unconfirmed ? "Onbevestigd: de agenda is niet recent bijgewerkt" : undefined}
      >
        Beschikbaar{v.detail !== "hele dag" ? <span className="font-normal opacity-80">· {v.detail}</span> : null}
      </span>
    );
  }
  if (v.state === "bezet" && v.busyBy === "opname") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-info)]" title={v.detail}>
        Gepland <span className="truncate font-normal opacity-80">· {v.detail}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 truncate rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-faint)]" title={v.detail}>
      {v.state === "afwezig" || v.state === "op_aanvraag" ? v.detail : "Niet beschikbaar"}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Synchronisatiestatus
 * ------------------------------------------------------------------ */

export function SyncBanner({ lastSuccessAt, lastError, canFix }: { lastSuccessAt: string | null; lastError: string | null; canFix: boolean }) {
  const when = lastSuccessAt
    ? new Date(lastSuccessAt).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })
    : "onbekend";
  return (
    <Card className="mb-4 border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)]/50">
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--color-ink)]">Google Agenda niet actueel · laatst bijgewerkt {when}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {lastError ? `${lastError} ` : ""}Nieuwe, verplaatste of geannuleerde opnames sinds dat moment staan hier nog niet in. De beschikbaarheid hieronder is daarom onbevestigd: check de agenda voordat je een klant een datum geeft.
          </p>
        </div>
        {canFix ? (
          <Link href="/settings/integrations" className="shrink-0 rounded-full bg-[var(--color-warn)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95">
            Koppeling herstellen
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Opnames uit het verleden bevestigen
 * ------------------------------------------------------------------ */

export type ConfirmRow = { id: string; scheduledOn: string; clientName: string; clientSlug: string; clientColor: string | null; clientLogo: string | null };

export function ConfirmPastShoots({ rows, canWrite }: { rows: ConfirmRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const act = (id: string, outcome: "completed" | "cancelled") => {
    setBusyId(id);
    setError(null);
    start(async () => {
      const r = await confirmShootOutcome(id, outcome);
      if (!r.ok) setError(r.message ?? "Opslaan mislukt.");
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <Card className="mb-4 border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]/30" padded={false}>
      <div className="px-4 pt-3">
        <h2 className="text-sm font-bold text-[var(--color-ink)]">
          {rows.length} opname{rows.length === 1 ? "" : "s"} uit het verleden nog te bevestigen
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          Datum is voorbij, maar er staat nog geen beeld in montage. Een opname telt pas als afgerond met bewijs of jouw bevestiging.
        </p>
        {error ? <p className="mt-1 text-xs font-semibold text-[var(--color-bad)]">{error}</p> : null}
      </div>
      <ul className="mt-2 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <Link href={`/productions/${r.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 hover:underline">
              <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={22} />
              <span className="truncate text-sm font-medium">{r.clientName}</span>
              <span className="text-xs text-[var(--color-ink-muted)]">{shortDate(r.scheduledOn)}</span>
            </Link>
            {canWrite ? (
              <span className="flex gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(r.id, "completed")}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good)] px-3 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-60"
                >
                  {busyId === r.id && pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Afgerond
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(r.id, "cancelled")}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
                >
                  <X className="size-3" /> Geannuleerd
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Beschikbare opnamedagen deze maand, per videograaf
 * ------------------------------------------------------------------ */

export function AvailableDaysOverview({
  days,
  videographers,
  monthEnd,
  unconfirmed,
}: {
  days: AvailabilityDay[];
  videographers: { id: string; name: string }[];
  monthEnd: string;
  unconfirmed: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const inMonth = days.filter((d) => d.date <= monthEnd);
  const available = inMonth.filter((d) => d.available);
  const shown = showAll ? inMonth : available;
  const monthName = new Date(`${monthEnd}T12:00:00Z`).toLocaleDateString("nl-NL", { month: "long", timeZone: "UTC" });
  const cols = `minmax(0,1.3fr) ${videographers.map(() => "minmax(0,1fr)").join(" ")} auto`;

  return (
    <Card className="mb-5 overflow-hidden" padded={false}>
      <div className="flex flex-wrap items-center gap-2 bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
        <span className="text-sm font-bold tracking-tight">Beschikbare opnamedagen {monthName}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${unconfirmed ? "bg-[var(--color-warn)] text-white" : "bg-white/15"}`}>
          {available.length} werkdag{available.length === 1 ? "" : "en"} nog beschikbaar{unconfirmed ? " · onbevestigd" : ""}
        </span>
        {inMonth.length > available.length ? (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium hover:bg-white/25">
            {showAll ? "Alleen beschikbare dagen" : "Toon alle werkdagen"}
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--color-ink-muted)]">Geen beschikbare werkdagen meer deze maand.</p>
      ) : (
        <>
          <div
            className="hidden items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] sm:grid sm:[grid-template-columns:var(--cols)]"
            style={{ "--cols": cols } as CSSProperties}
          >
            <span>Datum</span>
            {videographers.map((v) => <span key={v.id}>{v.name}</span>)}
            <span className="w-[112px]" />
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {shown.map((d) => (
              <li key={d.date} className={`px-4 py-2 ${d.available ? "" : "opacity-70"}`}>
                <div className="flex flex-wrap items-center gap-2 sm:grid sm:gap-3 sm:[grid-template-columns:var(--cols)]" style={{ "--cols": cols } as CSSProperties}>
                  <Link href={dayHref(d.date)} className="w-full truncate text-sm font-semibold text-[var(--color-ink)] hover:underline sm:w-auto">
                    {cap(longDate(d.date))}
                  </Link>
                  {d.perVg.map((v) => (
                    <span key={v.videographerId} className="min-w-0">
                      <VgPill v={v} unconfirmed={unconfirmed} />
                    </span>
                  ))}
                  <span className="ml-auto flex justify-end sm:w-[112px]">
                    {d.available ? (
                      <a
                        href={googleShootLink(d.date)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-600)] px-3 py-1 text-xs font-semibold text-white hover:brightness-110"
                        title="Opent een nieuwe opname-afspraak in Google Agenda op deze dag"
                      >
                        <CalendarPlus className="size-3" /> Plan opname
                      </a>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="border-t border-[var(--color-line)] px-4 py-2 text-2xs text-[var(--color-ink-faint)]">
        Beschikbaar = binnen werktijd (08:30-17:00) minstens 4 uur aaneengesloten vrij, inclusief 1 uur reistijd rond andere opnames. Verlof, feestdagen en afwezigheid in de agenda (bijv. Rutger vrij) tellen mee. Jarno staat op aanvraag en telt niet mee in het aantal beschikbare dagen. Plannen gaat via Google Agenda; de opname verschijnt na de sync automatisch hier.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Nog in te plannen opnames
 * ------------------------------------------------------------------ */

export type CandidateRow = {
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  lastShootOn: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  priority: "eerste" | "achterstallig" | "nu" | "binnenkort";
  coordinatorName: string | null;
  videographerName: string | null;
  suggestedDate: string | null;
};

const PRIO: Record<CandidateRow["priority"], { label: string; cls: string }> = {
  eerste: { label: "Eerste opname", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  achterstallig: { label: "Te laat", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  nu: { label: "Nu inplannen", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  binnenkort: { label: "Binnenkort", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

export function PlanningCandidates({ rows }: { rows: CandidateRow[] }) {
  if (rows.length === 0) return null;
  const cols = "minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1.1fr) minmax(0,0.9fr) minmax(0,0.8fr) auto";
  return (
    <Card className="mb-5 overflow-hidden" padded={false}>
      <div className="flex items-center gap-2 bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
        <span className="text-sm font-bold tracking-tight">Nog in te plannen opnames · {rows.length}</span>
        <span className="ml-auto hidden text-xs text-white/70 sm:inline">Benaderen om lege dagen te vullen</span>
      </div>
      <div
        className="hidden items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] md:grid md:[grid-template-columns:var(--cols)]"
        style={{ "--cols": cols } as CSSProperties}
      >
        <span>Klant</span>
        <span>Laatste opname</span>
        <span>Gewenste volgende</span>
        <span>Contentcreator</span>
        <span>Videograaf</span>
        <span className="w-[150px]" />
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {rows.map((r) => {
          const p = PRIO[r.priority];
          const target = r.suggestedDate ?? r.windowFrom;
          return (
            <li key={r.clientId} className="px-4 py-2.5">
              <div className="flex items-center gap-3 md:grid md:[grid-template-columns:var(--cols)]" style={{ "--cols": cols } as CSSProperties}>
                <Link href={`/clients/${r.clientSlug}?tab=opnames`} className="flex min-w-0 flex-1 items-center gap-2.5 hover:underline">
                  <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={24} />
                  <span className="truncate text-sm font-medium">{r.clientName}</span>
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold lg:inline ${p.cls}`}>{p.label}</span>
                </Link>
                <span className="hidden text-sm text-[var(--color-ink-muted)] md:block">{r.lastShootOn ? shortDate(r.lastShootOn) : "Nog nooit"}</span>
                <span className="hidden text-sm md:block">
                  {r.windowFrom && r.windowTo ? `${shortDate(r.windowFrom)} - ${shortDate(r.windowTo)}` : "Zo snel mogelijk"}
                </span>
                <span className="hidden truncate text-sm text-[var(--color-ink-muted)] md:block">{r.coordinatorName?.split(" ")[0] ?? "Niet toegewezen"}</span>
                <span className="hidden truncate text-sm text-[var(--color-ink-muted)] md:block">{r.videographerName?.split(" ")[0] ?? "Niet toegewezen"}</span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 md:w-[150px]">
                  <a
                    href={googleShootLink(target ?? new Date().toLocaleDateString("en-CA"), r.clientName)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-600)] px-3 py-1 text-xs font-semibold text-white hover:brightness-110"
                  >
                    <CalendarPlus className="size-3" /> Plan opname
                  </a>
                  {r.suggestedDate ? (
                    <Link href={dayHref(r.suggestedDate)} className="text-2xs font-medium text-[var(--color-good)] hover:underline">
                      Eerste vrije dag: {shortDate(r.suggestedDate)}
                    </Link>
                  ) : (
                    <span className="text-2xs text-[var(--color-ink-faint)]">Geen vrije dag deze maand</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
