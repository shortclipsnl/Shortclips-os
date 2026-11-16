"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ChevronDown, Circle, Clock, ListChecks, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { togglePublicationCheck } from "@/server/actions/publication-checks";
import { isInPublicationWindow, publicationPhaseKey } from "@/lib/publication-window";
import { cn } from "@/lib/cn";

/** Automatische status: ok (groen), open (oranje), ontbreekt (rood). */
export type AutoState = { state: "ok" | "open" | "missing"; note?: string };
/** Handmatig punt, opgeslagen per video (wie vinkte af). */
export type ManualState = { id: string; done: boolean; doneByName: string | null } | null;

export type PubCheckRow = {
  id: string;
  title: string;
  clientName: string;
  clientLogo: string | null;
  clientColor: string | null;
  time: string | null;
  platforms: string[];
  videoHref: string | null;
  published: boolean;
  approved: AutoState;
  linked: AutoState;
  subtitles: ManualState;
  caption: ManualState;
  hasCaption: boolean;
  planned: AutoState;
};

/** De zes vaste controlepunten, in deze volgorde overal gelijk. */
const CHECKS = [
  { key: "approved", short: "Goedgekeurd", label: "Video definitief goedgekeurd door de klant", how: "automatisch" },
  { key: "linked", short: "Video gekoppeld", label: "De juiste video is gekoppeld", how: "automatisch" },
  { key: "subtitles", short: "Ondertiteling", label: "Ondertiteling en teksten kloppen", how: "zelf afvinken" },
  { key: "caption", short: "Caption", label: "Caption gecontroleerd", how: "zelf afvinken" },
  { key: "planned", short: "Platform & moment", label: "Juiste platform(en) en publicatiemoment", how: "automatisch" },
  { key: "ready", short: "Klaar", label: "Klaar voor publicatie", how: "volgt uit 1 t/m 5" },
] as const;

const OVERRIDE_PREFIX = "sc-pubcheck-handmatig:";

function rowIsReady(r: PubCheckRow, local: Record<string, boolean>): boolean {
  const manualDone = (m: ManualState) => !!m && (local[m.id] ?? m.done);
  return (
    r.approved.state === "ok" &&
    r.linked.state === "ok" &&
    r.planned.state === "ok" &&
    manualDone(r.subtitles) &&
    r.hasCaption &&
    manualDone(r.caption)
  );
}

function StatusChip({ state, label, title }: { state: "ok" | "open" | "missing"; label: string; title?: string }) {
  const tone =
    state === "ok"
      ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)] text-[#1f6e4e]"
      : state === "open"
        ? "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] text-[#8a5300]"
        : "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)] text-[#a3322a]";
  const Icon = state === "ok" ? Check : state === "open" ? Clock : X;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold", tone)}>
      <Icon className="size-3" strokeWidth={3} aria-hidden />
      {label}
    </span>
  );
}

function ManualChip({
  check,
  label,
  done,
  disabled,
  disabledNote,
  onToggle,
}: {
  check: ManualState;
  label: string;
  done: boolean;
  disabled: boolean;
  disabledNote?: string;
  onToggle: () => void;
}) {
  if (!check) return <StatusChip state="missing" label={label} title={disabledNote ?? "Koppel eerst de video"} />;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={done}
      title={done ? `Afgevinkt${check.doneByName ? ` door ${check.doneByName}` : ""}. Klik om terug te zetten.` : "Klik om af te vinken"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        done
          ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)] text-[#1f6e4e]"
          : "border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-good)] hover:text-[#1f6e4e]",
      )}
    >
      {done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : <Circle className="size-3" aria-hidden />}
      {label}
    </button>
  );
}

export function PublicationCheckPanel({
  autoOpen,
  initialOpen,
  canToggle,
  rows,
  scopeLabel,
}: {
  /** Krijgt deze gebruiker de automatische opening (Jarno, Milou, Jiska)? */
  autoOpen: boolean;
  /** Stand bij de eerste weergave (server), zodat er niets verspringt. */
  initialOpen: boolean;
  /** Mag deze gebruiker punten afvinken? */
  canToggle: boolean;
  rows: PubCheckRow[];
  /** Bv. "vandaag" of "vandaag · Klantnaam". */
  scopeLabel: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [inWindow, setInWindow] = useState(autoOpen && initialOpen);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const phaseRef = useRef<string | null>(null);

  // Automatisch openen en sluiten volgens het publicatiemoment, ook als de
  // pagina al openstaat. Een handmatige keuze blijft staan tot de volgende
  // fase (bv. tot 17:00), daarna volgt het onderdeel weer de automatische stand.
  const sync = useCallback(() => {
    const now = new Date();
    const phase = publicationPhaseKey(now);
    const windowNow = isInPublicationWindow(now);
    setInWindow(autoOpen && windowNow);
    if (phaseRef.current === phase) return;
    phaseRef.current = phase;
    let override: string | null = null;
    try {
      override = sessionStorage.getItem(OVERRIDE_PREFIX + phase);
    } catch {
      override = null;
    }
    if (override === "open" || override === "dicht") setOpen(override === "open");
    else setOpen(autoOpen && windowNow);
  }, [autoOpen]);

  useEffect(() => {
    // Direct na het laden één keer synchroniseren (handmatige keuze uit deze
    // sessie, of een fase die sinds de serverweergave al gewisseld is).
    const first = window.setTimeout(sync, 0);
    const timer = window.setInterval(sync, 30_000);
    const onVisible = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem(OVERRIDE_PREFIX + publicationPhaseKey(), next ? "open" : "dicht");
    } catch {
      /* privémodus: alleen voor deze weergave */
    }
  }

  function toggleCheck(id: string, current: boolean) {
    setError(null);
    setLocal((s) => ({ ...s, [id]: !current }));
    startTransition(async () => {
      const res = await togglePublicationCheck(id);
      if (!res.ok) {
        setLocal((s) => ({ ...s, [id]: current }));
        setError(res.message ?? "Afvinken is niet gelukt.");
      }
    });
  }

  const pendingRows = rows.filter((r) => !r.published);
  const readyCount = pendingRows.filter((r) => rowIsReady(r, local)).length;
  const highlight = inWindow;

  return (
    <section
      aria-label="Publicatiecheck"
      className={cn("sc-card overflow-hidden", highlight && "ring-2 ring-[var(--color-good)]")}
      style={{ boxShadow: `inset 3px 0 0 ${highlight ? "var(--color-good)" : "var(--color-info)"}` }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
          <ListChecks className="size-4 shrink-0 text-[var(--color-ink-muted)]" />
          Publicatiecheck: controleer dit vóór je publiceert
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {inWindow ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good)] px-2 py-0.5 text-2xs font-semibold text-white">
              <Clock className="size-3" aria-hidden />
              Publicatiemoment 14:00-17:00
            </span>
          ) : null}
          {pendingRows.length > 0 ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-2xs font-semibold",
                readyCount === pendingRows.length
                  ? "bg-[var(--color-good-soft)] text-[#1f6e4e]"
                  : "bg-[var(--color-warn-soft)] text-[#8a5300]",
              )}
            >
              {readyCount}/{pendingRows.length} klaar {scopeLabel}
            </span>
          ) : null}
          <ChevronDown className={cn("size-4 text-[var(--color-ink-faint)] transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>

      {open ? (
        <div className="border-t border-[var(--color-line)] px-3.5 py-3 text-sm">
          {/* De zes controlepunten in één oogopslag. */}
          <ol className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {CHECKS.map((c, i) => (
              <li key={c.key} className="flex items-start gap-2">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-2xs font-bold text-white" aria-hidden>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-[var(--color-ink)]">{c.label}</span>
                  <span className="ml-1 text-2xs text-[var(--color-ink-faint)]">({c.how})</span>
                </span>
              </li>
            ))}
          </ol>

          {/* Status per publicatie van vandaag. */}
          <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-line)]">
            <p className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              Te publiceren {scopeLabel}
            </p>
            {rows.length === 0 ? (
              <p className="px-3 py-3 text-[var(--color-ink-muted)]">Er staan {scopeLabel} geen publicaties in de planning.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {rows.map((r) => {
                  const subDone = !!r.subtitles && (local[r.subtitles.id] ?? r.subtitles.done);
                  const capDone = !!r.caption && (local[r.caption.id] ?? r.caption.done);
                  const ready = rowIsReady(r, local);
                  return (
                    <li key={r.id} className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-4">
                      <div className="flex min-w-0 items-center gap-2.5 lg:w-[30%] lg:shrink-0">
                        <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={26} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--color-ink)]">
                            {r.videoHref ? <Link href={r.videoHref} className="hover:underline">{r.title}</Link> : r.title}
                          </p>
                          <p className="flex items-center gap-1.5 text-2xs text-[var(--color-ink-muted)]">
                            <span className="truncate">{r.clientName}</span>
                            {r.time ? <span>· {r.time.slice(0, 5)}</span> : null}
                            {r.platforms.map((p) => (
                              <PlatformIcon key={p} platform={p} size={12} />
                            ))}
                          </p>
                        </div>
                      </div>
                      {r.published ? (
                        <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[#1f6e4e]">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          Gepubliceerd. Rond de checklist na publicatie af op de videopagina.
                        </span>
                      ) : (
                        <div className="flex flex-1 flex-wrap items-center gap-1.5">
                          <StatusChip state={r.approved.state} label="Goedgekeurd" title={r.approved.note} />
                          <StatusChip state={r.linked.state} label="Video gekoppeld" title={r.linked.note} />
                          <ManualChip
                            check={r.subtitles}
                            label="Ondertiteling"
                            done={subDone}
                            disabled={!canToggle || pending}
                            onToggle={() => r.subtitles && toggleCheck(r.subtitles.id, subDone)}
                          />
                          {r.hasCaption ? (
                            <ManualChip
                              check={r.caption}
                              label="Caption"
                              done={capDone}
                              disabled={!canToggle || pending}
                              onToggle={() => r.caption && toggleCheck(r.caption.id, capDone)}
                            />
                          ) : (
                            <StatusChip state="missing" label="Geen caption" title="Er staat nog geen caption bij dit bericht" />
                          )}
                          <StatusChip state={r.planned.state} label="Platform & moment" title={r.planned.note} />
                          <span
                            className={cn(
                              "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-bold",
                              ready ? "bg-[var(--color-good)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
                            )}
                          >
                            {ready ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
                            {ready ? "Klaar voor publicatie" : "Nog niet klaar"}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error ? <p className="mt-2 text-xs text-[var(--color-bad)]">{error}</p> : null}
          <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">
            Let ook op de juiste cover/thumbnail en de klantafspraken (merkregels, vermijd-woorden). Groen = in orde, oranje = nog niet zover, rood = ontbreekt.
            Een vinkje bij Caption telt ook mee voor de checklist na publicatie op de videopagina.
          </p>
        </div>
      ) : null}
    </section>
  );
}
